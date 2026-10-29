import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useCanGoBack,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { ArrowLeft, House, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Toaster } from '#/components/ui/sonner'
import { ThemeProvider } from '#/hooks/use-theme'
import { THEME_BOOT_SCRIPT } from '#/lib/theme'

import appCss from '../styles.css?url'

// Ported from Lovable src/routes/__root.tsx (Toaster, 404 and error pages), in the website's fonts (Inter, Poppins
// for headings). No React Query and no
// Lovable error reporting here.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Turner’s Decks CRM' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap' },
      { rel: 'icon', href: '/favicon.png', type: 'image/png' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

// Admin Kit error pages (kit:src/components/errors/not-found-error.tsx, general-error.tsx, back-button.tsx): large
// code, title, copy, then Go back + Go home. Wording is ours.
function GoBack() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    <Button
      variant="outline"
      onClick={() => (canGoBack ? router.history.back() : router.navigate({ to: '/' }))}
    >
      <ArrowLeft />
      Go back
    </Button>
  )
}

function ErrorPage({ code, icon: Icon, title, children }: { code?: string; icon?: typeof TriangleAlert; title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh w-full flex-col items-center justify-center gap-2 bg-background px-4 py-10 text-center">
      {code && <p className="text-[7rem] leading-tight font-bold tracking-tight text-foreground tabular-nums">{code}</p>}
      {Icon && (
        <span className="mb-2 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Icon className="size-7" aria-hidden />
        </span>
      )}
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {children}
    </main>
  )
}

function NotFound() {
  return (
    <ErrorPage code="404" title="Page not found">
      <p className="max-w-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <GoBack />
        <Button asChild>
          <Link to="/">
            <House />
            Go home
          </Link>
        </Button>
      </div>
    </ErrorPage>
  )
}

function RootError({ error, reset }: ErrorComponentProps) {
  console.error(error)
  const router = useRouter()
  return (
    <ErrorPage icon={TriangleAlert} title="This page didn't load">
      <p className="max-w-sm text-muted-foreground">Something went wrong on our end. You can try refreshing or head back home.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button
          onClick={() => {
            router.invalidate()
            reset()
          }}
        >
          <RotateCw />
          Try again
        </Button>
        <Button asChild variant="outline">
          <a href="/">
            <House />
            Go home
          </a>
        </Button>
      </div>
    </ErrorPage>
  )
}
