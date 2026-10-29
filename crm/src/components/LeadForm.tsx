import { useRef, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import type { LeadEdits } from '#/lib/leads.functions'
import { CLIENT_TYPES, CLIENT_TYPE_LABELS } from '#/lib/client-types'
import { HOW_FOUND } from '#/lib/customer-vocab'
import { SERVICE_TYPES } from '#/lib/pipeline'

// Port of the Lovable LeadForm: the Lead fields Staff may edit (never Source or first-contact fields). Field styling
// from the Admin Kit settings forms (label over control, 2-unit gap, 4-unit grid rhythm).

export const emptyLead: LeadEdits = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  state: '',
  zip: '',
  serviceType: '',
  message: '',
  preferredMaterial: '',
  timeframe: '',
  howFound: '',
  referredById: '',
  referredByName: '',
  clientType: 'residential',
}

export function useLeadFields(init: Partial<Record<keyof LeadEdits, string | null>> = {}) {
  return useState<LeadEdits>(leadFieldsFrom(init))
}

/** Form values from a Lead row (nulls become empty strings). */
export function leadFieldsFrom(l: Partial<Record<keyof LeadEdits, string | null>>): LeadEdits {
  return Object.fromEntries(Object.keys(emptyLead).map((k) => [k, l[k as keyof LeadEdits] ?? ''])) as LeadEdits
}

export const sameFields = (a: LeadEdits, b: LeadEdits) => (Object.keys(emptyLead) as (keyof LeadEdits)[]).every((k) => a[k] === b[k])

/**
 * The Lead page's Homeowner draft (plan 009 decision 6). `baseline` is the last server version the form accepted. New
 * loader data for the same Lead replaces a clean form and never touches a dirty one. A Lead id change is handled by
 * keying the card on the Lead id. `adopt()` takes the then-current Lead after a successful Save.
 */
export function useLeadDraft(lead: Partial<Record<keyof LeadEdits, string | null>>) {
  const incoming = leadFieldsFrom(lead)
  const [state, setState] = useState(() => ({ baseline: incoming, fields: incoming }))
  const dirty = !sameFields(state.fields, state.baseline)
  if (!dirty && !sameFields(incoming, state.baseline)) setState({ baseline: incoming, fields: incoming })
  const latest = useRef(lead)
  latest.current = lead
  return {
    fields: state.fields,
    dirty,
    setFields: (fields: LeadEdits) => setState((s) => ({ ...s, fields })),
    adopt: () => {
      const loaded = leadFieldsFrom(latest.current)
      setState({ baseline: loaded, fields: loaded })
    },
  }
}

export function FormField({ id, label, className = '', children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`grid content-start gap-2 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

/** A native select drawn like the kit's Input / SelectTrigger (keeps plain form semantics and the SSR value). */
export const selectClass =
  'border-input focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-colors focus-visible:ring-1 focus-visible:outline-hidden md:text-sm [&>option]:bg-popover [&>option]:text-popover-foreground'

/** A native select that keeps a stored value missing from the suggestions (imports may have their own wording). */
export function SuggestSelect({ id, value, options, onChange }: { id: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <select id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value="">Select…</option>
      {value && !options.includes(value) && <option>{value}</option>}
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  )
}

/** How they found us, Referred by (a Customer or just a name) and Residential / Commercial: on Leads and Customers. */
export type SourceDraft = { howFound: string; referredById: string; referredByName: string; clientType: string }

export function SourceFields<T extends SourceDraft>({
  idPrefix,
  value,
  onChange,
  referrers,
}: {
  idPrefix: string
  value: T
  onChange: (v: T) => void
  /** Customers who may have referred them. */
  referrers: { id: string; name: string }[]
}) {
  const set = (patch: Partial<SourceDraft>) => onChange({ ...value, ...patch })
  return (
    <>
      <FormField id={`${idPrefix}howFound`} label="How they found us">
        <SuggestSelect id={`${idPrefix}howFound`} value={value.howFound} options={HOW_FOUND} onChange={(howFound) => set({ howFound })} />
      </FormField>
      <FormField id={`${idPrefix}clientType`} label="Residential or commercial">
        <select id={`${idPrefix}clientType`} name="clientType" value={value.clientType || 'residential'} onChange={(e) => set({ clientType: e.target.value })} className={selectClass}>
          {CLIENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CLIENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={`${idPrefix}referredById`} label="Referred by (Customer)">
        <select id={`${idPrefix}referredById`} name="referredById" value={value.referredById} onChange={(e) => set({ referredById: e.target.value })} className={selectClass}>
          <option value="">Nobody</option>
          {/* Keep a referrer missing from the list (e.g. the list failed to load). */}
          {value.referredById && !referrers.some((r) => r.id === value.referredById) && <option value={value.referredById}>A Customer</option>}
          {referrers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={`${idPrefix}referredByName`} label="Referred by (someone else)">
        <Input id={`${idPrefix}referredByName`} name="referredByName" autoComplete="off" placeholder="e.g. Kristin" value={value.referredByName} onChange={(e) => set({ referredByName: e.target.value })} />
      </FormField>
    </>
  )
}

export function LeadFieldsForm({
  value,
  onChange,
  referrers = [],
}: {
  value: LeadEdits
  onChange: (v: LeadEdits) => void
  referrers?: { id: string; name: string }[]
}) {
  const f = (k: keyof LeadEdits) => ({
    id: k,
    name: k,
    value: value[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...value, [k]: e.target.value }),
  })
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField id="firstName" label="First name">
        <Input required autoComplete="off" {...f('firstName')} />
      </FormField>
      <FormField id="lastName" label="Last name">
        <Input autoComplete="off" {...f('lastName')} />
      </FormField>
      <FormField id="email" label="Email">
        <Input type="email" autoComplete="off" {...f('email')} />
      </FormField>
      <FormField id="phone" label="Phone">
        <Input type="tel" autoComplete="off" {...f('phone')} />
      </FormField>
      <FormField id="street" label="Street address" className="sm:col-span-2">
        <Input autoComplete="off" {...f('street')} />
      </FormField>
      <FormField id="city" label="City">
        <Input autoComplete="off" {...f('city')} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField id="state" label="State">
          <Input autoComplete="off" {...f('state')} />
        </FormField>
        <FormField id="zip" label="ZIP">
          <Input inputMode="numeric" autoComplete="off" {...f('zip')} />
        </FormField>
      </div>
      <FormField id="serviceType" label="Service needed" className="sm:col-span-2">
        <select {...f('serviceType')} className={selectClass}>
          <option value="">Select…</option>
          {/* Keep a value Intake stored that is not in the list. */}
          {value.serviceType && !SERVICE_TYPES.includes(value.serviceType) && <option>{value.serviceType}</option>}
          {SERVICE_TYPES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <FormField id="preferredMaterial" label="Preferred material">
        <Input autoComplete="off" placeholder="e.g. Composite" {...f('preferredMaterial')} />
      </FormField>
      <FormField id="timeframe" label="Timeframe">
        <Input autoComplete="off" placeholder="e.g. Ready to start soon" {...f('timeframe')} />
      </FormField>
      <FormField id="message" label="Message" className="sm:col-span-2">
        <Textarea rows={3} {...f('message')} />
      </FormField>
      <SourceFields idPrefix="" value={value} onChange={onChange} referrers={referrers} />
    </div>
  )
}
