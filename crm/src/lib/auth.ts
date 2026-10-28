import { waitUntil } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { adminAc, userAc } from 'better-auth/plugins/admin/access'
import { getDb } from '#/db/client'
import * as schema from '#/db/schema'
import type { SendEmail } from '#/lib/email'
import { type DispatchDeps, type OutboxEnv, outboxSendEmail } from '#/lib/outbox'
import { hashPassword, verifyPassword } from '#/lib/password'

// Staff roles (GLOSSARY: Staff have role admin or staff). adminAc is Better Auth's default admin
// permission set, which includes impersonation; whether to drop it is pending Kevin (FLW-140).
export const roles = { admin: adminAc, staff: userAc }

export type AuthEnv = Pick<Env, 'DB' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'> & OutboxEnv

export const SETUP_LINK_DAYS = 7

/**
 * Emails (password reset) go through the outbox; tests may pass their own `sendEmail` or the outbox's `dispatch` deps.
 * `staffSetup` (plan 006 S13): the same reset-token flow, worded as an account setup email for a newly added Staff
 * member, sent as outbox kind `staff_setup`, link valid SETUP_LINK_DAYS days. Only the invite server functions use it.
 */
export function createAuth(
  env: AuthEnv,
  { sendEmail, dispatch, staffSetup = false }: { sendEmail?: SendEmail; dispatch?: DispatchDeps; staffSetup?: boolean } = {},
) {
  sendEmail ??= outboxSendEmail(env, staffSetup ? 'staff_setup' : 'password_reset', dispatch)
  return betterAuth({
    database: drizzleAdapter(getDb(env.DB), { provider: 'sqlite', schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
      ...(staffSetup ? { resetPasswordTokenExpiresIn: SETUP_LINK_DAYS * 24 * 3600 } : {}),
      sendResetPassword: ({ user, url }) => {
        const queued = sendEmail(
          staffSetup
            ? {
                to: user.email,
                subject: 'Set up your Turner’s Decks CRM account',
                text: `Hi ${user.name},\n\nYou have been added to the Turner’s Decks CRM.\n\nChoose your password to sign in: ${url}\n\nThe link expires in ${SETUP_LINK_DAYS} days. Your sign-in email is ${user.email}.`,
              }
            : {
                to: user.email,
                subject: 'Reset your Turner’s Decks CRM password',
                text: `Someone asked to reset the password for your Turner’s Decks CRM account.\n\nChoose a new password: ${url}\n\nThe link expires in 1 hour. If you did not ask for this, ignore this email.`,
              },
        )
        // Admin invites wait so the server function knows the email was queued.
        if (staffSetup) return queued
        // Plan 010 F5: a public reset request answers without waiting on the outbox write, so a real account is not
        // one D1 write slower than an unknown email (timing would reveal which emails are Staff).
        inBackground(queued.catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'password reset email not queued', error: String(err) }))))
        return Promise.resolve()
      },
    },
    // Auth rate limiting is the Workers Rate Limiting binding in src/lib/auth-rate-limit.ts (plan 010 F1).
    // PLAN: IDs are crypto.randomUUID() text (default is 32-char alphanumeric).
    advanced: { database: { generateId: 'uuid' } },
    plugins: [
      admin({ roles, defaultRole: 'staff', adminRoles: ['admin'] }),
    ],
  })
}

function inBackground(work: Promise<unknown>) {
  try {
    waitUntil(work)
  } catch {
    // Outside a request (tests, scripts) there is no waitUntil; the promise still runs.
  }
}
