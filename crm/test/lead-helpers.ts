import { env } from 'cloudflare:test'

export const CREATED_AT = 1_790_000_000_000

/** A Lead as Intake would leave it (website source, first touch recorded), with a fixed old updated_at. */
export async function insertLead(cols: { firstName?: string; lastName?: string; stage?: string; phoneE164?: string | null; email?: string | null } = {}) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO leads (id, first_name, last_name, stage, phone, phone_e164, email, email_lower, street, city, source, first_source,
       first_touch_json, attribution_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '12 Main St', 'Douglassville', 'website', 'website', '{"landing_page":"/contact"}', '{"utm_source":"google"}', ?, ?)`,
  )
    .bind(
      id,
      cols.firstName ?? 'Hannah',
      cols.lastName ?? 'Homeowner',
      cols.stage ?? 'new',
      cols.phoneE164 ?? null,
      cols.phoneE164 ?? null,
      cols.email ?? null,
      cols.email?.toLowerCase() ?? null,
      CREATED_AT,
      CREATED_AT,
    )
    .run()
  return id
}

export const leadRow = (id: string) => env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Record<string, unknown>>()

export type StageChange = { from_stage: string | null; to_stage: string; changed_at: number; changed_by: string | null; reason: string | null }

/** A Lead's stage history (lead_stage_changes), oldest first. */
export const stageChanges = (leadId: string) =>
  env.DB.prepare('SELECT from_stage, to_stage, changed_at, changed_by, reason FROM lead_stage_changes WHERE lead_id = ? ORDER BY changed_at, rowid')
    .bind(leadId)
    .all<StageChange>()
    .then((r) => r.results)

/** The user id of the Staff member with this email. */
export const staffIdOf = (email: string) => env.DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).first<string>('id')
