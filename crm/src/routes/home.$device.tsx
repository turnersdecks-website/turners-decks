import { Link, createFileRoute } from '@tanstack/react-router'
import { Camera, ChevronRight } from 'lucide-react'
import { Shell } from '#/components/PhotoUploader'
import { getPhotoHome } from '#/lib/photos.functions'

// Public page (GLOSSARY Photo home screen): saved on Pat's phone, lists every photo link that still works.
export const Route = createFileRoute('/home/$device')({
  head: () => ({
    meta: [
      { title: 'Photos - Turner’s Decks' },
      { name: 'robots', content: 'noindex' },
      { name: 'referrer', content: 'no-referrer' },
      { name: 'apple-mobile-web-app-title', content: 'TD Photos' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
    ],
  }),
  loader: ({ params }) => getPhotoHome({ data: { d: params.device } }),
  component: PhotoHome,
})

function PhotoHome() {
  const home = Route.useLoaderData()
  const { device } = Route.useParams()
  if (!home) {
    return (
      <Shell title="This link was turned off">
        <p className="text-lg text-muted-foreground">Ask Kristin for a new one.</p>
      </Shell>
    )
  }
  return (
    <Shell title="Photos to take">
      {home.requests.length === 0 ? (
        <p className="rounded-2xl bg-muted p-5 text-lg">Nothing waiting right now.</p>
      ) : (
        <ul className="space-y-3">
          {home.requests.map((r) => (
            <li key={r.linkId}>
              <Link
                to="/hp/$device/$linkId"
                params={{ device, linkId: r.linkId }}
                className="flex min-h-20 items-center gap-4 rounded-2xl border bg-card p-4 shadow-xs active:bg-muted"
              >
                <Camera className="size-7 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{r.title}</span>
                  <span className="block text-sm text-muted-foreground">{r.done ? `Done · ${r.photoCount} photos` : `${r.photoCount} photos so far`}</span>
                </span>
                <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">Tip: Share, then “Add to Home Screen” to keep this one tap away.</p>
    </Shell>
  )
}
