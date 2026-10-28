import { expect, it } from 'vitest'
import { splitAddress, validEmail } from '#/lib/intake'

// Plan 010 F2/F3: the public intake's email and address parsing stays linear on hostile input.

function ms(fn: () => unknown) {
  const start = performance.now()
  fn()
  return performance.now() - start
}

it('validEmail keeps ordinary addresses and refuses malformed ones', () => {
  expect(validEmail('a@b.co')).toBe('a@b.co')
  expect(validEmail('first.last@sub.example.com')).toBe('first.last@sub.example.com')
  expect(validEmail('a@b')).toBeNull()
  expect(validEmail('a b@c.com')).toBeNull()
  expect(validEmail('a@b..com')).toBeNull()
  expect(validEmail(`${'a'.repeat(250)}@b.co`)).toBeNull()
})

it('validEmail answers fast on a 65 KB run of dots', () => {
  expect(ms(() => validEmail(`a@${'.'.repeat(65_000)}@`))).toBeLessThan(50)
})

it('splitAddress splits a normal address and keeps anything else whole', () => {
  expect(splitAddress('12 Main St, Douglassville, PA 19518')).toEqual({ street: '12 Main St', city: 'Douglassville', state: 'PA', zip: '19518' })
  expect(splitAddress('12 Main St, Douglassville, pa.')).toEqual({ street: '12 Main St', city: 'Douglassville', state: 'PA', zip: null })
  expect(splitAddress('somewhere by the sea')).toEqual({ street: 'somewhere by the sea', city: null, state: null, zip: null })
})

it('splitAddress answers fast on a 65 KB run of spaces and keeps at most 300 characters', () => {
  const hostile = `a,${' '.repeat(65_000)}b`
  let parts: ReturnType<typeof splitAddress> | undefined
  expect(ms(() => (parts = splitAddress(hostile)))).toBeLessThan(50)
  expect(parts!.street!.length).toBeLessThanOrEqual(300)
})
