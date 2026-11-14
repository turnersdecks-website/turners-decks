import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '#/components/page'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { errorMessage } from '#/lib/errors'
import { updateProfileName } from '#/lib/settings.functions'

// Your profile (every Staff member): reached from the avatar menu at the bottom of the sidebar. Only your own name;
// company settings are under Settings (admins).
export const Route = createFileRoute('/_staff/profile')({
  head: () => ({ meta: [{ title: 'Your profile - Turner’s Decks CRM' }] }),
  component: ProfilePage,
})

function ProfilePage() {
  const { staff } = Route.useRouteContext()
  const router = useRouter()
  const [name, setName] = useState(staff.name)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await updateProfileName({ data: { name } })
      toast.success('Name saved')
      await router.invalidate()
    } catch (error) {
      toast.error(await errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Your profile" description="Your name, as shown on Leads, notes and Estimates you create." />
      <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Your full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" required />
        <Button variant="outline" disabled={busy}>
          Save
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">Signed in as {staff.email}.</p>
    </div>
  )
}
