import { createFileRoute, redirect } from '@tanstack/react-router'

// Customers are listed under Contacts now (with Leads who have not bought). Customer pages stay at /customers/$id.
export const Route = createFileRoute('/_staff/customers')({
  beforeLoad: () => {
    throw redirect({ to: '/contacts' })
  },
})
