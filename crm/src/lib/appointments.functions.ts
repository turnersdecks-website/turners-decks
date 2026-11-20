import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getDb } from '#/db/client'
import { appointmentMessages, bookAppointment, cancelAppointment } from '#/lib/appointments.server'
import { requireStaff } from '#/lib/guards'
import { record, requiredId } from '#/lib/input'

// Lead page > Appointment card (src/lib/appointments.server.ts).

/** Books or moves the appointment; sends the confirmation now and queues the reminder. `at` is epoch ms. */
export const bookLeadAppointment = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string; at: number; sendEmail: boolean; sendText: boolean }) => record(data))
  .handler(({ data, context: { staff } }) =>
    bookAppointment(
      getDb(env.DB),
      env,
      { leadId: requiredId(data.leadId), at: Number(data.at), sendEmail: data.sendEmail === true, sendText: data.sendText === true },
      staff.id,
    ),
  )

export const cancelLeadAppointment = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(({ data, context: { staff } }) => cancelAppointment(getDb(env.DB), requiredId(data.leadId), staff.id))

export const listAppointmentMessages = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator((data: { leadId: string }) => record(data))
  .handler(({ data }) => appointmentMessages(getDb(env.DB), requiredId(data.leadId)))
