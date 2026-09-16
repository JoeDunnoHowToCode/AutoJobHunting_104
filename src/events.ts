/**
 * Single-line structured events for Cloud Logging.
 *
 * On the scheduled VM there is no terminal to watch, so the run has to leave a
 * machine-filterable trail. `[EVENT] event=… key=value` is greppable in Logs
 * Explorer without needing a JSON payload parser, and stays readable locally.
 *
 * Values are kept on one line: a multi-line log entry becomes several entries in
 * Cloud Logging and the fields get separated from their event.
 */

export type EventFields = Record<string, string | number | boolean | null | undefined>;

function renderValue(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  const singleLine = value.replace(/[\r\n]+/g, ' ⏎ ');
  if (!/[\s"]/.test(singleLine)) return singleLine;
  return `"${singleLine.replace(/"/g, '\\"')}"`;
}

export function formatEvent(name: string, fields: EventFields): string {
  const parts = [`event=${name}`];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${renderValue(value)}`);
  }

  return `[EVENT] ${parts.join(' ')}`;
}

/** Convenience wrapper so call sites read as one statement. */
export function logEvent(name: string, fields: EventFields = {}): void {
  console.log(formatEvent(name, fields));
}
