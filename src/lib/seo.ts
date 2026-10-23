import { SITE } from "./site";

export const fullTitle = (title: string) => (title.includes(SITE.name) ? title : `${title} | ${SITE.name}`);

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function localBusinessSchema(areaServed?: string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    name: SITE.name,
    url: SITE.url,
    foundingDate: String(SITE.since),
    founder: { "@type": "Person", name: SITE.owner },
    telephone: SITE.phone,
    email: SITE.email,
    address: {
      "@type": "PostalAddress",
      addressLocality: SITE.city,
      addressRegion: SITE.state,
      addressCountry: "US",
    },
    // Matches the Google Business Profile hours exactly.
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "07:00",
        closes: "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday"],
        opens: "09:00",
        closes: "17:00",
      },
    ],
    areaServed: areaServed ?? ["Berks County, PA", "Montgomery County, PA", "Chester County, PA"],
    makesOffer: ["New Decks", "Deck Replacement", "Pool Decks"].map((n) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: n },
    })),
  };
}
