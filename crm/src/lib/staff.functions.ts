import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { asc } from 'drizzle-orm'
import { getDb } from '#/db/client'
import { user } from '#/db/schema'
import { requireAdmin, requireStaff } from '#/lib/guards'

/** The signed-in Staff member; 401 without a session. Used by the private layout's beforeLoad. */
export const getCurrentStaff = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(({ context: { staff } }) => ({
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role ?? 'staff',
  }))

/** Every Staff member with their role (admin only). Staff management in Settings builds on this (Slice 6). */
export const listStaff = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() =>
    getDb(env.DB)
      .select({ id: user.id, name: user.name, email: user.email, role: user.role, banned: user.banned })
      .from(user)
      .orderBy(asc(user.email)),
  )
