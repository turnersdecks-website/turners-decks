// The Estimate email template (FLW-200): the owner edits it in company settings. Same rendering as Pine & Gable's
// Estimate email (crm/src/lib/estimate-email.server.ts there): `{placeholder}`s are filled, unknown ones are left
// as typed, and a first line "Subject: ..." becomes the subject.

export const ESTIMATE_EMAIL_PLACEHOLDERS = ['first_name', 'low', 'high', 'review_note', 'company_name', 'company_phone', 'disclaimer'] as const

export const DEFAULT_SUBJECT = 'Your deck estimate'

export const DEFAULT_ESTIMATE_EMAIL_TEMPLATE = `Subject: Your deck estimate from {company_name}
Hi {first_name},

Thanks for using our deck price estimator. Based on your answers, a realistic preliminary range for your project is {low} to {high}.
{review_note}
Pat will reach out to book your free on-site estimate, where we measure and confirm the price. Want to talk sooner? Call {company_phone}.

{disclaimer}

{company_name}`

export function renderTemplate(template: string, vars: Record<string, string>): { subject: string; body: string } {
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m))
  const [first, ...rest] = template.split('\n')
  const hasSubject = /^subject:/i.test(first ?? '')
  const subject = hasSubject ? first!.replace(/^subject:\s*/i, '') : DEFAULT_SUBJECT
  const body = hasSubject ? rest.join('\n').replace(/^\s*\n/, '') : template
  return { subject: fill(subject).trim().slice(0, 200), body: fill(body).replace(/\n{3,}/g, '\n\n').trim() }
}
