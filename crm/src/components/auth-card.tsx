import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

// Shared shell for the public auth pages (sign-in, forgot, reset). Layout from the Admin Kit (auth) pages: a centred
// 480px column with the brand mark above a card; wording and fields from Lovable auth.tsx / set-password.tsx.
export function AuthCard(props: {
  title: string
  subtitle?: string
  error?: string | null
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="flex w-full flex-col gap-4 sm:w-[480px]">
        {/* Turner's Decks has no logo file; the site uses a text wordmark, so the CRM does too. */}
        <div className="flex flex-col items-center gap-2">
          <span className="font-heading text-3xl font-bold tracking-tight">Turner’s Decks</span>
          <span className="text-sm font-medium text-muted-foreground">Staff CRM</span>
        </div>
        <form onSubmit={props.onSubmit} className="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
          <div className="flex flex-col gap-1.5 text-left">
            <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
            {props.subtitle && <p className="text-sm text-muted-foreground">{props.subtitle}</p>}
          </div>
          {props.error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {props.error}
            </p>
          )}
          {props.children}
        </form>
      </div>
    </main>
  )
}

export function Field(props: { label: string; name: string; type: string; autoComplete?: string; minLength?: number }) {
  // Kit password-input: password fields get a show/hide toggle.
  const [shown, setShown] = useState(false)
  const isPassword = props.type === 'password'
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      <div className="relative">
        <Input
          id={props.name}
          name={props.name}
          type={isPassword && shown ? 'text' : props.type}
          autoComplete={props.autoComplete}
          minLength={props.minLength}
          className={isPassword ? 'pr-10' : undefined}
          required
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown(!shown)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
    </div>
  )
}

export const authLinkClass = 'block w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-primary underline'
