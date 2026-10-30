// Customer email templates (GLOSSARY Customer email template), edited in Settings. Client-safe. The Website calculator
// email is stored in company settings (it predates this list, see estimator/email-template.ts); the others are rows
// of email_templates, with these defaults until someone saves their own. Same format as the calculator email: a
// first line "Subject: ..." sets the subject and {placeholders} are filled per customer (renderTemplate).

export type TemplateKey = 'appointment_confirmation' | 'appointment_reminder' | 'estimate_followup' | 'review_request'

export type TemplateDef = {
  key: TemplateKey
  name: string
  /** When it goes out, in plain words; says so when nothing sends it yet. */
  when: string
  placeholders: readonly string[]
  defaultTemplate: string
}

export const EMAIL_TEMPLATES: TemplateDef[] = [
  {
    key: 'appointment_confirmation',
    name: 'Appointment confirmation',
    when: 'When an appointment is booked. Not sent yet: comes with Appointments.',
    placeholders: ['first_name', 'appointment_date', 'appointment_time', 'address', 'company_name', 'company_phone'],
    defaultTemplate: `Subject: Your appointment with {company_name}
Hi {first_name},

You're all set. Pat will see you on {appointment_date} at {appointment_time} at {address} to look at your project and take measurements.

Need to change the time? Call or text {company_phone}.

{company_name}`,
  },
  {
    key: 'appointment_reminder',
    name: 'Appointment reminder (night before)',
    when: 'The evening before an appointment. Not sent yet: comes with Appointments.',
    placeholders: ['first_name', 'appointment_date', 'appointment_time', 'address', 'company_name', 'company_phone'],
    defaultTemplate: `Subject: See you tomorrow, {first_name}
Hi {first_name},

A reminder that Pat will be at {address} tomorrow, {appointment_date}, at {appointment_time}.

If something came up, call or text {company_phone}.

{company_name}`,
  },
  {
    key: 'estimate_followup',
    name: 'Estimate follow-up',
    when: 'A few days after the official estimate goes out. Not sent yet: comes with workflows.',
    placeholders: ['first_name', 'company_name', 'company_phone'],
    defaultTemplate: `Subject: Any questions about your estimate?
Hi {first_name},

Just checking in on the estimate Pat sent over. Happy to walk through options, materials or timing, or adjust anything.

Call or text {company_phone} anytime.

{company_name}`,
  },
  {
    key: 'review_request',
    name: 'Review request',
    when: 'After a Job is done. Not sent yet: comes with workflows.',
    placeholders: ['first_name', 'review_link', 'company_name'],
    defaultTemplate: `Subject: How did we do, {first_name}?
Hi {first_name},

Thank you for choosing {company_name}. If you're happy with your new deck, a quick Google review helps a small local business more than you'd think:

{review_link}

Thank you!
{company_name}`,
  },
]

export const isTemplateKey = (v: unknown): v is TemplateKey => typeof v === 'string' && EMAIL_TEMPLATES.some((t) => t.key === v)
export const templateDef = (key: TemplateKey) => EMAIL_TEMPLATES.find((t) => t.key === key)!
