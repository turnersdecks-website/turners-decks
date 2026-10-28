// Small form primitives for the React islands (same classes as the Lovable shadcn versions).
import { useEffect, type ComponentProps, type RefObject } from "react";
import { buttonVariants, cn, type ButtonSize, type ButtonVariant } from "@/lib/utils";
import { SITE } from "@/lib/site";

export function Button({ className, variant, size, type = "button", ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function LinkButton({ className, variant, size, ...props }: ComponentProps<"a"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-base font-medium leading-snug", className)} {...props} />;
}

export function Progress({ value, className, ...props }: ComponentProps<"div"> & { value: number }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)} {...props}>
      <div className="h-full w-full flex-1 bg-primary transition-all" style={{ transform: `translateX(-${100 - value}%)` }} />
    </div>
  );
}

/** After a failed submit, move focus to the first invalid field so it's on screen and announced. */
export function useFocusFirstError(ref: RefObject<HTMLElement | null>, errors: object) {
  useEffect(() => {
    if (!Object.keys(errors).length) return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, ref]);
}

/** Inline field error, linked to its input through aria-describedby={id}. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-1 text-sm text-destructive">{message}</p>;
}

/** Send failure with a tap-to-call fallback, so a lead is never lost to a network error. */
export function SendError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
      <p>{message}</p>
      <a href={SITE.phoneHref} className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Call {SITE.phone}</a>
    </div>
  );
}

/** Hidden honeypot input (`website`, the CRM's honeypot). Bots fill it; the CRM tells them it worked and drops it. */
export function Honeypot() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
      <label htmlFor="hp-website">Website</label>
      <input id="hp-website" name="website" tabIndex={-1} autoComplete="off" />
    </div>
  );
}
