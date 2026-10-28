// Email seam. Emails go through the notification outbox and Resend (src/lib/outbox.ts, ADR 0004).
// `from` defaults to the outbox's sender; `replyTo` is where replies land; `cc` is copied.
export type Email = { to: string | string[]; subject: string; text: string; from?: string; replyTo?: string; cc?: string[] }
export type SendEmail = (email: Email) => Promise<void>

/** For logs: `d***@example.com`. */
export function redactEmail(address: string) {
  const [local, domain] = address.split('@')
  return `${local.slice(0, 1)}***@${domain ?? ''}`
}
