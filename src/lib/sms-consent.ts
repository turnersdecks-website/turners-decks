// Text consent wording shown next to the opt-in checkbox on both forms. Carriers (A2P 10DLC) review this wording
// and the privacy policy before they approve the Quo number for business texting. When the wording changes,
// bump SMS_CONSENT_VERSION: the CRM stores the version each Homeowner agreed to (consent_events.disclosure_version).
// No Astro or browser globals: crm-intake.ts imports it.
export const SMS_CONSENT_VERSION = "2026-11-13";

export const SMS_CONSENT_TEXT =
  "Text me about my project. Turner's Decks may send texts to the number above about this request, such as scheduling and follow-ups (about 1 to 5 messages per project). Message and data rates may apply. Reply STOP to opt out or HELP for help. Agreeing is not required to get an estimate.";
