// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { SITE } from "./src/lib/site.ts";

/** Warns at build time about launch blockers that are easy to miss on the live site. */
const launchCheck = {
  name: "launch-check",
  hooks: {
    "astro:build:done": ({ logger }) => {
      if (!SITE.web3formsKey) logger.warn("SITE.web3formsKey is empty: the quote form and estimator cannot send leads.");
      if (!SITE.financingUrl) logger.warn("SITE.financingUrl is empty: the financing \"Check your rate\" button is hidden.");
    },
  },
};

// Fully static site. Lead forms post straight to Web3Forms from the browser.
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
