/**
 * ZKTeco ADMS / push-SDK command vocabulary.
 *
 * Every command the application can send to a terminal is built here, from a
 * typed object, with its fields validated. Nothing in the UI or in a route
 * handler may assemble a command string by hand — that is how a name containing
 * a tab or a newline turns into protocol corruption, or how an unvalidated PIN
 * becomes an injection.
 *
 * ⚠ PROTOCOL NOTE — read before changing a format string.
 * The push protocol is vendor-defined and varies by model/firmware. The exact
 * strings below follow the widely used ZKTeco push-SDK conventions, but they
 * have NOT been verified against this customer's specific terminal. Treat
 * `buildQueueEntries()` as the single place to correct a format once you have
 * confirmed it against the device manual for the installed model. Everything
 * else (the queue, the acknowledgement correlation, the UI) is format-agnostic.
 *
 * Field separator inside a command payload is a literal TAB.
 */

export class AdmsCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdmsCommandError';
  }
}

/** Fields must not contain the protocol separators. */
const FORBIDDEN = /[\t\r\n]/;

/**
 * Make an arbitrary string safe to place in a command field: strip control
 * characters and the separators, collapse whitespace, and cap the length.
 */
export function sanitizeField(value: unknown, maxLength = 64): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** A field that must be present and free of protocol separators. */
function requireField(value: unknown, label: string, maxLength = 64): string {
  const raw = String(value ?? '');
  if (!raw.trim()) throw new AdmsCommandError(`${label} is required.`);
  if (FORBIDDEN.test(raw)) {
    throw new AdmsCommandError(`${label} may not contain tabs or line breaks.`);
  }
  return raw.trim().slice(0, maxLength);
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AdmsCommandError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

/** Payload strings (base64 templates/photos) must be plain base64. */
function requireBase64(value: unknown, label: string): string {
  const raw = String(value ?? '');
  if (!raw) throw new AdmsCommandError(`${label} is empty.`);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    throw new AdmsCommandError(`${label} is not valid base64.`);
  }
  return raw.replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

export type AdmsCommand =
  | { kind: 'reboot' }
  | { kind: 'check' }
  | { kind: 'query_attlog' }
  | { kind: 'clear_log' }
  | { kind: 'set_time'; at: string }
  | { kind: 'set_options'; options: Record<string, string | number> }
  | {
      kind: 'update_userinfo';
      pin: string;
      name: string;
      privilege?: number;
      card?: string;
      group?: string;
      timezone?: number;
    }
  | { kind: 'delete_userinfo'; pin: string }
  | { kind: 'update_fingerprint'; pin: string; fid: number; template: string; size?: number }
  | { kind: 'query_fingerprint'; pin?: string }
  | {
      kind: 'update_biodata';
      pin: string;
      no: number;
      index: number;
      content: string;
      type?: number;
      valid?: number;
    };

export type AdmsCommandKind = AdmsCommand['kind'];

/** A validated, ready-to-queue command line. */
export interface QueueEntry {
  commandStr: string;
  payload: AdmsCommand;
}

const TAB = '\t';

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new AdmsCommandError('set_time received an invalid date.');
  const pad = (n: number) => String(n).padStart(2, '0');
  // The terminal's own clock, expressed in the deployment convention (UTC).
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * Build the command line(s) for one typed command.
 * `set_options` expands to one line per option, because the protocol sets a
 * single option per command.
 */
export function buildQueueEntries(command: AdmsCommand): QueueEntry[] {
  switch (command.kind) {
    case 'reboot':
      return [{ commandStr: 'REBOOT', payload: command }];

    case 'check':
      return [{ commandStr: 'CHECK', payload: command }];

    case 'query_attlog':
      return [{ commandStr: 'DATA QUERY ATTLOG', payload: command }];

    case 'clear_log':
      return [{ commandStr: 'CLEAR LOG', payload: command }];

    case 'set_time': {
      const formatted = formatDateTime(command.at);
      return [{ commandStr: `SET OPTIONS DateTime=${formatted}`, payload: command }];
    }

    case 'set_options': {
      const entries = Object.entries(command.options ?? {});
      if (entries.length === 0) {
        throw new AdmsCommandError('set_options requires at least one option.');
      }
      return entries.map(([key, value]) => {
        const safeKey = requireField(key, 'Option name', 32);
        const safeValue = sanitizeField(value, 64);
        return {
          commandStr: `SET OPTIONS ${safeKey}=${safeValue}`,
          payload: { kind: 'set_options', options: { [key]: value } } as AdmsCommand,
        };
      });
    }

    case 'update_userinfo': {
      const pin = requireField(command.pin, 'PIN', 24);
      const name = sanitizeField(command.name, 48) || `User ${pin}`;
      const privilege = requireInteger(command.privilege ?? 0, 'Privilege', 0, 14);
      const card = sanitizeField(command.card ?? '', 24);
      const group = sanitizeField(command.group ?? '1', 8);
      const timezone = requireInteger(command.timezone ?? 1, 'Timezone', 0, 24);
      const fields = [
        `PIN=${pin}`,
        `Name=${name}`,
        `Pri=${privilege}`,
        'Passwd=',
        `Card=${card}`,
        `Grp=${group}`,
        `TZ=${timezone}`,
      ];
      return [{ commandStr: `DATA UPDATE USERINFO ${fields.join(TAB)}`, payload: { ...command, pin, name } }];
    }

    case 'delete_userinfo': {
      const pin = requireField(command.pin, 'PIN', 24);
      return [{ commandStr: `DATA DELETE USERINFO PIN=${pin}`, payload: { ...command, pin } }];
    }

    case 'update_fingerprint': {
      const pin = requireField(command.pin, 'PIN', 24);
      const fid = requireInteger(command.fid, 'Finger index', 0, 9);
      const template = requireBase64(command.template, 'Template');
      const size = Number.isInteger(command.size) ? Number(command.size) : Math.floor((template.length * 3) / 4);
      const fields = [`PIN=${pin}`, `FID=${fid}`, `Size=${size}`, 'Valid=1', `TMP=${template}`];
      return [
        {
          commandStr: `DATA UPDATE FINGERPRINT ${fields.join(TAB)}`,
          payload: { ...command, pin, fid, template, size },
        },
      ];
    }

    case 'query_fingerprint': {
      const pin = command.pin ? requireField(command.pin, 'PIN', 24) : null;
      return [
        {
          commandStr: pin ? `DATA QUERY FINGERPRINT PIN=${pin}` : 'DATA QUERY FINGERPRINT',
          payload: command,
        },
      ];
    }

    case 'update_biodata': {
      const pin = requireField(command.pin, 'PIN', 24);
      const no = requireInteger(command.no, 'Biodata number', 0, 9);
      const index = requireInteger(command.index, 'Biodata index', 0, 9);
      const content = requireBase64(command.content, 'Biodata');
      const type = requireInteger(command.type ?? 9, 'Biodata type', 1, 50);
      const valid = requireInteger(command.valid ?? 1, 'Valid', 0, 1);
      const fields = [
        `Type=${type}`,
        `Pin=${pin}`,
        `No=${no}`,
        `Index=${index}`,
        `Valid=${valid}`,
        'Duress=0',
        `Content=${content}`,
      ];
      return [
        {
          commandStr: `DATA UPDATE BIODATA ${fields.join(TAB)}`,
          payload: { ...command, pin, no, index, content },
        },
      ];
    }

    default: {
      const exhaustive: never = command;
      throw new AdmsCommandError(`Unsupported command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Human label for the device console. */
export function describeCommand(command: AdmsCommand): string {
  switch (command.kind) {
    case 'reboot':
      return 'Reboot terminal';
    case 'check':
      return 'Check terminal';
    case 'query_attlog':
      return 'Pull attendance logs';
    case 'clear_log':
      return 'Clear terminal log';
    case 'set_time':
      return 'Sync clock';
    case 'set_options':
      return `Set ${Object.keys(command.options).join(', ')}`;
    case 'update_userinfo':
      return `Push employee ${command.pin}`;
    case 'delete_userinfo':
      return `Delete employee ${command.pin}`;
    case 'update_fingerprint':
      return `Push fingerprint ${command.pin}#${command.fid}`;
    case 'query_fingerprint':
      return command.pin ? `Pull fingerprint ${command.pin}` : 'Pull all fingerprints';
    case 'update_biodata':
      return `Push biometric data ${command.pin}`;
    default:
      return 'Command';
  }
}

/**
 * Parse a device reply line.
 * The terminal answers a command with something like
 * `ID=3&Return=0&CMD=REBOOT`.
 */
export function parseDeviceReply(body: string): {
  id: number | null;
  success: boolean | null;
  raw: string;
} {
  const text = (body ?? '').trim();
  const idMatch = text.match(/(?:^|[&\s])ID=(\d+)/i);
  const returnMatch = text.match(/(?:^|[&\s])Return=(-?\d+)/i);

  let success: boolean | null = null;
  if (returnMatch) success = Number(returnMatch[1]) === 0;
  else if (/(^|[&\s])(OK|SUCCESS)([&\s]|$)/i.test(text)) success = true;

  return {
    id: idMatch ? Number(idMatch[1]) : null,
    success,
    raw: text,
  };
}
