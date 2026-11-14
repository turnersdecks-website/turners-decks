import { createFileRoute, redirect } from '@tanstack/react-router'

// The project board moved into Jobs (one page, Board / List). Old links and bookmarks land on the board.
export const Route = createFileRoute('/_staff/projects')({
  beforeLoad: () => {
    throw redirect({ to: '/jobs', search: { view: 'board' } })
  },
})
