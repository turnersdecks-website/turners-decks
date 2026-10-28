// Input shaping for server functions. Validators must not throw (they run before the auth middleware),
// so they only coerce to a plain record; handlers check fields and throw `badRequest`.

export function record(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

export function badRequest(message: string): Response {
  return new Response(message, { status: 400 })
}

export type FieldErrors = Record<string, string>

/** 400 carrying per-field messages (`{ message, fieldErrors }` JSON; keys like `name` or `bands.2.maxPitch`). */
export function fieldErrorsResponse(fieldErrors: FieldErrors): Response {
  return Response.json({ message: 'Some fields need fixing.', fieldErrors }, { status: 400 })
}

/** Trimmed string, or null when missing/empty. Over `max` characters -> 400. */
export function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw badRequest('Expected text.')
  const s = value.trim()
  if (s.length > max) throw badRequest(`Text is longer than ${max} characters.`)
  return s || null
}

/** A non-empty id string (<= 100 chars) or 400. */
export function requiredId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 100) throw badRequest('Missing id.')
  return value
}

/** Epoch ms or null; anything else -> 400. */
export function optionalTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw badRequest('Expected a date and time.')
  return value
}
