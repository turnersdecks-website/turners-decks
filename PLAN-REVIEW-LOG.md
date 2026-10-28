# Plan Review Log: Turner's Decks CRM + estimator settings
Started 2026-10-27 session. MAX_ROUNDS=5.

## Round 1 — Codex

The plan has material gaps in validation, submission handling, and publishing. No files were modified.

1. **P1 — “No defaults” conflicts with hidden questions.** Step 2 removes defaults while requiring enabled answers. The UI hides `railingStyle` when deck railings are absent, but stair pricing still uses that style ([Estimator.tsx:208](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/src/components/islands/Estimator.tsx:208), [pricing.ts:215](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/src/lib/pricing.ts:215)). A valid stair-only selection can therefore be rejected or lack a required price input. Other hidden fields have the same unanswered-state problem.  
   **Fix:** Define shared conditional requiredness and normalization rules, expose every price-relevant choice, and record any server-applied defaults.

2. **P1 — Adding options is unsafe for questions whose behavior is hard-coded.** Step 6 offers additions to list questions generally, but retaining required values does not define new values’ semantics. A new `projectType` silently follows new-deck pricing; a new `skirtingCoverage` silently receives the partial-coverage factor ([pricing.ts:188](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/src/lib/pricing.ts:188), [pricing.ts:236](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/src/lib/pricing.ts:236)).  
   **Fix:** Allow additions only to explicitly data-driven option lists; lock question keys, kinds, and branch-driven value sets.

3. **P1 — The validation contract leaves arithmetic attacks and invalid settings unspecified.** Checking enabled choice values does not reject empty sections, negative counts, duplicate features, or extreme numbers; duplicate features are charged repeatedly by the current reducer. Publish validation also needs ordered ranges, bounded prices, unique keys/values, and an enabled choice for every required question.  
   **Fix:** Specify server-side numeric bounds, collection limits/uniqueness, document invariants, and finite ordered output checks, with rejection tests for each.

4. **P1 — The reference field mapper does not match Turner’s forms.** Step 4 inserts pricing “after mapping,” but Good Cover expects `name`, `projectType`, and `message`, and derives ZIP only from a formatted address ([reference intake.ts:525](</Users/ky/.t3/worktrees/Good Cover Roofing/feat-crm-intake/crm/src/lib/intake.ts:525>)). Turner’s sends `first_name`, `last_name`, `project_type`, `notes`, and a separate required ZIP. An unchanged mapper rejects submissions or silently loses fields, especially ZIP when the optional address is blank.  
   **Fix:** Define explicit payload mappings for both forms and contract-test every collected field through persisted records and Owner alerts.

5. **P1 — Unchanged dedupe can send an estimate to the wrong person.** The reference acknowledges matched Leads at their **stored email**, regardless of the submitted email ([reference intake.ts:395](</Users/ky/.t3/worktrees/Good Cover Roofing/feat-crm-intake/crm/src/lib/intake.ts:395>)). A mistyped or recycled phone number can attach a new submission to someone else and send that person its estimate; a phone-only existing Lead receives no Estimate email despite a supplied address.  
   **Fix:** Define estimate-specific recipient handling: suppress conflicting identities for review, or send only the current submission’s data to its validated submitted email without exposing existing Lead data.

6. **P1 — The copied client cannot return an estimate and does not provide the claimed retry behavior.** Good Cover’s response parser discards the success body, `submitLeadToCrm` returns `Promise<void>`, and automatic retries cover only HTTP 202—not network failures, timeouts, or 5xx ([reference crmIntake.ts:67](</Users/ky/.t3/worktrees/Good Cover Roofing/feat-crm-intake/src/lib/crmIntake.ts:67>)). Payload-builder tests will miss these failures.  
   **Fix:** Return and validate a typed estimator result, distinguish honeypot success without an estimate, and test bounded transient retries using the same submission key and payload.

7. **P2 — Atomic version allocation does not protect the draft being published.** Step 3 prevents duplicate version numbers, but two tabs can overwrite each other’s drafts or publish content different from what the confirmation displayed. `updated_at` alone supplies no concurrency check.  
   **Fix:** Add a draft revision/hash and require compare-and-swap saves and conditional publication of the exact revision the owner reviewed.

8. **P2 — Email retries can change content or describe the wrong inquiry.** The reference renders emails from live Lead/settings rows at dispatch time ([reference outbox-kinds.ts:48](</Users/ky/.t3/worktrees/Good Cover Roofing/feat-crm-intake/crm/src/lib/outbox-kinds.ts:48>)); Step 4 likewise names a mutable template. Repeat submissions retain old nonempty Lead fields, and changing a template between attempts changes the message under the same outbox job.  
   **Fix:** Bind each job to its submission’s snapshot and freeze the rendered email, recipient, and subject when enqueuing it.

9. **P2 — Settings versions do not version the calculation behavior.** Step 4’s “same version → same snapshot” assumption fails for a previously failed submission replayed after an engine deployment: the stored document is unchanged, but formulas, normalization, or flags may differ. Processed submissions are safe only because the reference returns their stored result without recomputing.  
   **Fix:** Record document/engine revisions, retain compatible calculation handlers for accepted versions, and explicitly preserve stored results for processed replays.

VERDICT: REVISE

### Claude's response

Accepted 1–8: relevance rules (`showIf`; railingStyle also shown when stairs exist), locked vs data-driven option
lists, numeric/collection bounds + document invariants + output guard, explicit Turner's field mapper, Estimate email
to the submitted address with content only from this submission, typed client result with bounded same-key retries on
network/timeout/5xx/202, draft revision compare-and-swap for save and publish, emails rendered and frozen at enqueue.

Partly rejected 9: added `ENGINE_REVISION` on snapshots and kept the ported rule that processed submissions return
their stored result. Rejected keeping old calculation handlers: only failed/rejected submissions are re-priced on
replay, and those never showed the Homeowner a price, so the current engine is correct and old-engine retention would
be dead weight.

## Round 2 — Codex

Most earlier findings are addressed. The revised replay policy is reasonable because processed submissions return their stored results. Three material issues remain:

1. **P1 — Valid settings can make ordinary submissions fail with 500.** [PLAN.md:54](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/PLAN.md:54) permits `[1, 1]` range spreads, but the existing rounding produces `low=42000, mid=42285, high=42000` for the golden example. I verified this arithmetic; the new output guard rejects it. Thus a publishable configuration can break intake.
   **Fix:** Make rounding preserve `low ≤ mid ≤ high` for every accepted configuration, and test tight spreads and minimum-price boundaries.

2. **P1 — The railing-style fix introduces a dependency on a later step.** [PLAN.md:44](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/PLAN.md:44) makes railing style depend on `stairType`, but Railings precedes Stairs. With no defaults, visibility depends on an unanswered future question; changing “no stairs” to stairs can also make a required question appear on an already completed step. The plan supplies no navigation or validation behavior to recover before submission.
   **Fix:** Show and require railing style on the Stairs step when stairs need it and deck railings are absent; test first-pass and back-navigation flows.

3. **P2 — Document-controlled relevance can invalidate the fixed engine.** [PLAN.md:43](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/PLAN.md:43) allows question-level `showIf` rules, but publish invariants do not restrict dependencies or prohibit hiding mandatory engine inputs. For example, making `material` relevant only for redecks causes the server to strip it for new decks, although platform pricing requires it. Cycles and unknown references are also undefined.
   **Fix:** Keep relevance rules fixed in shared code for this release, or validate document predicates against an explicit whitelist of engine-safe rules.

No files were modified.

VERDICT: REVISE

### Claude's response

Accepted all three. (1) Range spreads must be at most 0.95 and at least 1.05, which provably exceeds the largest half rounding step relative to mid; tests at the tightest spreads across rounding boundaries and the minimum. (2) railingStyle is asked on the Stairs step when there are stairs but no deck railings; rules may only reference same or earlier steps (tested); full re-validation before the contact gate. (3) Relevance rules are fixed in code and emitted read-only in the public payload; not editable by the owner this release.


## Round 3 — Codex

The relevance and navigation fixes address the previous findings. One material blocker remains:

**P1 — The rounding guarantee still fails for permitted minimum prices.** [PLAN.md:58](/Users/ky/.t3/worktrees/turners-decks/t3-8b6e69d7/.claude/worktrees/crm/PLAN.md:58) allows prices from zero to $1,000,000, including fractional values. The 5% margin assumes a lower bound that validation never enforces. I verified two counterexamples using the existing engine arithmetic:

- Minimum **$500**, subtotal **$510**, spreads **0.95/1.05** → `low=500, mid=510, high=500`.
- Minimum **$10,000.49**, subtotal **$9,000**, same spreads → `low=10000.49, mid=10000, high=10500`.

Both configurations pass the stated settings constraints but cause the output guard to reject legitimate submissions with 500.

**Fix:** Normalize monetary precision, require a positive minimum, and clamp rounded endpoints around the final midpoint and minimum; test low and fractional minima explicitly.

No files were modified.

VERDICT: REVISE

### Claude's response

Accepted. Endpoints are now clamped around the rounded midpoint (low never above floorStep(mid), high never below ceilStep(mid), then the minimum floor), mid rounded to whole dollars, and the minimum must be whole dollars, at least 1,000 and a multiple of 500. Tests added for the smallest minimum and fractional unit prices.


## Round 4 — Codex

No remaining material blockers found. The revised clamping and minimum constraints resolve the rounding issue; 252 arithmetic checks passed, preserving the $38,000–$47,000 golden range. Earlier validation, navigation, concurrency, and email findings are addressed.

This approves the plan for implementation, not the resulting code. No files were modified.

VERDICT: APPROVED

Converged: APPROVED after 4 rounds. User pre-authorized implementation without a second sign-off.
