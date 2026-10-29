// Photos (GLOSSARY Photo, Photo link): client-safe vocabulary shared by the schema, the CRM and Pat's upload page.

/** Where in a project a photo was taken. Links ask for before, during or after; mocks are added by Staff. */
export const PHOTO_STAGES = ['before', 'during', 'after', 'mock'] as const
export type PhotoStage = (typeof PHOTO_STAGES)[number]
export const LINK_STAGES = ['before', 'during', 'after'] as const satisfies readonly PhotoStage[]
export type LinkStage = (typeof LINK_STAGES)[number]

export const PHOTO_STAGE_LABELS: Record<PhotoStage, string> = { before: 'Before', during: 'During', after: 'After', mock: 'AI mock' }

/** A photo link works for 14 days unless turned off sooner. */
export const PHOTO_LINK_DAYS = 14
export const PHOTO_LINK_MS = PHOTO_LINK_DAYS * 24 * 60 * 60 * 1000

/** The phone resizes to this long side before upload (sharp for the website and print, quick on cell data). */
export const PHOTO_MAX_EDGE = 2500
export const PHOTO_THUMB_EDGE = 600
/** The most one uploaded photo (after resizing) may be. */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024
export const PHOTO_THUMB_MAX_BYTES = 2 * 1024 * 1024

export const isLinkStage = (v: unknown): v is LinkStage => typeof v === 'string' && (LINK_STAGES as readonly string[]).includes(v)
export const isPhotoStage = (v: unknown): v is PhotoStage => typeof v === 'string' && (PHOTO_STAGES as readonly string[]).includes(v)
