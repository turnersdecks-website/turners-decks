# Coding standards (CRM)

Add a rule when a review misses something. Keep each one checkable.

- Pin dependencies to exact versions in `package.json` (no `^` or `~`).
- UI copy and code names use the repo's `../GLOSSARY.md` terms (Lead, Homeowner, Staff, Form submission, Published version, Estimate snapshot).
- A comment that explains *why* names its source: `// Plan 010 F1:` (a Pine & Gable plan) or a ticket id.
- A known limit we chose to accept gets a `ponytail:` comment saying what breaks and the upgrade path.
- Tests run in the Workers runtime against local D1 (`npm test`). Fake outside services through the
  existing seams (the `fetch` option on dispatch, `mockResend`, `mockSiteverify`), not `vi.mock`.
- Test names are sentences about behaviour a Staff member or Homeowner would notice.
- Before a PR: `npm run typecheck` and `npm run test:quiet` in `crm/` both pass.
