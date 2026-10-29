import { createFileRoute } from '@tanstack/react-router'
import { ExpiredLink, PhotoUploader } from '#/components/PhotoUploader'
import { getPhotoRequest } from '#/lib/photos.functions'

// Public page (PLAN.md > Route policy; GLOSSARY Photo link): Pat's upload page, opened from the text Kristin sends.
// The token in the URL is the only credential and can only add photos to its one Lead or Job.
export const Route = createFileRoute('/p/$token')({
  head: () => ({ meta: [{ title: 'Upload photos - Turner’s Decks' }, { name: 'robots', content: 'noindex' }, { name: 'referrer', content: 'no-referrer' }] }),
  loader: ({ params }) => getPhotoRequest({ data: { t: params.token } }),
  component: PhotoLinkPage,
})

function PhotoLinkPage() {
  const view = Route.useLoaderData()
  const { token } = Route.useParams()
  if (!view) return <ExpiredLink />
  return <PhotoUploader title={view.title} credentials={`t=${encodeURIComponent(token)}`} existingIds={view.photoIds} initiallyDone={view.done} />
}
