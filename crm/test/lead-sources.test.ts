import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ORIGIN_LABELS, originOf, originOfLead, reportedSource } from '#/lib/lead-origin'
import { estimatorPayload, mockSiteverify, postIntake, randomPhone } from './intake-helpers'
import { BASE, signedInStaff } from './staff'

// docs/adr/0005-lead-sources.md: every Lead says how it reached us (channel) and where they found us (origin).

describe('where they found us', () => {
  it.each([
    [{ referring_url: 'https://www.google.com/' }, 'google_search'],
    [{ utm_source: 'gbp', utm_medium: 'organic' }, 'google_business_profile'],
    [{ gclid: 'abc', referring_url: 'https://www.google.com/' }, 'google_ads'],
    [{ utm_source: 'google', utm_medium: 'cpc' }, 'google_ads'],
    [{ utm_source: 'facebook', utm_medium: 'paid_social' }, 'facebook_ads'],
    [{ fbclid: 'x', referring_url: 'https://l.facebook.com/' }, 'facebook'],
    [{ referring_url: 'https://m.facebook.com/' }, 'facebook'],
    [{ referring_url: 'https://www.bing.com/' }, 'other_search'],
    [{ referring_url: 'https://nextdoor.com/p/1' }, 'other_website'],
    [{ utm_source: 'yard_sign', utm_medium: 'qr' }, 'tagged_link'],
    [{ landing_page_url: 'https://turnersdecks.com/' } as Record<string, string>, 'direct'],
    [{ referring_url: 'https://turnersdecks.com/' }, 'direct'],
  ] as const)('%j is %s', (touch, origin) => {
    expect(originOf(touch, ['turnersdecks.com'])).toBe(origin)
  })

  it('reads the first touch before the visit that sent the form; a text or call with no visit is unknown', () => {
    expect(originOfLead({ firstTouchJson: JSON.stringify({ utm_source: 'gbp' }), attributionJson: JSON.stringify({ referring_url: 'https://www.google.com/' }) })).toBe('google_business_profile')
    expect(originOfLead({ firstTouchJson: null, attributionJson: JSON.stringify({ referring_url: 'https://www.google.com/' }) })).toBe('google_search')
    expect(originOfLead({ firstTouchJson: null, attributionJson: null })).toBe('unknown')
  })

  it('what the person told us counts when the website could not tell', () => {
    expect(reportedSource({ origin: 'unknown', howFound: 'Google Business Profile' })).toBe('Google Business Profile')
    expect(reportedSource({ origin: 'direct', howFound: 'Referral' })).toBe('Referral')
    expect(reportedSource({ origin: 'google_ads', howFound: 'Referral' })).toBe(ORIGIN_LABELS.google_ads)
  })
})

describe('a website Lead records its form and where they first found us', () => {
  it('an estimator Lead from a Business Profile visit shows Price estimator and Google Business Profile', async () => {
    mockSiteverify()
    const phone = randomPhone()
    const res = await postIntake(
      estimatorPayload({
        phone,
        first_name: 'Gina',
        last_name: 'Gbp',
        landing_page_url: 'https://turnersdecks.com/estimator',
        referring_url: 'https://www.google.com/',
        first_touch: JSON.stringify({ landing_page_url: 'https://turnersdecks.com/?utm_source=gbp&utm_medium=organic', utm_source: 'gbp', utm_medium: 'organic' }),
      }),
    )
    expect(res.status).toBe(200)
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE phone_e164 = ?').bind(`+1${phone}`).first<Record<string, any>>()
    expect(lead).toMatchObject({ channel: 'estimator' })
    expect(originOfLead({ firstTouchJson: lead!.first_touch_json, attributionJson: lead!.attribution_json })).toBe('google_business_profile')

    const { cookie } = await signedInStaff('staff')
    const report = await SELF.fetch(`${BASE}/lead-sources`, { headers: { cookie } }).then((r) => r.text())
    expect(report).toMatch(/data-source="Google Business Profile"/)
    expect(report).toMatch(/data-source="Price estimator"/)
    // Another year has its own report; this Lead is not in it.
    const earlier = await SELF.fetch(`${BASE}/lead-sources?year=2001`, { headers: { cookie } }).then((r) => r.text())
    expect(earlier).toMatch(/No Leads in (<!-- -->)?2001/)
  })
})
