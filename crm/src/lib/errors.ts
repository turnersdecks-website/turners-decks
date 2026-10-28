/** A message for Staff from a failed server function call (thrown Responses carry our 400/409 text). */
export async function errorMessage(error: unknown): Promise<string> {
  return (await errorDetails(error)).message
}

/** Like errorMessage, plus per-field messages when the server sent a field-error reply (see fieldErrorsResponse). */
export async function errorDetails(error: unknown): Promise<{ message: string; fieldErrors: Record<string, string> }> {
  if (error instanceof Response) {
    const text = await error.text().catch(() => '')
    if (!text || error.status >= 500) return { message: `Something went wrong (${error.status}). Try again.`, fieldErrors: {} }
    if (error.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = JSON.parse(text) as { message?: string; fieldErrors?: Record<string, string> }
        return { message: body.message ?? text, fieldErrors: body.fieldErrors ?? {} }
      } catch {
        // fall through to plain text
      }
    }
    return { message: text, fieldErrors: {} }
  }
  return { message: 'Something went wrong. Try again.', fieldErrors: {} }
}
