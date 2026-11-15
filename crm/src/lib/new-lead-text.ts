import { channelLabel } from '#/lib/lead-origin'
import { prettyPhone, toE164 } from '#/lib/phone'

// The new Lead heads-up text (docs/adr/0004-quo-texting.md): who gets it and what it says. Safe for the browser
// (Settings shows the placeholders and a preview).

export const NEW_LEAD_PLACEHOLDERS = ['how', 'name', 'town', 'project', 'phone', 'email', 'link'] as const
export type NewLeadVars = Record<(typeof NEW_LEAD_PLACEHOLDERS)[number], string>

export const DEFAULT_NEW_LEAD_TEMPLATE = 'New Lead ({how}): {name}, {town}. {project}. {phone}\n{link}'

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
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
    .slice(0, 1600)
}

export function newLeadVars(
  l: { id: string; channel: string | null; firstName: string | null; lastName: string | null; city: string | null; serviceType: string | null; phoneE164: string | null; email?: string | null },
  base: string,
): NewLeadVars {
  return {
    how: channelLabel(l.channel),
    name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unknown name',
    town: l.city ?? '',
    project: l.serviceType ?? '',
    phone: l.phoneE164 ? prettyPhone(l.phoneE164) : '',
    email: l.email ?? '',
    link: `${base.replace(/\/+$/, '')}/leads/${l.id}`,
  }
}

/** Recipients: the saved list, else Pat's cell. Invalid or repeated numbers are dropped. */
export function newLeadRecipients(s: { newLeadTextTo: string | null; ownerMobile: string | null }): string[] {
  const raw = s.newLeadTextTo?.trim() ? s.newLeadTextTo.split(',') : s.ownerMobile ? [s.ownerMobile] : []
  return [...new Set(raw.map((p) => toE164(p.trim())).filter((p): p is string => !!p))]
}
