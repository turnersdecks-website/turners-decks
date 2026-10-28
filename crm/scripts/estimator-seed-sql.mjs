// Prints the SQL at the end of drizzle/0001_estimator.sql that seeds the estimator draft, Published version 1 and
// the Estimate email template from src/lib/estimator/seed.ts (FLW-200). Run with Node 23.6+ (type stripping):
//   node scripts/estimator-seed-sql.mjs
// test/estimator-settings.test.ts fails if the migration and seed.ts drift apart.
const dir = new URL('../src/lib/estimator/', import.meta.url)
const { SEED_DOCUMENT } = await import(new URL('seed.ts', dir).href)
const { DEFAULT_ESTIMATE_EMAIL_TEMPLATE } = await import(new URL('email-template.ts', dir).href)
const q = (s) => `'${s.replaceAll("'", "''")}'`
const json = JSON.stringify(SEED_DOCUMENT)
process.stdout.write(
  [
    '--> statement-breakpoint',
    "-- FLW-200: Published version 1 and the draft are the site's former hard-coded estimator (src/lib/estimator/seed.ts;",
    '-- test/estimator-settings.test.ts checks they match). published_at is the seed date, 2026-10-27.',
    `INSERT INTO \`estimator_versions\` (\`version\`, \`document_json\`, \`draft_revision\`, \`published_at\`, \`published_by\`) VALUES (1, ${q(json)}, NULL, 1793145600000, NULL);`,
    '--> statement-breakpoint',
    `INSERT INTO \`estimator_draft\` (\`id\`, \`document_json\`, \`revision\`) VALUES (1, ${q(json)}, 1);`,
    '--> statement-breakpoint',
    `UPDATE \`company_settings\` SET \`estimate_email_template\` = ${q(DEFAULT_ESTIMATE_EMAIL_TEMPLATE)} WHERE \`id\` = 1;`,
    '',
  ].join('\n'),
)
