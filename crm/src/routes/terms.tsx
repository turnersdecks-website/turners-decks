import { createFileRoute } from '@tanstack/react-router'
import { LEGAL, LegalPage } from '#/components/LegalPage'

// Public: the CRM's end-user license agreement / terms of use (Intuit app profile "EULA").
export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: 'Terms of use - Turner’s Decks CRM' }] }),
  component: Terms,
})

function Terms() {
  return (
    <LegalPage title="Terms of use (end-user license agreement)">
      <p>
        These terms cover the {LEGAL.short} CRM (“the app”), a private tool built for and operated by {LEGAL.company} (“we”, “us”). By signing in or
        connecting an account to the app, you agree to them.
      </p>

      <h2>Who may use the app</h2>
      <p>
        The app is for our own staff only. Access requires an account we create. It is not offered to the public or to other businesses, and it is not for
        sale. We may turn off any account at any time.
      </p>

      <h2>What the app does</h2>
      <ul>
        <li>Keeps our leads, customers, jobs, estimates and job photos.</li>
        <li>Receives requests from our website’s forms, and calls and texts to our business phone line.</li>
        <li>
          When an admin connects our QuickBooks Online company, reads our transactions (such as expenses, bills, invoices and payments) so we can see the
          costs and revenue of each job. The app only reads from QuickBooks; it does not create, change or delete anything there.
        </li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Keep your sign-in private and use the app only for {LEGAL.short} business.</li>
        <li>Do not try to reach data or parts of the app your account is not meant to use.</li>
      </ul>

      <h2>Connected accounts</h2>
      <p>
        Connecting QuickBooks or another service is optional and done by an admin. You can disconnect at any time, either in the app (Settings › Connections)
        or in the other service (for QuickBooks: Settings › Apps in QuickBooks Online). After a disconnect the app stops reading from that service. Your use
        of QuickBooks itself is governed by Intuit’s own terms.
      </p>

      <h2>Ownership of data</h2>
      <p>Our business data stays ours. The app keeps a copy only to run our business, as described in the privacy policy.</p>

      <h2>No warranty; limits</h2>
      <p>
        The app is provided as is, without warranties of any kind. Figures shown in the app (for example job costs copied from QuickBooks) are for our
        internal use; QuickBooks remains the record of our accounts. To the extent the law allows, we are not liable for indirect or consequential losses
        from using the app.
      </p>

      <h2>Changes and ending</h2>
      <p>
        We may change the app or these terms; the date above shows the latest version. Your access ends when your account is turned off or when we stop
        running the app.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of the Commonwealth of Pennsylvania.</p>

      <h2>Contact</h2>
      <p>
        Questions: <a className="underline" href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </p>
    </LegalPage>
  )
}
