import { createFileRoute, Link } from '@tanstack/react-router'
import { Loader2, Mail, MailCheck } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { AuthCard, Field, authLinkClass } from '#/components/auth-card'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: 'Reset your password - Turner’s Decks CRM' }] }),
  component: ForgotPassword,
})

function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get('email')),
      redirectTo: '/reset-password',
    })
    setBusy(false)
    if (error) return setError(error.message ?? 'Could not send the reset email.')
    setSent(true)
  }

  return (
    <AuthCard title="Reset your password" onSubmit={submit} error={error}>
      {sent ? (
        <p className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" role="status">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          If that email belongs to a Staff member, a reset link is on its way.
        </p>
      ) : (
        <>
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <Button className="mt-1 w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Mail />}
            Send reset link
          </Button>
        </>
      )}
      <Link to="/sign-in" className={authLinkClass}>
        Back to sign in
      </Link>
    </AuthCard>
  )
}
