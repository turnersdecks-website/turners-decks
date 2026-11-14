// Where every Lead came from (docs/adr/0005-lead-sources.md). Two questions, answered on every Lead:
// - Channel: how they reached us (estimator, quote form, text, call, ...). Set when the Lead is made.
// - Origin: where they found us (Google search, Google Business Profile, Google Ads, Facebook, ...). Worked out from
//   the website visit's first touch (the page they first landed on, the site that sent them, UTM tags and click ids),
//   so it is only known for website Leads; texts and calls are `unknown` until someone fills in How they found us.
// Safe for the browser: the Leads list and the report use the labels.

export const CHANNELS = ['estimator', 'quote_form', 'website', 'text', 'call', 'email', 'manual'] as const
export type Channel = (typeof CHANNELS)[number]
export const CHANNEL_LABELS: Record<Channel, string> = {
  estimator: 'Price estimator',
  quote_form: 'Quote form',
  website: 'Website (form not recorded)',
  text: 'Text',
  call: 'Phone call',
  email: 'Email',
  manual: 'Added by hand',
}

export const ORIGINS = [
  'google_search',
  'google_business_profile',
  'google_ads',
  'facebook',
  'facebook_ads',
  'other_search',
  'other_website',
  'email_campaign',
  'tagged_link',
  'direct',
  'unknown',
] as const
export type Origin = (typeof ORIGINS)[number]
export const ORIGIN_LABELS: Record<Origin, string> = {
  google_search: 'Google search',
  google_business_profile: 'Google Business Profile',
  google_ads: 'Google Ads',
  facebook: 'Facebook / Instagram',
  facebook_ads: 'Facebook ads',
  other_search: 'Other search engine',
  other_website: 'Another website',
  email_campaign: 'Email',
  tagged_link: 'Tagged link',
  direct: 'Direct (typed or bookmarked)',
  unknown: 'Unknown',
}

/** What the website records about a visit: the first one (first touch) or the one that sent the form. */
export type Touch = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  gclid?: string
  fbclid?: string
  referring_url?: string
}

const PAID = /^(cpc|ppc|paid|paid[_-]?social|paidsocial|ads?|display|social[_-]?paid)$/i
const host = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Origin of a website visit. Tags win over the referring site (they are deliberate); click ids say "ad" (gclid) or
 * "from Facebook" (fbclid). The Google Business Profile website link should carry ?utm_source=gbp&utm_medium=organic,
 * since Google does not otherwise tell the profile apart from search.
 */
export function originOf(t: Touch | null | undefined, ownHosts: string[] = []): Origin {
  if (!t) return 'unknown'
  const src = (t.utm_source ?? '').toLowerCase()
  const med = (t.utm_medium ?? '').toLowerCase()
  const camp = (t.utm_campaign ?? '').toLowerCase()
  if (['gbp', 'gmb', 'google_business', 'googlebusiness', 'google-business-profile'].includes(src) || med === 'gbp' || camp === 'gbp') return 'google_business_profile'
  if (t.gclid || (src === 'google' && PAID.test(med))) return 'google_ads'
  const fb = ['facebook', 'fb', 'instagram', 'ig', 'meta'].includes(src)
  if (fb && PAID.test(med)) return 'facebook_ads'
  if (fb || t.fbclid) return 'facebook'
  if (src === 'email' || med === 'email') return 'email_campaign'
  if (src === 'google') return 'google_search'
  if (src) return 'tagged_link'
  const h = host(t.referring_url)
  if (!h || ownHosts.some((o) => h === o || h.endsWith(`.${o}`))) return 'direct'
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return 'google_search'
  if (/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|search\.brave\.com|ecosia\.org)$/.test(h)) return 'other_search'
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com)$/.test(h)) return 'facebook'
  return 'other_website'
}

/**
 * The source a report counts a Lead under: what Staff filled in (How they found us) wins over the automatic origin
 * when the automatic one is unknown or direct, since a person who called and said "Google" knows better.
 */
export function reportedSource(l: { origin: string | null; howFound: string | null }): string {
  const auto = (ORIGINS as readonly string[]).includes(l.origin ?? '') ? (l.origin as Origin) : 'unknown'
  if ((auto === 'unknown' || auto === 'direct') && l.howFound) return l.howFound
  return ORIGIN_LABELS[auto]
}

/** Our own sites: a visit "referred" by one of these is not an outside source. */
export const OWN_HOSTS = ['turnersdecks.com', 'turners-decks-staging.pages.dev', 'localhost']

/** A Lead's origin from what it stored: the first touch when the site sent one, else the visit that sent the form. */
export function originOfLead(l: { firstTouchJson: string | null; attributionJson: string | null; channel?: string | null }): Origin {
  const parse = (s: string | null): Touch | null => {
    if (!s) return null
    try {
      const v: unknown = JSON.parse(s)
      return v && typeof v === 'object' ? (v as Touch) : null
    } catch {
      return null
    }
  }
  const touch = parse(l.firstTouchJson) ?? parse(l.attributionJson)
  // A text or call has no visit to read: unknown, not "direct".
  if (!touch) return 'unknown'
  return originOf(touch, OWN_HOSTS)
}

export const channelLabel = (c: string | null | undefined) => ((CHANNELS as readonly string[]).includes(c ?? '') ? CHANNEL_LABELS[c as Channel] : 'Unknown')
