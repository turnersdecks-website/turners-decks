import { createFileRoute, redirect } from '@tanstack/react-router'

// Pine & Gable lands on /dashboard (Home); Good Cover v1 has no dashboard, so / and sign-in land on the Pipeline.
export const Route = createFileRoute('/_staff/')({
  beforeLoad: () => {
    throw redirect({ to: '/crm' })
  },
})
