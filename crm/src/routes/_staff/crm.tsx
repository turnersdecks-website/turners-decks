import { createFileRoute, redirect } from '@tanstack/react-router'

// The Pipeline board moved into Leads (one page, Board / List). Old links and bookmarks land on the board.
export const Route = createFileRoute('/_staff/crm')({
  beforeLoad: () => {
    throw redirect({ to: '/leads', search: { view: 'board' } })
  },
})
