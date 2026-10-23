// Small form primitives for the React islands (same classes as the Lovable shadcn versions).
import type { ComponentProps } from "react";
import { buttonVariants, cn, type ButtonSize, type ButtonVariant } from "@/lib/utils";

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
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
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
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export function Progress({ value, className, ...props }: ComponentProps<"div"> & { value: number }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)} {...props}>
      <div className="h-full w-full flex-1 bg-primary transition-all" style={{ transform: `translateX(-${100 - value}%)` }} />
    </div>
  );
}

/** Hidden honeypot input. Bots fill it; the server drops those submissions. */
export function Honeypot() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
      <label htmlFor="hp-company">Company</label>
      <input id="hp-company" name="company" tabIndex={-1} autoComplete="off" />
    </div>
  );
}
