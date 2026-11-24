import {
  AlertTriangle,
  BadgeCheck,
  Check,
  HardHat,
  MessageSquare,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  addCrewTimeFn,
  clearCrewReviewFn,
  getCrewPayCandidates,
  getJobCrewTime,
  removeCrewTimeFn,
  unverifyCrewPayFn,
  verifyCrewPayFn,
} from "#/lib/crew-time.functions";
import { formatMoney } from "#/lib/customer-vocab";
import { errorMessage } from "#/lib/errors";
import { cn } from "#/lib/utils";

// Job page: who worked on the Job, day by day (crew-time.server.ts). Rows come from Pat's replies to the 6 PM
// check-in text or are added here. Flagged rows (a name not on the crew list, or no pay) are marked for Kristin.
// The totals fill the Job's labor hours and labor cost. Each entry is verified once: linked to the QuickBooks payment
// that covered it (already in the QuickBooks costs) or marked paid outside QuickBooks (added to the Job's costs once).

type Data = Awaited<ReturnType<typeof getJobCrewTime>>;

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs";

export function CrewTimePanel({
  jobId,
  today,
  onChanged,
}: {
  jobId: string;
  today: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    workDate: today,
    crewMemberId: "",
    name: "",
    hours: "",
    payType: "hourly" as "hourly" | "day",
    rate: "",
  });
  const load = useCallback(
    () =>
      getJobCrewTime({ data: { jobId } }).then(setData, () => setData(null)),
    [jobId],
  );
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<Data>, done: string) {
    setBusy(true);
    try {
      setData(await fn());
      toast.success(done);
      onChanged();
    } catch (error) {
      toast.error(await errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const days = [...new Set(data.rows.map((r) => r.workDate))];
  const picked = data.crew.find((c) => c.id === form.crewMemberId);

  return (
    <section
      aria-label="Crew time"
      className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5"
      data-slot="crew-time"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <HardHat className="size-4 text-muted-foreground" />
          Crew time
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus /> Add by hand
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Days logged</p>
          <p className="text-lg font-semibold tabular-nums">{days.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Crew hours</p>
          <p className="text-lg font-semibold tabular-nums">
            {Math.round(data.totals.hours * 10) / 10}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Crew cost</p>
          <p className="text-lg font-semibold tabular-nums">
            {formatMoney(data.totals.costCents) || "$0"}
          </p>
        </div>
      </div>
      {data.needsReview > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {data.needsReview === 1
            ? "1 entry needs"
            : `${data.needsReview} entries need`}{" "}
          a look: a name not on the crew list, or no pay to price it.
        </p>
      )}

      {data.rows.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span
              className="mr-1 inline-block size-2 rounded-full bg-success"
              aria-hidden
            />
            Paid in QuickBooks {formatMoney(data.totals.qboCents) || "$0"}
          </span>
          <span>
            <span
              className="mr-1 inline-block size-2 rounded-full bg-success/60"
              aria-hidden
            />
            Paid outside QuickBooks{" "}
            {formatMoney(data.totals.outsideCents) || "$0"}
          </span>
          <span
            className={cn(
              data.totals.unverifiedCents > 0 && "text-warning-foreground",
            )}
          >
            <span
              className="mr-1 inline-block size-2 rounded-full bg-warning"
              aria-hidden
            />
            Not verified {formatMoney(data.totals.unverifiedCents) || "$0"}
            {data.unverified > 0 &&
              ` (${data.unverified} ${data.unverified === 1 ? "entry" : "entries"}: ask Pat if and how they were paid)`}
          </span>
        </div>
      )}

      {verifying && (
        <VerifyPay
          id={verifying}
          onClose={() => setVerifying(null)}
          onDone={(d) => {
            setData(d);
            setVerifying(null);
            onChanged();
          }}
        />
      )}

      {adding && (
        <form
          className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                addCrewTimeFn({
                  data: {
                    jobId,
                    workDate: form.workDate,
                    crewMemberId: form.crewMemberId || null,
                    name: form.crewMemberId ? undefined : form.name,
                    hours: form.hours === "" ? null : Number(form.hours),
                    payType: form.rate === "" ? null : form.payType,
                    rate: form.rate === "" ? null : Number(form.rate),
                  },
                }),
              "Crew time added",
            ).then(() =>
              setForm((f) => ({
                ...f,
                crewMemberId: "",
                name: "",
                hours: "",
                rate: "",
              })),
            );
          }}
        >
          <label className="text-xs sm:col-span-1">
            Day
            <Input
              type="date"
              value={form.workDate}
              max={today}
              onChange={(e) => setForm({ ...form, workDate: e.target.value })}
              className="h-9"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Who
            <select
              className={selectClass}
              value={form.crewMemberId}
              onChange={(e) =>
                setForm({ ...form, crewMemberId: e.target.value })
              }
            >
              <option value="">Someone else…</option>
              {data.crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!form.crewMemberId && (
              <Input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 h-9"
              />
            )}
          </label>
          <label className="text-xs">
            Hours
            <Input
              inputMode="decimal"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              className="h-9"
              placeholder="8"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Pay{" "}
            {picked?.rateCents != null && (
              <span className="text-muted-foreground">
                (blank = usual {formatMoney(picked.rateCents)}
                {picked.payType === "hourly" ? "/hr" : " a day"})
              </span>
            )}
            <div className="flex gap-1">
              <Input
                inputMode="decimal"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                className="h-9"
                placeholder="$"
              />
              <select
                className={cn(selectClass, "w-28")}
                value={form.payType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    payType: e.target.value as "hourly" | "day",
                  })
                }
              >
                <option value="hourly">per hour</option>
                <option value="day">for the day</option>
              </select>
            </div>
          </label>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={busy}>
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Close
            </Button>
          </div>
        </form>
      )}

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No crew time yet. Pat's replies to the 6 PM text land here, or add it
          by hand.
        </p>
      ) : (
        <div className="space-y-3">
          {days.map((d) => {
            const rows = data.rows.filter((r) => r.workDate === d);
            const dayCost = rows.reduce((a, r) => a + (r.costCents ?? 0), 0);
            return (
              <div key={d}>
                <div className="flex items-baseline justify-between border-b pb-1 text-xs font-medium text-muted-foreground">
                  <span>{dayLabel(d)}</span>
                  <span className="tabular-nums">
                    {formatMoney(dayCost) || "$0"}
                  </span>
                </div>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-center justify-between gap-2 py-1.5 text-sm",
                        r.needsReview && "text-warning-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {r.needsReview && (
                          <AlertTriangle
                            className="size-3.5 shrink-0"
                            aria-label="Needs a look"
                          />
                        )}
                        <span className="truncate font-medium">{r.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {r.hours !== null ? `${r.hours}h` : ""}
                          {r.payType === "day" && r.rateCents !== null
                            ? ` · ${formatMoney(r.rateCents)} day`
                            : ""}
                          {r.payType === "hourly" && r.rateCents !== null
                            ? ` · ${formatMoney(r.rateCents)}/hr`
                            : ""}
                        </span>
                        {r.source === "text" && (
                          <MessageSquare
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-label="From Pat's text"
                          />
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {r.paidVia ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                            title={
                              r.paidVia === "qbo" && r.qboTxn
                                ? `QuickBooks ${r.qboTxn.date}: ${r.qboTxn.party ?? ""} ${formatMoney(r.qboTxn.amountCents ?? 0)}`
                                : (r.paidNote ?? "")
                            }
                          >
                            <BadgeCheck className="size-3" aria-hidden />
                            {r.paidVia === "qbo" ? "QuickBooks" : r.paidNote}
                            <button
                              type="button"
                              aria-label="Mark not verified"
                              className="opacity-60 hover:opacity-100"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () =>
                                    unverifyCrewPayFn({ data: { id: r.id } }),
                                  "Marked not verified",
                                )
                              }
                            >
                              <Undo2 className="size-3" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || r.costCents === null}
                            title={
                              r.costCents === null
                                ? "Add the pay first"
                                : "Verify how they were paid"
                            }
                            onClick={() => setVerifying(r.id)}
                            className="rounded-full border border-warning/50 bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground hover:bg-warning/25 disabled:opacity-50"
                          >
                            Verify pay
                          </button>
                        )}
                        <span className="w-16 text-right tabular-nums">
                          {r.costCents === null
                            ? "–"
                            : formatMoney(r.costCents)}
                        </span>
                        {r.needsReview && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="Looks right"
                            aria-label="Mark checked"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () => clearCrewReviewFn({ data: { id: r.id } }),
                                "Marked checked",
                              )
                            }
                          >
                            <Check className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Remove"
                          aria-label={`Remove ${r.name} on ${dayLabel(d)}`}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${r.name} on ${dayLabel(d)}?`,
                              )
                            )
                              void act(
                                () => removeCrewTimeFn({ data: { id: r.id } }),
                                "Removed",
                              );
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type Candidates = Awaited<ReturnType<typeof getCrewPayCandidates>>;

/** Verify one entry's pay (and the same person's other unverified days, often one payment): pick the QuickBooks
 * payment that covered it, or say it was paid outside QuickBooks. */
function VerifyPay({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: (d: Data) => void;
}) {
  const [c, setC] = useState<Candidates | null>(null);
  const [days, setDays] = useState<string[]>([id]);
  const [pick, setPick] = useState<string>("");
  const [note, setNote] = useState("cash");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getCrewPayCandidates({ data: { id } }).then(
      (r) => {
        setC(r);
        setDays(r.sameName.map((d) => d.id));
        const best = r.candidates.find((x) => x.mentionsName);
        setPick(best ? best.id : "");
      },
      async (e) => toast.error(await errorMessage(e)),
    );
  }, [id]);
  if (!c)
    return (
      <p className="text-sm text-muted-foreground">
        Loading QuickBooks payments…
      </p>
    );
  const chosenCents = c.sameName
    .filter((d) => days.includes(d.id))
    .reduce((a, d) => a + (d.costCents ?? 0), 0);

  async function save(via: "qbo" | "outside") {
    setBusy(true);
    try {
      onDone(
        await verifyCrewPayFn({
          data:
            via === "qbo"
              ? { ids: days, via, qboTxnId: pick }
              : { ids: days, via, note },
        }),
      );
      toast.success("Pay verified");
    } catch (e) {
      toast.error(await errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm"
      data-slot="verify-pay"
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold">Verify {c.entry.name}'s pay</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Days this covers
        </p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {c.sameName.map((d) => (
            <li key={d.id}>
              <label className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                <input
                  type="checkbox"
                  checked={days.includes(d.id)}
                  onChange={(e) =>
                    setDays((v) =>
                      e.target.checked
                        ? [...v, d.id]
                        : v.filter((x) => x !== d.id),
                    )
                  }
                />
                {dayLabel(d.workDate)} ·{" "}
                {d.costCents === null ? "–" : formatMoney(d.costCents)}
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">
          Total {formatMoney(chosenCents) || "$0"}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Paid through QuickBooks (Venmo, check, transfer from the business
          account)
        </p>
        {c.candidates.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No QuickBooks costs on this Job or waiting to be sorted from around
            those days. If it was paid from the business account, it may not
            have synced yet (QuickBooks syncs every 3 hours).
          </p>
        ) : (
          <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto">
            {c.candidates.map((t) => (
              <li key={t.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2 py-1.5",
                    pick === t.id && "border-brand ring-1 ring-brand/40",
                  )}
                >
                  <input
                    type="radio"
                    name="qbo-pick"
                    checked={pick === t.id}
                    onChange={() => setPick(t.id)}
                  />
                  <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t.date}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.party}
                    {t.mentionsName && (
                      <span className="ml-1 rounded bg-success/15 px-1 text-[10px] font-semibold text-success">
                        name match
                      </span>
                    )}
                    {!t.onJob && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        to sort
                      </span>
                    )}
                    {t.linkedCount > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        already covers {t.linkedCount}{" "}
                        {t.linkedCount === 1 ? "day" : "days"}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      t.amountCents === chosenCents &&
                        "font-semibold text-success",
                    )}
                  >
                    {formatMoney(t.amountCents)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <Button
          className="mt-2"
          size="sm"
          disabled={busy || !pick || !days.length}
          onClick={() => save("qbo")}
        >
          Link to this payment
        </Button>
      </div>

      <div className="border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          Or paid outside QuickBooks (added to the Job's costs once)
        </p>
        <div className="mt-1 flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-9 max-w-56"
            placeholder="cash"
            aria-label="How they were paid"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !days.length || !note.trim()}
            onClick={() => save("outside")}
          >
            Mark paid
          </Button>
        </div>
      </div>
    </div>
  );
}
