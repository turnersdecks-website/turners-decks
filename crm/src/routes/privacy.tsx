import { createFileRoute } from '@tanstack/react-router'
import { LEGAL, LegalPage } from '#/components/LegalPage'

// Public: the CRM's privacy policy (Intuit app profile). The website has its own (turnersdecks.com/privacy-policy).
export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy policy - Turner’s Decks CRM' }] }),
  component: Privacy,
})

function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy covers the {LEGAL.short} CRM (“the app”), a private tool used only by the staff of {LEGAL.company}. It explains what the app stores, why,
        and who can see it.
      </p>

      <h2>What the app stores</h2>
      <ul>
        <li>Staff accounts: name, email and sign-in details for the people who use the app.</li>
        <li>
          Homeowners who contact us: name, phone, email, address, project details, photos, and notes, from our website’s forms, from calls and texts to our
          business line, or entered by our staff.
        </li>
        <li>Text consent: whether a homeowner agreed to receive texts, and any opt-out (STOP).</li>
        <li>
          QuickBooks data, when an admin connects our QuickBooks Online company: transactions (date, amount, vendor or customer name, account, memo and line
          descriptions) from expenses, bills, vendor credits, invoices, sales receipts, credit memos and payments. The app only reads this data.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run our deck business: answering requests, scheduling, estimates, job records, and seeing what each job cost and earned. We do not sell,
        rent or share personal information for anyone else’s marketing.
      </p>

      <h2>Who it is shared with</h2>
      <p>
        Only the service providers that run the app for us, each for that purpose: Cloudflare (hosting and storage), our email provider (sending emails),
        Quo (our business phone and texting), and Intuit (QuickBooks, which we read from). Information may also be disclosed when the law requires it.
      </p>

      <h2>How it is protected</h2>
      <ul>
        <li>Only our staff can sign in, and admins control who has an account.</li>
        <li>All traffic is encrypted (HTTPS). Sign-in tokens for connected services such as QuickBooks are stored encrypted.</li>
        <li>GPS and other location data are removed from job photos.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        As long as we need it for our business and our legal and tax records. To stop the app reading QuickBooks, disconnect it (in the app under Settings ›
        Connections, or in QuickBooks under Settings › Apps); ask us and we will also delete the copied QuickBooks data.
      </p>

      <h2>Your choices</h2>
      <p>
        Homeowners can ask what we hold about them, ask us to correct or delete it, or stop texts by replying STOP. Email us at{' '}
        <a className="underline" href={`mailto:${LEGAL.email}`}>
          {LEGAL.email}
        </a>
        .
      </p>

      <h2>Changes</h2>
      <p>We may update this policy; the date above shows the latest version.</p>
    </LegalPage>
  )
}
