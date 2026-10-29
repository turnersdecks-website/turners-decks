// Residential or commercial, on Leads and Customers (GLOSSARY Client type). Its own module so the schema and client
// code share it without the client bundle importing the schema.
export const CLIENT_TYPES = ['residential', 'commercial'] as const
export type ClientType = (typeof CLIENT_TYPES)[number]
export const CLIENT_TYPE_LABELS: Record<ClientType, string> = { residential: 'Residential', commercial: 'Commercial' }
