// Where a visitor came from (crm/docs/adr/0005-lead-sources.md). The tiny script in BaseLayout records, on every page
// load that arrives from outside the site or carries tags:
// - first touch (localStorage, kept 90 days, never overwritten): where they first found us
// - session touch (sessionStorage, the latest outside arrival this visit): what brought them back this time
// Each holds the landing page, the outside site that sent them, UTM tags and click ids. Without this, a visitor who
// lands on the homepage from Google and then opens the estimator would be recorded as coming from our own homepage.
// The forms send both with the Lead (crm-intake.ts). Nothing here identifies the person.

export const FIRST_TOUCH_KEY = "td_first_touch";
export const SESSION_TOUCH_KEY = "td_session_touch";
export const FIRST_TOUCH_DAYS = 90;
export const TOUCH_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"] as const;

export type Touch = Partial<Record<(typeof TOUCH_PARAMS)[number] | "landing_page_url" | "referring_url", string>> & { t?: number };

/** The inline capture script for BaseLayout. Plain ES5 so it runs before anything else and never throws. */
export const CAPTURE_SCRIPT = `(function(){try{
var now=Date.now(),h=location.hostname,r=document.referrer,rh='';
try{rh=r?new URL(r).hostname:''}catch(e){}
var q=new URLSearchParams(location.search),t={t:now,landing_page_url:location.href.slice(0,500)},tagged=false;
${JSON.stringify(TOUCH_PARAMS)}.forEach(function(k){var v=q.get(k);if(v){t[k]=v.slice(0,200);tagged=true}});
var outside=rh&&rh!==h;if(outside)t.referring_url=r.slice(0,500);
var f=null;try{f=JSON.parse(localStorage.getItem('${FIRST_TOUCH_KEY}')||'null')}catch(e){}
if(!f||!f.t||now-f.t>${FIRST_TOUCH_DAYS}*864e5)localStorage.setItem('${FIRST_TOUCH_KEY}',JSON.stringify(t));
if(outside||tagged||!sessionStorage.getItem('${SESSION_TOUCH_KEY}'))sessionStorage.setItem('${SESSION_TOUCH_KEY}',JSON.stringify(t));
}catch(e){}})();`;

/** Both touches, for the forms. Browser only; missing or unreadable storage gives nulls. */
export function readTouches(): { firstTouch: Touch | null; sessionTouch: Touch | null } {
  const read = (s: Storage, k: string): Touch | null => {
    try {
      const v = JSON.parse(s.getItem(k) ?? "null");
      return v && typeof v === "object" ? (v as Touch) : null;
    } catch {
      return null;
    }
  };
  try {
    return { firstTouch: read(localStorage, FIRST_TOUCH_KEY), sessionTouch: read(sessionStorage, SESSION_TOUCH_KEY) };
  } catch {
    return { firstTouch: null, sessionTouch: null };
  }
}
