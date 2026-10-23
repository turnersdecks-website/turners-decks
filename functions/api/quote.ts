// POST /api/quote — Cloudflare Pages Function. Saves quote-form and estimator
// leads to the D1 database, then (optionally) emails the owner.
//
// Bindings / environment (set in the Cloudflare dashboard or wrangler.toml):
//   DB              D1 database binding (required)
//   AIRTABLE_TOKEN  optional; when set, each lead is also added to Pat's Airtable Leads table
//   RESEND_API_KEY  optional; when set with NOTIFY_EMAIL, each lead is emailed
//   NOTIFY_EMAIL    where lead emails go, e.g. turnersdecks@gmail.com
//   FROM_EMAIL      verified sender, e.g. "Turner's Decks <leads@turnersdecks.com>"
import { buildLeadRow, leadEmailText, type LeadRow } from "../../src/lib/lead";
import { sendToAirtable } from "../../src/lib/airtable";

interface Env {
  DB: D1Database;
  AIRTABLE_TOKEN?: string;
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL?: string;
  FROM_EMAIL?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function insertLead(db: D1Database, row: LeadRow) {
  const cols = Object.keys(row) as (keyof LeadRow)[];
  const sql = `INSERT INTO quote_requests (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  await db.prepare(sql).bind(...cols.map((c) => row[c])).run();
}

async function notify(env: Env, row: LeadRow) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL || !env.FROM_EMAIL) return;
  const what = row.source === "estimator" ? "estimator lead" : "quote request";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: env.NOTIFY_EMAIL,
      reply_to: row.email,
      subject: `New ${what}: ${row.first_name} ${row.last_name} (${row.zip})`,
      text: leadEmailText(row),
    }),
  });
  if (!res.ok) console.error("Lead email failed", res.status, await res.text());
}

async function syncAirtable(env: Env, row: LeadRow) {
  if (!env.AIRTABLE_TOKEN) return;
  try {
    const id = await sendToAirtable(env.AIRTABLE_TOKEN, row);
    await env.DB.prepare("UPDATE quote_requests SET airtable_id = ? WHERE id = ?").bind(id, row.id).run();
  } catch (err) {
    console.error("Airtable sync failed", row.id, err);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "Expected JSON" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > 50_000) return json({ error: "Too large" }, 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const result = buildLeadRow(body);
  if (!result.ok) {
    if ("spam" in result) return json({ id: "ok" }); // look successful to bots
    return json({ error: "Invalid submission", fields: result.errors }, 400);
  }

  try {
    await insertLead(env.DB, result.row);
  } catch (err) {
    console.error("Lead insert failed", err);
    return json({ error: "Could not save" }, 500);
  }
  waitUntil(Promise.all([notify(env, result.row), syncAirtable(env, result.row)]));
  return json({ id: result.row.id });
};

export const onRequest: PagesFunction<Env> = async () => json({ error: "Method not allowed" }, 405);
