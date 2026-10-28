import { createAuthClient } from 'better-auth/react'

// Browser client for the Better Auth endpoints under /api/auth (same origin).
export const authClient = createAuthClient()
