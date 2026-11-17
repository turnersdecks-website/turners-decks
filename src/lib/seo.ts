import { SITE } from "./site";

// Adds the brand unless the title already has it, or it would push the title past what Google shows (~65 chars).
export const fullTitle = (title: string) => {
  if (title.replace(/’/g, "'").includes(SITE.name)) return title;
  const withBrand = `${title} | ${SITE.name}`;
  return withBrand.length <= 65 ? withBrand : title;
};

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: new URL(it.path, SITE.url).href })),
  };
}

export function serviceSchema(name: string, description: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name,
    description,
    url: new URL(path, SITE.url).href,
    provider: { "@type": "HomeAndConstructionBusiness", name: SITE.name, url: SITE.url, telephone: SITE.phone },
    areaServed: ["Berks County, PA", "Montgomery County, PA", "Chester County, PA"],
  };
}

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
