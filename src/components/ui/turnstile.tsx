// Cloudflare Turnstile for the CRM intake, rendered explicitly.
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
// Tokens are single use: after a failed send, call reset() for a fresh one.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { TURNSTILE_ACTION, TURNSTILE_SITE_KEY } from "@/lib/crm-intake";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

let scriptLoad: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  scriptLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("turnstile_missing")));
    s.onerror = () => {
      scriptLoad = null;
      reject(new Error("turnstile_script_failed"));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

/** The widget's container ref, its current token (null until solved or after expiry) and a reset. */
export function useTurnstile() {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !ref.current) return;
        widget.current = t.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action: TURNSTILE_ACTION,
          size: "flexible",
          callback: (v: string) => setToken(v),
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        });
      })
      .catch((err) => console.error("[Turnstile]", err));
    return () => {
      cancelled = true;
      const id = widget.current;
      widget.current = null;
      if (id) loadTurnstile().then((t) => t.remove(id)).catch(() => undefined);
    };
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    const id = widget.current;
    if (id) loadTurnstile().then((t) => t.reset(id)).catch(() => undefined);
  }, []);

  return { ref, token, reset };
}

/** Where the widget renders. Empty (and takes no space) when no site key is set. */
export function TurnstileBox({ boxRef }: { boxRef: RefObject<HTMLDivElement | null> }) {
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={boxRef} className="min-h-[65px]" />;
}
