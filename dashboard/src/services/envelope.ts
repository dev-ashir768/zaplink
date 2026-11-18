// The gateway answers every JSON request in one envelope:
//   success: { success: true, message, data }
//   error:   { success: false, message, errors: [{ field, message }], data: null, ...extras }
// These helpers read it tolerantly: a body that is not an envelope (an older gateway, a proxy page,
// a test double) is used as it is.

export interface FieldError {
  field: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `body` is an object with a boolean `success` and a `data` key. */
export function isEnvelope(body: unknown): body is { success: boolean; data: unknown; message?: unknown } {
  return isRecord(body) && typeof body.success === 'boolean' && 'data' in body;
}

/** The payload of a success body: its `data` when it is an envelope, else the body itself. */
export function unwrapEnvelope<T>(body: unknown): T {
  return (isEnvelope(body) ? body.data : body) as T;
}

/** The field errors an error body carries (a validation 400), or none. */
export function envelopeErrors(body: unknown): FieldError[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return [];
  return body.errors.filter(
    (e): e is FieldError => isRecord(e) && typeof e.message === 'string' && typeof e.field === 'string',
  );
}

/**
 * The text to show for an error body: its `message`, followed by the first field error when that adds
 * something. An older gateway's list-of-messages body yields its first entry. Empty when there is none.
 */
export function envelopeErrorMessage(body: unknown): string {
  if (!isRecord(body)) return '';
  const raw = body.message;
  const message = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
  const first = envelopeErrors(body)[0];
  if (!first || message.includes(first.message)) return message;
  return message ? `${message}: ${first.message}` : first.message;
}
