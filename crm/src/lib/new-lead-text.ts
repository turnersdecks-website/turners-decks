import { channelLabel } from '#/lib/lead-origin'
import { prettyPhone, toE164 } from '#/lib/phone'

// The new Lead heads-up text (docs/adr/0004-quo-texting.md): who gets it and what it says. Safe for the browser
// (Settings shows the placeholders and a preview).

export const NEW_LEAD_PLACEHOLDERS = ['how', 'name', 'project', 'size', 'material', 'estimate', 'timeframe', 'address', 'town', 'phone', 'email', 'notes', 'link'] as const
export type NewLeadVars = Record<(typeof NEW_LEAD_PLACEHOLDERS)[number], string>

// One fact per line; a line whose fill-in is blank drops out.
export const DEFAULT_NEW_LEAD_TEMPLATE = ['New Lead ({how})', '{name}', '{project}', 'Size: {size}', 'Material: {material}', 'Estimate: {estimate}', 'When: {timeframe}', '{address}', '{phone}', '{link}'].join('\n')

/** Fills the placeholders; a blank one takes its punctuation with it ("Jane, ." -> "Jane."). */
export function renderNewLeadText(template: string | null | undefined, v: NewLeadVars) {
  const t = template?.trim() ? template : DEFAULT_NEW_LEAD_TEMPLATE
  return t
    .replace(/\{(\w+)\}/g, (m, k: string) => ((NEW_LEAD_PLACEHOLDERS as readonly string[]).includes(k) ? (v[k as keyof NewLeadVars] ?? '') : m))
    .split('\n')
    .map((line) =>
      line
        .replace(/\s*,\s*(?=[,.]|$)/g, '')
        .replace(/\.\s*\./g, '.')
        .replace(/\(\s*\)/g, '')
        .replace(/^[\s.,]+/, '')
        .replace(/^[^:\n]{1,20}:\s*$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
    .slice(0, 1600)
}

export type NewLeadLead = {
  id: string
  channel: string | null
  firstName: string | null
  lastName: string | null
  street?: string | null
  city: string | null
  serviceType: string | null
  phoneE164: string | null
  email?: string | null
  preferredMaterial?: string | null
  timeframe?: string | null
  message?: string | null
}

/** Extra facts from the Lead's latest form: the quote form's rough size, or the estimator's square feet and range. */
export type NewLeadExtra = { approxSize?: string | null; sqft?: number | null; low?: number | null; high?: number | null }

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function newLeadVars(l: NewLeadLead, base: string, x: NewLeadExtra = {}): NewLeadVars {
  const notes = (l.message ?? '').replace(/\s+/g, ' ').trim()
  return {
    how: channelLabel(l.channel),
    name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unknown name',
    project: l.serviceType ?? '',
    size: x.sqft ? `${Math.round(x.sqft)} sq ft` : (x.approxSize ?? ''),
    material: l.preferredMaterial ?? '',
    estimate: x.low && x.high ? `${usd(x.low)} to ${usd(x.high)}` : '',
    timeframe: l.timeframe ?? '',
    address: [l.street, l.city].filter(Boolean).join(', '),
    town: l.city ?? '',
    phone: l.phoneE164 ? prettyPhone(l.phoneE164) : '',
    email: l.email ?? '',
    notes: notes.length > 140 ? `${notes.slice(0, 139)}…` : notes,
    link: `${base.replace(/\/+$/, '')}/leads/${l.id}`,
  }
}

/** Recipients: the saved list, else Pat's cell. Invalid or repeated numbers are dropped. */
export function newLeadRecipients(s: { newLeadTextTo: string | null; ownerMobile: string | null }): string[] {
  const raw = s.newLeadTextTo?.trim() ? s.newLeadTextTo.split(',') : s.ownerMobile ? [s.ownerMobile] : []
  return [...new Set(raw.map((p) => toE164(p.trim())).filter((p): p is string => !!p))]
}
