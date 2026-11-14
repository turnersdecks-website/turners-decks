import { Link } from '@tanstack/react-router'

// Public legal pages for the CRM (/terms, /privacy), the addresses Intuit's app profile asks for
// (docs/adr/0006-quickbooks-sync.md). Plain words; no sign-in.

export const LEGAL = {
  company: 'Turner’s Construction and Remodeling LLC, doing business as Turner’s Decks',
  short: 'Turner’s Decks',
  email: 'turnersdecks@gmail.com',
  updated: 'November 14, 2026',
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-[15px] leading-relaxed">
      <p className="mb-2 text-sm text-muted-foreground">{LEGAL.short} CRM</p>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mb-8 text-sm text-muted-foreground">Last updated {LEGAL.updated}</p>
      <div className="space-y-4 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">{children}</div>
      <p className="mt-12 flex gap-4 text-sm text-muted-foreground">
        <Link to="/terms" className="underline">
          Terms of use
        </Link>
        <Link to="/privacy" className="underline">
          Privacy policy
        </Link>
        <Link to="/sign-in" className="underline">
          Staff sign-in
        </Link>
      </p>
    </main>
  )
}
