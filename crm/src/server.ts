import { runScheduled } from '#/lib/cron'
import { oauthProvider } from '#/mcp/oauth'

// Worker entry. Requests go through the MCP OAuth provider (src/mcp/oauth.ts): it answers its own OAuth routes and
// /mcp, and hands every other request to the CRM app. Cron Triggers (wrangler.jsonc > triggers.crons) run their
// tasks from src/lib/cron.ts.
export default {
  fetch: (request, env, ctx) => oauthProvider(env).fetch(request, env, ctx),
  scheduled: (controller, env) => runScheduled(controller.cron, env),
} satisfies ExportedHandler<Env>
