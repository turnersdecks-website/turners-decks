import { desc, sql } from 'drizzle-orm'
import type { getDb } from '#/db/client'
import { customers, leads } from '#/db/schema'
import { customerName } from '#/lib/customer-vocab'
import type { ContactRow } from '#/lib/contact-vocab'
import { OPEN_STAGES } from '#/lib/pipeline'

// Contacts (GLOSSARY Contact): one list of every person, for lookup and marketing lists. Not a table of its own: it
// reads Customers, and Leads that have no Customer. A person's type is worked out, never picked:
// - Customer: has a Customer record (won a Lead, added by hand or imported)
// - Customer with open lead: a Customer who is asking about another project
// - Open lead: no Customer yet, Lead at New, Contacted, Appointment or Quoted
// - Closed lead: no Customer, Lead Lost
// Marketing: `marketable` is false for Do not contact Leads and Customers not OK to contact (e.g. got a deck from
// someone else). `textOk` is the number's latest text consent (consent_events), the rule for any text campaign.

type Db = ReturnType<typeof getDb>

const LIMIT = 2000

export async function listContactRows(db: Db): Promise<ContactRow[]> {
  const textOk = (phoneCol: unknown) =>
    sql<number>`coalesce((SELECT event = 'grant' FROM consent_events ce WHERE ce.phone_e164 = ${phoneCol} AND ce.program = 'sms_followup'
      ORDER BY ce.occurred_at DESC, ce.recorded_at DESC LIMIT 1), 0)`
  const [custRows, leadRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        email: customers.email,
        city: customers.city,
        howFound: customers.howFound,
        okToContact: customers.okToContact,
        customerSince: customers.customerSince,
        createdAt: customers.createdAt,
        textOk: textOk(customers.phoneE164),
      })
      .from(customers)
      .orderBy(desc(customers.createdAt))
      .limit(LIMIT),
    db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        phone: leads.phone,
        email: leads.email,
        city: leads.city,
        source: leads.source,
        stage: leads.stage,
        customerId: leads.customerId,
        doNotContact: leads.doNotContact,
        createdAt: leads.createdAt,
        textOk: textOk(leads.phoneE164),
      })
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(LIMIT),
  ])
  const isOpen = (stage: string) => (OPEN_STAGES as readonly string[]).includes(stage)
  const openByCustomer = new Set(leadRows.filter((l) => l.customerId && isOpen(l.stage)).map((l) => l.customerId))
  // A Customer is not marketable if any of their Leads is Do not contact.
  const dncByCustomer = new Set(leadRows.filter((l) => l.customerId && l.doNotContact).map((l) => l.customerId))
  const latestLeadByCustomer = new Map<string, number>()
  for (const l of leadRows) {
    if (!l.customerId) continue
    const t = l.createdAt.getTime()
    if ((latestLeadByCustomer.get(l.customerId) ?? 0) < t) latestLeadByCustomer.set(l.customerId, t)
  }

  const rows: ContactRow[] = custRows.map((c) => ({
    key: `c:${c.id}`,
    kind: 'customer',
    id: c.id,
    name: customerName(c),
    type: openByCustomer.has(c.id) ? 'customer_open_lead' : 'customer',
    phone: c.phone,
    email: c.email,
    town: c.city,
    origin: c.howFound,
    marketable: c.okToContact && !dncByCustomer.has(c.id),
    textOk: Boolean(c.textOk),
    lastAt: Math.max(latestLeadByCustomer.get(c.id) ?? 0, c.customerSince?.getTime() ?? 0, c.createdAt.getTime()) || null,
  }))
  for (const l of leadRows) {
    if (l.customerId) continue
    rows.push({
      key: `l:${l.id}`,
      kind: 'lead',
      id: l.id,
      name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unnamed Lead',
      type: isOpen(l.stage) ? 'open_lead' : 'closed_lead',
      phone: l.phone,
      email: l.email,
      town: l.city,
      origin: l.source,
      marketable: !l.doNotContact,
      textOk: Boolean(l.textOk),
      lastAt: l.createdAt.getTime(),
    })
  }
  return rows.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
}
