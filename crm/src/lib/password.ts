import { verifyPassword as verifyScrypt } from 'better-auth/crypto'

// Password hashing that fits Workers Free (10 ms CPU per request). Better Auth's default scrypt costs ~30 ms per
// sign-in; native WebCrypto PBKDF2-SHA256 at 100,000 rounds (the most Workers allows) costs ~6 ms.
// ponytail: 100k rounds is below OWASP's 600k for PBKDF2-SHA256; on Workers Paid, switch hashPassword back to
// Better Auth's scrypt. verifyPassword keeps accepting both formats, so no one has to reset a password either way.
const ITERATIONS = 100_000
const PREFIX = 'pbkdf2-sha256'

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${PREFIX}$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }) {
  if (!hash.startsWith(`${PREFIX}$`)) return verifyScrypt({ hash, password })
  const [, rounds, salt, expected] = hash.split('$')
  const iterations = Number(rounds)
  if (!salt || !expected || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false
  try {
    const want = unb64(expected)
    const got = await derive(password, unb64(salt), iterations)
    return got.length === want.length && got.reduce((diff, byte, i) => diff | (byte ^ want[i]), 0) === 0
  } catch {
    return false
  }
}
