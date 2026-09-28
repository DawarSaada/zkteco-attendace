import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { authorizeDeviceRequest } from '@/lib/adms-auth';
import { reconcileStuckCommands, reserveSequences } from '@/lib/adms/queue';

/** Cap the work handed out per poll so one response cannot grow unbounded. */
const MAX_PER_POLL = 20;

interface PendingCommand {
  id: string;
  command_str: string | null;
  device_seq: number | null;
  attempts: number | null;
}


export async function GET(request: Request) {
    const auth = authorizeDeviceRequest(request);
    if (!auth.ok) {
        return new NextResponse(`${auth.reason}\n`, { status: auth.status });
    }

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN');

    if (!SN) return new NextResponse("OK\n", { status: 200 });

    try {
        // Retry lost commands before handing out new work, so a command cannot
        // sit in SENT forever after a dropped acknowledgement (H5).
        await reconcileStuckCommands(supabase, SN);

        const { data, error } = await supabase
            .from('device_commands')
            .select('id, command_str, device_seq, attempts')
            .eq('sn', SN)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: true })
            .limit(MAX_PER_POLL);

        if (error) {
            console.error('[getrequest] Error fetching device commands:', error.message);
            return new NextResponse("OK\n", { status: 200 });
        }

        const commands = (data ?? []) as PendingCommand[];
        if (commands.length === 0) {
            return new NextResponse("OK\n", { status: 200 });
        }

        // Rows queued before `device_seq` existed still need a stable ID.
        const missingSeq = commands.filter((cmd) => cmd.device_seq === null);
        if (missingSeq.length > 0) {
            const sequences = await reserveSequences(supabase, SN, missingSeq.length);
            for (let i = 0; i < missingSeq.length; i += 1) {
                missingSeq[i].device_seq = sequences[i];
                await supabase
                    .from('device_commands')
                    .update({ device_seq: sequences[i] })
                    .eq('id', missingSeq[i].id);
            }
        }

        let responseString = "";
        const sentAt = new Date().toISOString();

        for (const cmd of commands) {
            if (!cmd.command_str || cmd.device_seq === null) continue;
            // The device echoes this exact ID back as `ID=<n>`.
            responseString += `C:${cmd.device_seq}:${cmd.command_str}\n`;
            await supabase
                .from('device_commands')
                .update({
                    status: 'SENT',
                    sent_at: sentAt,
                    attempts: (cmd.attempts ?? 0) + 1,
                })
                .eq('id', cmd.id);
        }

        return new NextResponse(responseString || "OK\n", { status: 200 });
    } catch (err: unknown) {
        console.error('[getrequest] handler error:', err);
        return new NextResponse("OK\n", { status: 200 });
    }
}
