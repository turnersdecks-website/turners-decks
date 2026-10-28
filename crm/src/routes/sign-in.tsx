import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { AuthCard, Field, authLinkClass } from '#/components/auth-card'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/sign-in')({
  head: () => ({ meta: [{ title: 'Staff sign in - Turner’s Decks CRM' }] }),
  component: SignIn,
})

function SignIn() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setBusy(false)
    if (error) return setError(error.message ?? 'Sign in failed.')
    navigate({ to: '/crm' })
  }

  return (
    <AuthCard title="Staff sign in" subtitle="Accounts are invite-only" onSubmit={submit} error={error}>
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
      <Button className="mt-1 w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
        Sign in
      </Button>
      <Link to="/forgot-password" className={authLinkClass}>
        Forgot password?
      </Link>
    </AuthCard>
  )
}
