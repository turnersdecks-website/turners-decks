// Contacts (contacts.server.ts): types and labels, safe for the browser.

export const CONTACT_TYPES = ['customer', 'customer_open_lead', 'open_lead', 'closed_lead'] as const
export type ContactType = (typeof CONTACT_TYPES)[number]
export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  customer: 'Customer',
  customer_open_lead: 'Customer with open lead',
  open_lead: 'Open lead',
  closed_lead: 'Closed lead',
}

export type ContactRow = {
  key: string
  kind: 'customer' | 'lead'
  id: string
  name: string
  type: ContactType
  phone: string | null
  email: string | null
  town: string | null
  /** How they found us (Customer) or the Lead's source. */
  origin: string | null
  marketable: boolean
  textOk: boolean
  /** Most recent of: Lead received, Customer since. ms. */
  lastAt: number | null
}

