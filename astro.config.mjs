// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Fully static site. Lead forms post straight to Web3Forms from the browser.
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
