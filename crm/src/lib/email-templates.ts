// Customer email templates (GLOSSARY Customer email template), edited in Settings. Client-safe. The Website calculator
// email is stored in company settings (it predates this list, see estimator/email-template.ts); the others are rows
// of email_templates, with these defaults until someone saves their own. Same format as the calculator email: a
// first line "Subject: ..." sets the subject and {placeholders} are filled per customer (renderTemplate).

export type TemplateKey = 'appointment_confirmation' | 'appointment_reminder' | 'estimate_followup' | 'review_request' | 'lost_thank_you'

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
    when: 'When an appointment is booked on a Lead (with Email ticked).',
    placeholders: ['first_name', 'appointment_date', 'appointment_time', 'address', 'company_name', 'company_phone'],
    defaultTemplate: `Subject: Your appointment with {company_name}
Hi {first_name},

You're all set. We'll see you on {appointment_date} at {appointment_time} at {address} to look at your project and take measurements.

Need to change the time? Call or text {company_phone}.

{company_name}`,
  },
  {
    key: 'appointment_reminder',
    name: 'Appointment reminder (24 hours before)',
    when: '24 hours before a booked appointment (with Email ticked).',
    placeholders: ['first_name', 'appointment_date', 'appointment_time', 'address', 'company_name', 'company_phone'],
    defaultTemplate: `Subject: See you tomorrow, {first_name}
Hi {first_name},

A reminder that we'll see you tomorrow, {appointment_date}, at {appointment_time} at {address}.

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
    key: 'lost_thank_you',
    name: 'Lost: thank-you',
    when: 'When a Lead is moved to Lost and Staff choose to send it (the Lost window asks each time).',
    placeholders: ['first_name', 'company_name', 'company_phone'],
    defaultTemplate: `Subject: Thanks for considering {company_name}
Hi {first_name},

Thanks for letting us know, and for considering {company_name}. We appreciate it.

If you're open to sharing, it would help us to know what tipped the decision (price, timing, or something else). No pressure at all.

If anything changes with your plans or schedule, just reach out at {company_phone} or reply to this email. We'd be glad to help. Best of luck with your project!

Kristin and Pat
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
