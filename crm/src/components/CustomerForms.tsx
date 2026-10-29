import type { ReactNode } from 'react'
import { FormField, selectClass } from '#/components/LeadForm'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { HOW_FOUND, JOB_STATUSES, JOB_STATUS_LABELS, MATERIALS, PROJECT_TYPES, type JobStatus } from '#/lib/customer-vocab'
import { cn } from '#/lib/utils'

// The Customer and Job edit forms (GLOSSARY Customer, Job), in the Lead form's style (LeadForm.tsx). Money fields
// take dollars; the server stores whole cents.

/** A native select that keeps a stored value missing from the suggestions (imports may have their own wording). */
function SuggestSelect({ id, value, options, onChange }: { id: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
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

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-9 items-center gap-2 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  )
}

export function FormSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn('min-w-0 space-y-4', className)}>
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Customer

export type CustomerDraft = {
  firstName: string
  lastName: string
  email: string
  phone: string
  street: string
  city: string
  state: string
  zip: string
  howFound: string
  customerSince: string
  referredById: string
  okToContact: boolean
  reviewLeft: boolean
  notes: string
}

type CustomerRow = {
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  howFound: string | null
  customerSince: Date | null
  referredById: string | null
  okToContact: boolean
  reviewLeft: boolean
  notes: string | null
}

/** 'YYYY-MM-DD' of an instant in the company time zone (en-CA formats dates that way). */
const isoDay = (d: Date | null, timeZone: string) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(d) : '')

export function customerDraftFrom(c: CustomerRow, timeZone: string): CustomerDraft {
  return {
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    street: c.street ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    zip: c.zip ?? '',
    howFound: c.howFound ?? '',
    customerSince: isoDay(c.customerSince, timeZone),
    referredById: c.referredById ?? '',
    okToContact: c.okToContact,
    reviewLeft: c.reviewLeft,
    notes: c.notes ?? '',
  }
}

/** The server input from a draft: empty text clears a field, an empty referrer is none. */
export const customerInput = (d: CustomerDraft) => ({ ...d, referredById: d.referredById || null, customerSince: d.customerSince || null })


export function CustomerFields({
  value,
  onChange,
  referrers,
}: {
  value: CustomerDraft
  onChange: (v: CustomerDraft) => void
  /** Other Customers who may have referred this one. */
  referrers: { id: string; name: string }[]
}) {
  const text = (k: keyof CustomerDraft) => ({
    id: `customer-${k}`,
    name: k,
    value: value[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value }),
  })
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField id="customer-firstName" label="First name">
        <Input autoComplete="off" {...text('firstName')} />
      </FormField>
      <FormField id="customer-lastName" label="Last name">
        <Input autoComplete="off" {...text('lastName')} />
      </FormField>
      <FormField id="customer-email" label="Email">
        <Input type="email" autoComplete="off" {...text('email')} />
      </FormField>
      <FormField id="customer-phone" label="Phone">
        <Input type="tel" autoComplete="off" {...text('phone')} />
      </FormField>
      <FormField id="customer-street" label="Street address" className="sm:col-span-2">
        <Input autoComplete="off" {...text('street')} />
      </FormField>
      <FormField id="customer-city" label="Town">
        <Input autoComplete="off" {...text('city')} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField id="customer-state" label="State">
          <Input autoComplete="off" {...text('state')} />
        </FormField>
        <FormField id="customer-zip" label="ZIP">
          <Input inputMode="numeric" autoComplete="off" {...text('zip')} />
        </FormField>
      </div>
      <FormField id="customer-howFound" label="How they found us">
        <SuggestSelect id="customer-howFound" value={value.howFound} options={HOW_FOUND} onChange={(howFound) => onChange({ ...value, howFound })} />
      </FormField>
      <FormField id="customer-customerSince" label="Customer since">
        <Input type="date" {...text('customerSince')} />
      </FormField>
      <FormField id="customer-referredById" label="Referred by" className="sm:col-span-2">
        <select
          id="customer-referredById"
          value={value.referredById}
          onChange={(e) => onChange({ ...value, referredById: e.target.value })}
          className={selectClass}
        >
          <option value="">Nobody</option>
          {referrers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </FormField>
      <div className="flex flex-wrap gap-x-6 sm:col-span-2">
        <Check id="customer-okToContact" label="OK to contact again" checked={value.okToContact} onChange={(okToContact) => onChange({ ...value, okToContact })} />
        <Check id="customer-reviewLeft" label="Left a review" checked={value.reviewLeft} onChange={(reviewLeft) => onChange({ ...value, reviewLeft })} />
      </div>
      <FormField id="customer-notes" label="Notes" className="sm:col-span-2">
        <Textarea rows={3} {...text('notes')} />
      </FormField>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job

export type JobDraft = {
  name: string
  city: string
  projectType: string
  material: string
  scope: string
  status: JobStatus
  startDate: string
  finishDate: string
  squareFootage: string
  quotedPrice: string
  quotedMaterialCost: string
  actualMaterialCost: string
  laborCost: string
  actualLaborHours: string
  permitNeeded: boolean
  permitPulled: boolean
  hoaNeeded: boolean
  hoaApproved: boolean
  okToShowPhotos: boolean
  onWebsite: boolean
  reviewAsked: boolean
  reviewReceived: boolean
  notes: string
}

type JobRow = {
  name: string
  city: string | null
  projectType: string | null
  material: string | null
  scope: string | null
  status: JobStatus
  startDate: string | null
  finishDate: string | null
  squareFootage: number | null
  quotedPriceCents: number | null
  quotedMaterialCostCents: number | null
  actualMaterialCostCents: number | null
  laborCostCents: number | null
  actualLaborHours: number | null
  permitNeeded: boolean
  permitPulled: boolean
  hoaNeeded: boolean
  hoaApproved: boolean
  okToShowPhotos: boolean
  onWebsite: boolean
  reviewAsked: boolean
  reviewReceived: boolean
  notes: string | null
}

const dollars = (cents: number | null) => (cents === null ? '' : String(cents / 100))
const num = (n: number | null) => (n === null ? '' : String(n))

export function jobDraftFrom(j: JobRow): JobDraft {
  return {
    name: j.name,
    city: j.city ?? '',
    projectType: j.projectType ?? '',
    material: j.material ?? '',
    scope: j.scope ?? '',
    status: j.status,
    startDate: j.startDate ?? '',
    finishDate: j.finishDate ?? '',
    squareFootage: num(j.squareFootage),
    quotedPrice: dollars(j.quotedPriceCents),
    quotedMaterialCost: dollars(j.quotedMaterialCostCents),
    actualMaterialCost: dollars(j.actualMaterialCostCents),
    laborCost: dollars(j.laborCostCents),
    actualLaborHours: num(j.actualLaborHours),
    permitNeeded: j.permitNeeded,
    permitPulled: j.permitPulled,
    hoaNeeded: j.hoaNeeded,
    hoaApproved: j.hoaApproved,
    okToShowPhotos: j.okToShowPhotos,
    onWebsite: j.onWebsite,
    reviewAsked: j.reviewAsked,
    reviewReceived: j.reviewReceived,
    notes: j.notes ?? '',
  }
}

export function JobFields({ value, onChange }: { value: JobDraft; onChange: (v: JobDraft) => void }) {
  const text = (k: keyof JobDraft) => ({
    id: `job-${k}`,
    name: k,
    value: value[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value }),
  })
  const check = (k: keyof JobDraft, label: string) => (
    <Check id={`job-${k}`} label={label} checked={value[k] as boolean} onChange={(v) => onChange({ ...value, [k]: v })} />
  )
  const money = (k: keyof JobDraft, label: string) => (
    <FormField id={`job-${k}`} label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input inputMode="decimal" className="pl-6" autoComplete="off" {...text(k)} />
      </div>
    </FormField>
  )
  return (
    <div className="space-y-8">
      <FormSection title="Project">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="job-name" label="Job name" className="sm:col-span-2">
            <Input required autoComplete="off" {...text('name')} />
          </FormField>
          <FormField id="job-status" label="Status">
            <select id="job-status" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as JobStatus })} className={selectClass}>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {JOB_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="job-city" label="Town">
            <Input autoComplete="off" {...text('city')} />
          </FormField>
          <FormField id="job-projectType" label="Project type">
            <SuggestSelect id="job-projectType" value={value.projectType} options={PROJECT_TYPES} onChange={(projectType) => onChange({ ...value, projectType })} />
          </FormField>
          <FormField id="job-material" label="Material">
            <SuggestSelect id="job-material" value={value.material} options={MATERIALS} onChange={(material) => onChange({ ...value, material })} />
          </FormField>
          <FormField id="job-scope" label="Scope of work" className="sm:col-span-2">
            <Textarea rows={4} {...text('scope')} />
          </FormField>
          <FormField id="job-startDate" label="Start date">
            <Input type="date" {...text('startDate')} />
          </FormField>
          <FormField id="job-finishDate" label="Finish date">
            <Input type="date" {...text('finishDate')} />
          </FormField>
          <FormField id="job-squareFootage" label="Square footage">
            <Input inputMode="decimal" autoComplete="off" {...text('squareFootage')} />
          </FormField>
          <FormField id="job-actualLaborHours" label="Actual labor hours">
            <Input inputMode="decimal" autoComplete="off" {...text('actualLaborHours')} />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Money">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {money('quotedPrice', 'Quoted price')}
          {money('laborCost', 'Labor cost')}
          {money('quotedMaterialCost', 'Quoted material cost')}
          {money('actualMaterialCost', 'Actual material cost')}
        </div>
      </FormSection>

      <div className="grid gap-8 sm:grid-cols-2">
        <FormSection title="Permit and HOA">
          <div className="grid gap-1">
            {check('permitNeeded', 'Permit needed')}
            {check('permitPulled', 'Permit pulled')}
            {check('hoaNeeded', 'HOA approval needed')}
            {check('hoaApproved', 'HOA approved')}
          </div>
        </FormSection>
        <FormSection title="Photos and reviews">
          <div className="grid gap-1">
            {check('okToShowPhotos', 'OK to show photos')}
            {check('onWebsite', 'On the website')}
            {check('reviewAsked', 'Review asked')}
            {check('reviewReceived', 'Review received')}
          </div>
        </FormSection>
      </div>

      <FormField id="job-notes" label="Notes">
        <Textarea rows={4} {...text('notes')} />
      </FormField>
    </div>
  )
}
