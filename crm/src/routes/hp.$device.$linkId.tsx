import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { ExpiredLink, PhotoUploader } from '#/components/PhotoUploader'
import { getPhotoRequest } from '#/lib/photos.functions'

// Public page (GLOSSARY Photo home screen): one request opened from Pat's home screen.
export const Route = createFileRoute('/hp/$device/$linkId')({
  head: () => ({ meta: [{ title: 'Upload photos - Turner’s Decks' }, { name: 'robots', content: 'noindex' }, { name: 'referrer', content: 'no-referrer' }] }),
  loader: ({ params }) => getPhotoRequest({ data: { d: params.device, l: params.linkId } }),
  component: HomePhotoRequest,
})

function HomePhotoRequest() {
  const view = Route.useLoaderData()
  const { device, linkId } = Route.useParams()
  return (
    <div>
      <div className="mx-auto max-w-md px-4 pt-4">
        <Link to="/home/$device" params={{ device }} className="inline-flex min-h-11 items-center gap-1 text-base font-medium text-primary">
          <ChevronLeft className="size-5" aria-hidden />
          All photo requests
        </Link>
      </div>
      {view ? (
        <PhotoUploader
          title={view.title}
          credentials={`d=${encodeURIComponent(device)}&l=${encodeURIComponent(linkId)}`}
          existingIds={view.photoIds}
          initiallyDone={view.done}
        />
      ) : (
        <ExpiredLink />
      )}
    </div>
  )
}
