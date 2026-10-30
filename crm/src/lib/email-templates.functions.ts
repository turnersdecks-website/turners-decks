import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { EMAIL_TEMPLATES, isTemplateKey } from '#/lib/email-templates'
import { requireAdmin } from '#/lib/guards'
import { badRequest, optionalText, record } from '#/lib/input'

// Customer email templates for Settings (admins only). A saved template replaces its default; "Reset" deletes the row.

export const listEmailTemplates = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const rows = await env.DB.prepare('SELECT key, template, updated_at AS updatedAt FROM email_templates').all<{ key: string; template: string; updatedAt: number }>()
    const saved = new Map(rows.results.map((r) => [r.key, r]))
    return EMAIL_TEMPLATES.map((t) => ({
      key: t.key,
      template: saved.get(t.key)?.template ?? t.defaultTemplate,
      isDefault: !saved.has(t.key),
      updatedAt: saved.get(t.key)?.updatedAt ?? null,
    }))
  })

export const saveEmailTemplate = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator((data: { key: string; template: string | null }) => record(data))
  .handler(async ({ data, context: { staff } }) => {
    if (!isTemplateKey(data.key)) throw badRequest('Unknown email template.')
    if (data.template === null) {
      await env.DB.prepare('DELETE FROM email_templates WHERE key = ?').bind(data.key).run()
      return { key: data.key, reset: true }
    }
    const template = optionalText(data.template, 5000)
    if (!template) throw badRequest('The email needs some text.')
    await env.DB.prepare(
      `INSERT INTO email_templates (key, template, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
      .bind(data.key, template, Date.now(), staff.id)
      .run()
    return { key: data.key, reset: false }
  })
