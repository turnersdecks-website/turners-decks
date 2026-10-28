import { hashPassword as scryptHash } from 'better-auth/crypto'
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '#/lib/password'

describe('password hashing (PBKDF2, fits Workers Free CPU)', () => {
  it('hashes with PBKDF2-SHA256 at 100,000 rounds and a fresh salt each time', async () => {
    const [a, b] = [await hashPassword('correct horse battery'), await hashPassword('correct horse battery')]
    expect(a).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(a).not.toBe(b)
  })

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword({ hash, password: 'correct horse battery' })).toBe(true)
    expect(await verifyPassword({ hash, password: 'correct horse batterY' })).toBe(false)
  })

  it('still verifies passwords saved earlier with Better Auth scrypt', async () => {
    const hash = await scryptHash('old password 123')
    expect(await verifyPassword({ hash, password: 'old password 123' })).toBe(true)
    expect(await verifyPassword({ hash, password: 'nope' })).toBe(false)
  })

  it('rejects a malformed hash', async () => {
    expect(await verifyPassword({ hash: 'pbkdf2-sha256$100000$bad', password: 'x' })).toBe(false)
  })
})
