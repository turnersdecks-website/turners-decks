import handler from '@tanstack/react-start/server-entry'
import { runScheduled } from '#/lib/cron'

// Worker entry. Cron Triggers (wrangler.jsonc > triggers.crons) run their tasks from src/lib/cron.ts.
export default {
  fetch: (request) => handler.fetch(request),
  scheduled: (controller, env) => runScheduled(controller.cron, env),
} satisfies ExportedHandler<Env>
