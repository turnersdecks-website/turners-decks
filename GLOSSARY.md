# Turner's Decks

The public website for Turner's Decks and the CRM the owner uses to follow up on the people it brings in. The CRM's
words come from Good Cover's and Pine & Gable's CRMs, with Turner's Decks' people.

## People

**Owner**:
Pat Turner, who answers Leads and gets Owner alerts.
_Avoid_: Admin (that is a Staff role), boss

**Staff**:
Anyone with a CRM login. Each Staff member is either an admin or a staff. Only admins change company settings,
Estimator settings and delete Leads.
_Avoid_: User, rep, team member

**Homeowner**:
The person a Lead is about: the one who asked about a deck. Becomes a Lead the moment they contact us.
_Avoid_: Contact, customer (only after a Lead is won), client, prospect, user

**Customer**:
A Homeowner we have done, or are doing, work for. A Lead that is moved to `won` becomes a Customer (or joins the
Customer with the same phone, else email). Past Customers can be added by hand or imported. A new Form submission
from a past Customer starts a Lead tied to their Customer record. Customers are never deleted.
_Avoid_: Client, account, contact

## Leads

**Lead**:
The record of one Homeowner's inquiries from the website or entered by hand, from first contact until it is won or
lost. A repeat Form submission with the same phone or email joins the existing Lead.
_Avoid_: Contact, customer, prospect, opportunity, submission

**Pipeline stage**:
Where a Lead stands: `new`, `contacted`, `appointment`, `quoted`, `won` or `lost`. A Lead becomes `contacted` once
Staff log a call, email or text with them; a note does not count. Every stage change is kept as the Lead's stage
history. Staff see it as "Stage" on the Lead page.
_Avoid_: Status, phase

**Source**:
Where a Lead first came from: `website` for the site's forms, `manual` for a Lead added by hand.
_Avoid_: Channel, origin

**How they found us**:
What the Homeowner says led them to us: Google search, Google Business Profile, Referral, Repeat customer, Facebook,
Saw a job nearby, Yard sign, Truck or Other. Kept on the Lead and copied to the Customer when it is won. Not the same
as Source (how the inquiry reached the CRM).
_Avoid_: Lead source, channel

**Referred by**:
Who sent them to us: a Customer, or just a name when the person is not a Customer (for example "Kristin").

**Client type**:
`residential` (the default) or `commercial` (a business or property manager, such as an apartment community). Kept
on the Lead and copied to the Customer when it is won.
_Avoid_: Segment, property type

**Attribution**:
The campaign and page details captured with a Lead: UTM tags, click ids, landing page and referrer.
_Avoid_: Tracking data

**Follow-up**:
A dated reminder for Staff to contact a Lead again, set when logging activity.
_Avoid_: Task, reminder

**Quote**:
A formal priced proposal sent after the free on-site estimate. Staff move the Lead to `quoted` once it is sent.

**Quote file**:
A file Staff upload on a Lead's Quote tab, one slot per kind. Replacing or removing a file keeps the old one in
storage.
_Avoid_: attachment, document, upload

## Customers and Jobs

**Job**:
One project for a Customer: what was built, when, and what it cost (quoted price, material and labor). Winning a
Lead adds a Job unless that Lead already has an open one (not done or cancelled). Its status is `not_scheduled`,
`scheduled`, `in_progress`, `done`, `on_hold` or `cancelled`.
_Avoid_: Project (fine in conversation), work order, deal

**Photo**:
A picture of a project, stored on its Job (or on the Lead before the Job exists; winning the Lead moves it to the
Job). Its stage is `before`, `during`, `after`, or `mock` for an AI-made picture. Stored without location or other
metadata. Photos are starred or hidden, never deleted.

**Photo link**:
An upload-only link for one Lead or Job and one stage, sent to Pat by text. It works for 14 days unless turned off,
and can only add photos.
_Avoid_: Upload link, magic link

**Photo home screen**:
One link saved on Pat's phone that lists every Photo link still open. Made and turned off by an admin in Settings.

**Gross margin**:
A Job's quoted price minus its actual material cost and labor cost. Blank until all three are filled in.

## Intake and email

**Form submission**:
One raw, unaltered post from one of the website's forms (the quote form or the estimator). It is kept even if it
never becomes a Lead.
_Avoid_: Entry, request

**Intake**:
The step that turns a Form submission into a new or updated Lead.
_Avoid_: Ingest, webhook

**Owner alert**:
The email the Owner gets about every Form submission that becomes or joins a Lead, with a link to the CRM.
_Avoid_: Notification, lead email

**Acknowledgement**:
The email a Homeowner gets after the quote form, saying their request arrived.
_Avoid_: Confirmation, receipt

**Estimate email**:
The email a Homeowner gets after using the estimator, with their price range. It replaces the Acknowledgement for
estimator Form submissions.
_Avoid_: Confirmation, quote email

## Estimator

**Estimator settings**:
The owner's editable draft of the estimator's prices, questions, options and disclaimers.
_Avoid_: Price list, config, form builder

**Published version**:
A numbered, unchangeable copy of the Estimator settings that the public estimator uses; a new one is made each time
the owner publishes.
_Avoid_: Release, revision

**Estimate snapshot**:
What a Lead keeps from one estimator Form submission: the Published version number, the questions and options shown,
the Homeowner's answers, and the resulting price range. A Lead has one per estimator Form submission.
_Avoid_: Quote (a Quote is a formal proposal)
