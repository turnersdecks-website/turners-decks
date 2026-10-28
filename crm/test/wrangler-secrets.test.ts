import { expect, it } from 'vitest'
import raw from '../wrangler.jsonc?raw'

// Declared secrets limit what `.dev.vars` may set locally. RESEND_API_KEY is optional (missing = email stays queued),
// so it is declared for local dev only (a missing one is a warning there) and never listed where a deploy would refuse
// to go out without it. Pine & Gable's Google and Twilio keys come back with Estimates and Texting.
type Env = { secrets?: { required?: string[] } }
const config = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')) as Env & { env: Record<string, Env> }

const OPTIONAL = ['RESEND_API_KEY']

it('local dev declares the optional Resend key so .dev.vars can set it', () => {
  expect(config.env.development.secrets?.required).toEqual(expect.arrayContaining(OPTIONAL))
})

it('production and staging do not require them', () => {
  for (const e of [config, config.env.staging]) {
    for (const key of OPTIONAL) expect(e.secrets?.required).not.toContain(key)
  }
})

// Quote files (plan 009 decision 10): every environment binds LEAD_FILES to its own private R2 bucket.
it('every environment declares a LEAD_FILES R2 bucket, each with a distinct name', () => {
  type R2Config = { r2_buckets?: { binding: string; bucket_name: string }[] }
  const envs = [config, config.env.development, config.env.staging] as R2Config[]
  const names = envs.map((e) => e.r2_buckets?.find((b) => b.binding === 'LEAD_FILES')?.bucket_name)

  expect(names).toEqual(['turners-decks-crm-files', 'turners-decks-crm-files-dev', 'turners-decks-crm-files-staging'])
  expect(new Set(names).size).toBe(names.length)
})
