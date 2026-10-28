import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

// Start installs this automatically only when src/start.ts is absent; defining the file opts out,
// so it is re-added explicitly (as in the Lovable CRM) to keep server functions safe from
// cross-site requests. Request middleware added later (e.g. auth rate limiting) goes here too.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}))
