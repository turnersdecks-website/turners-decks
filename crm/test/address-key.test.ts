import { describe, expect, it } from 'vitest'
import { addressKey, addressKeyOfText, normalizeUnit, streetLine } from '#/lib/address-key'

// Plan 006 D1/D3: "same address" means equal addressKey(), never equal text.

describe('addressKey', () => {
  it('treats USPS suffix abbreviations as the same street', () => {
    expect(addressKey({ street: '12 Main Street', zip: '19518' })).toBe(addressKey({ street: '12 Main St', zip: '19518' }))
    expect(addressKey({ street: '3 Sweet Pea Lane', zip: '19518' })).toBe(addressKey({ street: '3 sweet pea ln.', zip: '19518' }))
    expect(addressKey({ street: '9 Main Street', zip: '19518' })).toBe(addressKey({ street: '9 Main St', zip: '19518' }))
    expect(addressKey({ street: '5 Shore Road', zip: '19518' })).toBe(addressKey({ street: '5 Shore Rd', zip: '19518' }))
    expect(addressKey({ street: '7 Pine Drive', zip: '19518' })).toBe(addressKey({ street: '7 Pine Dr', zip: '19518' }))
  })

  it('treats directionals, case, punctuation and whitespace as the same', () => {
    expect(addressKey({ street: '12  North Main Street,', zip: '19518' })).toBe(addressKey({ street: '12 N. MAIN ST', zip: '19518' }))
    expect(addressKey({ street: '40 South West Road', zip: '19518' })).toBe(addressKey({ street: '40 S W Rd', zip: '19518' }))
  })

  it('unifies unit markers: Apt 2, #2, Unit 2, Ste 2, and a separate unit field', () => {
    const apt = addressKey({ street: '12 Main St Apt 2', zip: '19518' })
    expect(addressKey({ street: '12 Main St #2', zip: '19518' })).toBe(apt)
    expect(addressKey({ street: '12 Main St # 2', zip: '19518' })).toBe(apt)
    expect(addressKey({ street: '12 Main St Unit 2', zip: '19518' })).toBe(apt)
    expect(addressKey({ street: '12 Main St Suite 2', zip: '19518' })).toBe(apt)
    expect(addressKey({ street: '12 Main Street', unit: 'Apt 2', zip: '19518' })).toBe(apt)
    expect(addressKey({ street: '12 Main Street', unit: '2', zip: '19518' })).toBe(apt)
    expect(apt).not.toBe(addressKey({ street: '12 Main St', zip: '19518' }))
    expect(apt).not.toBe(addressKey({ street: '12 Main St Apt 3', zip: '19518' }))
  })

  it('uses the first five digits of the zip; a different zip or street number is a different address', () => {
    expect(addressKey({ street: '12 Main St', zip: '19518-1234' })).toBe(addressKey({ street: '12 Main St', zip: '19518' }))
    expect(addressKey({ street: '12 Main St', zip: '04047' })).not.toBe(addressKey({ street: '12 Main St', zip: '19518' }))
    expect(addressKey({ street: '14 Main St', zip: '19518' })).not.toBe(addressKey({ street: '12 Main St', zip: '19518' }))
  })

  it('has no key without a street', () => {
    expect(addressKey({ street: null, zip: '19518' })).toBeNull()
    expect(addressKey({ street: '  ', unit: '2', zip: '19518' })).toBeNull()
  })

  it('reads the key back from full address text (snapshots, "street, city, ST zip")', () => {
    expect(addressKeyOfText('12 Main Street Apt 2, Douglassville, PA 19518')).toBe(addressKey({ street: '12 Main St', unit: '#2', zip: '19518' }))
    expect(addressKeyOfText('12 Main St, Douglassville')).toBe(addressKey({ street: '12 Main St', zip: null }))
    expect(addressKeyOfText(null)).toBeNull()
  })

  it('streetLine puts a unit after the street with a marker', () => {
    expect(streetLine('12 Main St', '2')).toBe('12 Main St #2')
    expect(streetLine('12 Main St', 'Apt 2')).toBe('12 Main St Apt 2')
    expect(streetLine('12 Main St', null)).toBe('12 Main St')
    expect(streetLine(null, '2')).toBeNull()
  })

  it('a bare letter unit gets a # marker like a bare number; real markers are kept', () => {
    expect(streetLine('12 Main St', 'B')).toBe('12 Main St #B')
    expect(streetLine('12 Main St', '#B')).toBe('12 Main St #B')
    expect(streetLine('12 Main St', 'Apt B')).toBe('12 Main St Apt B')
    expect(streetLine('12 Main St', 'Ste. 4')).toBe('12 Main St Ste. 4')
    expect(normalizeUnit('B')).toBe('#B')
    expect(normalizeUnit('Apt B')).toBe('Apt B')
    expect(normalizeUnit('Apartment')).toBe('#Apartment')
  })

  it('unit "B", "#B" and "Apt B" give one key, stored or read back from the snapshot text', () => {
    const key = addressKey({ street: '12 Main St', unit: 'B', zip: '19518' })
    for (const unit of ['B', '#B', 'Apt B']) {
      expect(addressKey({ street: '12 Main St', unit, zip: '19518' })).toBe(key)
      expect(addressKey({ street: '12 Main St', unit: normalizeUnit(unit), zip: '19518' })).toBe(key)
      expect(addressKeyOfText(`${streetLine('12 Main St', unit)}, Douglassville, PA 19518`)).toBe(key)
    }
  })
})
