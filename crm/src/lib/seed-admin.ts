import { eq, or } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { user } from '#/db/schema'
import { createAuth, type AuthEnv } from '#/lib/auth'

/** Seed secrets (`wrangler secret put`); empty or unset means no seeding. */
export type SeedSecrets = { SEED_ADMIN_EMAIL?: string; SEED_ADMIN_PASSWORD?: string }

/**
 * Public sign-up is off, so the first admin comes from secrets (ADR 0002). Creates them only
 * when both secrets are set, no admin exists and the email is unused; never changes an existing
 * Staff member, so re-running (or a later password change) is safe.
 */
export async function seedFirstAdmin(env: AuthEnv & SeedSecrets): Promise<'created' | 'skipped'> {
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const password = env.SEED_ADMIN_PASSWORD
  if (!email || !password) return 'skipped'

  const existing = await getDb(env.DB)
    .select({ id: user.id })
    .from(user)
    .where(or(eq(user.role, 'admin'), eq(user.email, email)))
    .limit(1)
  if (existing.length) return 'skipped'

  try {
    await createAuth(env).api.createUser({ body: { email, password, name: 'Admin', role: 'admin' } })
    return 'created'
  } catch (error) {
    // A concurrent cold start may have created them first (user.email is UNIQUE).
    const raced = await getDb(env.DB).select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
    if (raced.length) return 'skipped'
    throw error
  }
}
