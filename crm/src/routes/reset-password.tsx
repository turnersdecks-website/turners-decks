import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { KeyRound, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { AuthCard, Field, authLinkClass } from '#/components/auth-card'
import { Button } from '#/components/ui/button'

// Better Auth's emailed link (/api/auth/reset-password/<token>) lands here with ?token=... or ?error=INVALID_TOKEN.
// `setup=1`: the same flow from a new Staff member's account setup email (plan 006 S13; Lovable set-password.tsx).
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    setup: search.setup === 1 || search.setup === '1' ? (1 as const) : undefined,
  }),
  head: () => ({ meta: [{ title: 'Choose a new password - Turner’s Decks CRM' }] }),
  component: ResetPassword,
})

function ResetPassword() {
  const { token, error: linkError, setup } = Route.useSearch()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!token) return
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    const { error } = await authClient.resetPassword({ token, newPassword: String(form.get('password')) })
    setBusy(false)
    if (error) return setError(error.message ?? 'Could not save the password.')
    navigate({ to: '/sign-in' })
  }

  return (
    <AuthCard
      title={setup ? 'Set your password' : 'Choose a new password'}
      subtitle={setup ? 'Finish joining the Turner’s Decks CRM.' : undefined}
      onSubmit={submit}
      error={error}
    >
      {!token || linkError ? (
        <p className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="status">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {setup
            ? 'This setup link is invalid or has expired. Ask an admin to resend your setup email.'
            : 'This reset link is invalid or has expired. Request a new one.'}
        </p>
      ) : (
        <>
          <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={8} />
          <Button className="mt-1 w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Save password
          </Button>
        </>
      )}
      {setup ? (
        <Link to="/sign-in" className={authLinkClass}>
          Back to sign in
        </Link>
      ) : (
        <Link to="/forgot-password" className={authLinkClass}>
          Request a new link
        </Link>
      )}
    </AuthCard>
  )
}
