import { timingSafeEqual } from 'node:crypto';

/**
 * Authentication for the ZKTeco ADMS / push-protocol endpoints
 * (`/api/iclock/{cdata,getrequest,devicecmd}`, reachable as `/iclock/...`).
 *
 * These routes are the only publicly reachable write path into the database, so
 * the token is mandatory. The previous implementation returned `true` whenever
 * `ADMS_SECRET_TOKEN` was unset — i.e. it failed OPEN, and because the variable
 * was absent from `.env.local` and `.env.example` it was never set in practice.
 * The result was an unauthenticated endpoint that would happily create employees
 * and attendance punches from anywhere on the internet.
 *
 * The secret is read from the first place the terminal can realistically put it:
 *   1. `?token=...` query parameter (how the terminal is commissioned today)
 *   2. `X-ADMS-Token` header
 *   3. `Authorization: Bearer ...`
 *
 * MIGRATION NOTE
 * Terminals already deployed send no token, so flipping to fail-closed would stop
 * ingestion. `ADMS_ALLOW_UNCONFIGURED=true` is a temporary, explicit, loudly
 * logged opt-out so the cutover can be done with the terminal owner rather than
 * by surprise. It must be removed once every terminal sends the token; the
 * deployment checklist should treat it as a defect.
 */

export type DeviceAuthOutcome =
  | { ok: true; reason?: undefined }
  | { ok: false; status: 401 | 503; reason: string };

const MIGRATION_FLAG = 'ADMS_ALLOW_UNCONFIGURED';

let warnedAboutMigrationFlag = false;

function readProvidedToken(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get('token');
  if (fromQuery) return fromQuery;

  const fromHeader = request.headers.get('x-adms-token');
  if (fromHeader) return fromHeader;

  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return null;
}

/** Length-safe, constant-time comparison so the token cannot be timed out. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeDeviceRequest(request: Request): DeviceAuthOutcome {
  const expected = process.env.ADMS_SECRET_TOKEN?.trim();

  if (!expected) {
    if (process.env[MIGRATION_FLAG] === 'true') {
      if (!warnedAboutMigrationFlag) {
        warnedAboutMigrationFlag = true;
        console.error(
          `[ADMS] SECURITY: ADMS_SECRET_TOKEN is not set and ${MIGRATION_FLAG}=true, so device ` +
            'ingestion is UNAUTHENTICATED. Set ADMS_SECRET_TOKEN, configure it on every terminal, ' +
            `then remove ${MIGRATION_FLAG}. See secure_rls.sql / PRODUCTION_READINESS.md (B4).`,
        );
      }
      return { ok: true };
    }

    console.error(
      '[ADMS] ADMS_SECRET_TOKEN is not set; refusing to serve device traffic. ' +
        'Set the token and configure it on the terminal (B4).',
    );
    return {
      ok: false,
      status: 503,
      reason: 'Device ingestion is not configured on this deployment.',
    };
  }

  const provided = readProvidedToken(request);
  if (provided && safeEqual(provided, expected)) return { ok: true };

  return { ok: false, status: 401, reason: 'Unauthorized' };
}
