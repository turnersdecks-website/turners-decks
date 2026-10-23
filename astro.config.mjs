// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Static site. The only server code is the Cloudflare Pages Function in
// /functions (lead capture), which deploys alongside the built pages.
export default defineConfig({
  site: "https://turnersdecks.com",
  // URLs without a trailing slash (/services/pool-decks), same as the Lovable site.
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
