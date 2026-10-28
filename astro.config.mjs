// @ts-check
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { SITE } from "./src/lib/site.ts";

const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "PUBLIC_");

/** Warns at build time about launch blockers that are easy to miss on the live site. */
const launchCheck = {
  name: "launch-check",
  hooks: {
    "astro:build:done": ({ logger }) => {
      if (!env.PUBLIC_CRM_URL) logger.warn("PUBLIC_CRM_URL is not set: the quote form and estimator cannot send leads (see .env.example).");
      if (!env.PUBLIC_TURNSTILE_SITE_KEY) logger.warn("PUBLIC_TURNSTILE_SITE_KEY is not set: the forms have no security check, so the CRM refuses them (see .env.example).");
      if (!SITE.financingUrl) logger.warn("SITE.financingUrl is empty: the financing \"Check your rate\" button is hidden.");
    },
  },
};

// Fully static site. Lead forms post from the browser to the CRM's public intake (crm/, src/lib/crm-intake.ts).
export default defineConfig({
  site: "https://turnersdecks.com",
  // URLs without a trailing slash (/services/pool-decks), same as the Lovable site.
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [react(), sitemap(), launchCheck],
  vite: {
    plugins: [tailwindcss()],
  },
});
