import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { authorizeDeviceRequest } from '@/lib/adms-auth';
import { parseDeviceReply } from '@/lib/adms/commands';

/**
 * Command acknowledgement.
 *
 * The device replies to a command with `ID=<n>&Return=<code>`. The ID is the
 * `device_seq` the server sent in `C:<id>:<command>`, so the acknowledgement is
 * correlated to exactly one row.
 *
 * The previous implementation marked EVERY `SENT` row for the SN as
 * acknowledged whenever any reply arrived, so a reboot and a data query sent
 * together were both closed by the first reply. That is fixed here (H5).
 */
export async function POST(request: Request) {
    const auth = authorizeDeviceRequest(request);
    if (!auth.ok) {
        return new NextResponse(`${auth.reason}\n`, { status: auth.status });
    }

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN');

    try {
        const bodyText = await request.text();
        const reply = parseDeviceReply(bodyText);

        if (!SN) return new NextResponse("OK\n", { status: 200 });

        if (reply.success === null) {
            // No Return=/OK token: leave the command in SENT so it is retried by
            // reconciliation rather than silently closing an unknown outcome.
            console.warn(
                `[devicecmd] Unparseable reply from ${SN}: ${reply.raw.slice(0, 200)}`,
            );
            return new NextResponse("OK\n", { status: 200 });
        }

        const patch = {
            status: reply.success ? 'ACKNOWLEDGED' : 'FAILED',
            acked_at: new Date().toISOString(),
            last_error: reply.success ? null : reply.raw.slice(0, 500),
        };

        if (reply.id !== null) {
            const { error } = await supabase
                .from('device_commands')
                .update(patch)
                .eq('sn', SN)
                .eq('device_seq', reply.id)
                .eq('status', 'SENT');

            if (error) console.error('[devicecmd] Failed to acknowledge command:', error.message);
        } else {
            // The reply carried no ID. Acknowledging is only unambiguous when a
            // single command is in flight.
            const { data: inflight } = await supabase
                .from('device_commands')
                .select('id')
                .eq('sn', SN)
                .eq('status', 'SENT');

            if (inflight && inflight.length === 1) {
                await supabase
                    .from('device_commands')
                    .update(patch)
                    .eq('id', inflight[0].id);
            } else {
                console.warn(
                    `[devicecmd] Reply from ${SN} has no ID= and ${inflight?.length ?? 0} commands are in flight; acknowledging nothing.`,
                );
            }
        }

        return new NextResponse("OK\n", { status: 200 });
    } catch (err: unknown) {
        console.error('[devicecmd] handler error:', err);
        return new NextResponse("OK\n", { status: 200 });
    }
}
