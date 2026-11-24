// Copy for the pages carried over from the old WordPress site, kept at their old addresses so
// search rankings carry over (docs/old-site-copy.md has the original text). Headings keep the old
// site's keywords; the body copy was rewritten in plain language (Nov 2026). Photos are referenced by key from PHOTO / PROJECT_PHOTOS.
import { PHOTO, type Photo } from "./photos";

export type Block = {
  heading: string;
  /** 2 = section heading, 3 = sub-heading inside a section */
  level?: 2 | 3;
  body?: string[];
  lists?: { label?: string; items: string[] }[];
  after?: string[];
  link?: { href: string; label: string };
};

export type ServicePageSlug = "new-deck-construction" | "deck-replacement" | "pool-decks";

export type ServicePage = {
  slug: ServicePageSlug;
  title: string;
  metaTitle: string;
  metaDesc: string;
  eyebrow: string;
  h1: string;
  intro: string;
  formValue: string;
  hero: Photo;
  blocks: Block[];
  photos: Photo[];
  recent: { heading: string; body: string; project: ProjectSlug };
};

export const SERVICE_PAGES: Record<ServicePageSlug, ServicePage> = {
  "new-deck-construction": {
    slug: "new-deck-construction",
    title: "New Decks",
    metaTitle: "New Deck Construction | Custom Deck Builder in Berks County",
    metaDesc:
      "New composite, PVC, and wood decks in Berks, Montgomery, and Chester Counties, built by our carpenters. Permits handled. Get a free on-site quote.",
    eyebrow: "New decks",
    h1: "New Deck Construction in Berks, Montgomery, and Chester Counties",
    intro:
      "We measure your yard, talk through how you'll use the deck, and give you a price at the visit or the same day. Then we handle the permit, build the deck, and walk it with you after it passes inspection.",
    formValue: "New deck",
    hero: PHOTO.limerick[0],
    blocks: [
      {
        heading: "What’s Included in New Deck Construction",
        body: ["Here’s what a new deck from us includes:"],
        lists: [
          {
            items: [
              "A mockup of your deck in your colors, at the visit or the same day",
              "Help choosing materials for your budget and how much upkeep you want",
              "Joist protection tape, a picture-frame border, and color-matched or white fascia",
              "The permit, drawings, and inspections",
              "The build, by our carpenters",
              "A final walkthrough after inspection",
            ],
          },
        ],
      },
      {
        heading: "Is a New Deck Right for You?",
        body: ["A new deck makes sense if you want to:"],
        lists: [
          {
            items: [
              "Add a place to eat, grill, or sit outside",
              "Replace a patio or a corner of the yard you never use",
              "Get from the back door to the yard more easily",
            ],
          },
        ],
      },
      {
        heading: "How We Plan Your Deck",
        level: 2,
        body: [
          "Every deck starts with a visit. We look at the yard, listen to what you want, and talk through layout, materials, and budget, so the price matches the deck you’re picturing.",
          "You get your estimate and a mockup of the deck in your colors at the visit or the same day. Once you approve it, we frame it to code and finish it cleanly.",
        ],
      },
      {
        heading: "Materials Commonly Used for New Decks",
        body: ["We build new decks using a range of materials depending on your goals, style, and budget, including:"],
        lists: [
          {
            items: [
              "Composite and PVC decking for low maintenance and longevity",
              "Pressure-treated lumber for a budget-friendly option",
              "Cedar and mahogany for a warmer, natural wood look",
              "Railings in aluminum, composite, cable, or vinyl",
            ],
          },
        ],
        link: { href: "/deck-materials-guide", label: "Compare decking materials" },
      },
    ],
    photos: [PHOTO.limerick[2], PHOTO.limerick[3], PHOTO.limerick[13], PHOTO.limerick[1]],
    recent: {
      heading: "Recent Deck Construction Projects",
      body: "In Limerick Township, we replaced a concrete patio with a 520 sq ft Trex deck in Pebble Grey, with white vinyl railings, PVC skirting, and two sets of stairs. It cost $55,000 to $60,000.",
      project: "composite-deck-construction-limerick-township-pa",
    },
  },
  "deck-replacement": {
    slug: "deck-replacement",
    title: "Deck Replacement",
    metaTitle: "Deck Replacement | Rebuild & Upgrade Your Existing Deck",
    metaDesc:
      "We replace worn or unsafe decks with new composite or wood decks in Berks, Montgomery, and Chester Counties. Old deck removal and permits included. Free on-site quote.",
    eyebrow: "Replacement decks",
    h1: "Deck Replacement for Worn-Out and Unsafe Decks",
    intro:
      "If the boards are soft, the railings wobble, or the layout never worked, we tear the old deck out, check what’s underneath, and build a new one to current code.",
    formValue: "Deck replacement",
    hero: PHOTO.woodToTrex[0],
    blocks: [
      {
        heading: "When Is It Time to Replace a Deck?",
        body: ["Most people call us when they notice one of these:"],
        lists: [
          {
            items: [
              "Rotting or soft boards",
              "Failing or undersized structural framing",
              "Loose railings or stairs",
              "Code or safety concerns",
              "An outdated layout that limits usability",
            ],
          },
        ],
      },
      {
        heading: "What’s Included in Deck Replacement",
        body: ["A replacement covers the whole deck, from the footings up. It includes:"],
        lists: [
          {
            items: [
              "Removal and haul-away of the old deck",
              "A check of the footings and framing",
              "Layout changes, if you want them",
              "Help choosing materials",
              "Joist protection tape, a picture-frame border, and color-matched or white fascia",
              "The permit, drawings, and inspections",
              "The rebuild, by our carpenters",
              "A final walkthrough after inspection",
            ],
          },
        ],
      },
      {
        heading: "How We Decide What to Keep",
        level: 2,
        body: [
          "We check the footings and framing before we price the job. Anything that can be reused safely stays. Anything rotted or below current code gets rebuilt.",
          "You can keep the same footprint or change the layout while we’re at it.",
        ],
      },
      {
        heading: "Materials Commonly Used for Replacement Decks",
        body: [
          "A replacement is a good time to switch to composite or PVC and stop staining every year.",
          "Common options include:",
        ],
        lists: [
          {
            items: [
              "Composite and PVC decking for durability and low upkeep",
              "Pressure-treated framing for structural integrity",
              "Cedar or mahogany for a warmer, natural wood look",
              "New railings in aluminum, composite, cable, or vinyl",
            ],
          },
        ],
        link: { href: "/deck-materials-guide", label: "Compare decking materials" },
      },
    ],
    photos: [PHOTO.woodToTrex[1], PHOTO.woodToTrex[3], PHOTO.woodToTrex[6], PHOTO.woodToTrex[5]],
    recent: {
      heading: "Recent Deck Replacement Project",
      body: "In Exeter Township, we tore out an aging wood deck and rebuilt it in Trex composite on the same footprint. It cost $40,000 to $50,000.",
      project: "wood-deck-replacement-exeter-township-pa",
    },
  },
  "pool-decks": {
    slug: "pool-decks",
    title: "Pool Decks",
    metaTitle: "Pool Deck Builder | Composite & Wood Pool Decks",
    metaDesc:
      "Pool decks for above-ground and in-ground pools in Berks, Montgomery, and Chester Counties, in composite, PVC, and wood. Permits handled. Free on-site quote.",
    eyebrow: "Pool decks",
    h1: "Pool Decks for Above-Ground and In-Ground Pools",
    intro:
      "Pool decks get wet feet, full sun, and a lot of traffic. We lay them out around how you get in and out of the pool, and help you pick decking that handles water and heat.",
    formValue: "Pool deck",
    hero: PHOTO.grayPool[0],
    blocks: [
      {
        heading: "What’s Different About a Pool Deck",
        body: [
          "A pool deck sees more water, sun, and bare feet than a regular deck, so material, board spacing, and layout matter more.",
          "A pool deck built right:",
        ],
        lists: [
          {
            items: [
              "Drains and dries out between swims",
              "Holds up to constant water and sun",
              "Is easier on wet, bare feet",
              "Meets pool barrier and building codes",
            ],
          },
        ],
      },
      {
        heading: "What’s Included in Pool Deck Construction",
        body: ["Every pool deck we build includes:"],
        lists: [
          {
            items: [
              "A layout planned around safe pool access",
              "Help choosing decking for wet feet and hot sun, using the manufacturer’s specs",
              "Framing built for constant moisture",
              "Board spacing for drainage and airflow",
              "Joist protection tape, a picture-frame border, and color-matched or white fascia",
              "Code-compliant railings and barriers where required",
              "The permit, drawings, and inspections",
              "A final walkthrough after inspection",
            ],
          },
        ],
      },
      {
        heading: "Materials Commonly Used for Pool Decks",
        level: 2,
        body: [
          "Around a pool, what matters most is how hot the boards get in July and how they handle water. We’ll show you the manufacturer’s heat and slip specs for each option.",
          "Common pool deck materials include:",
        ],
        lists: [
          {
            items: [
              "Composite and PVC decking, which won’t splinter and holds up to water",
              "Pressure-treated framing for structural integrity",
              "Pressure-treated wood decking for a lower-cost pool deck",
              "Railing systems designed for pool safety",
            ],
          },
        ],
        link: { href: "/deck-materials-guide", label: "Learn more about decking materials and how they perform around pools" },
      },
      {
        heading: "Our Approach to Pool Deck Design",
        body: ["We plan every pool deck around how the pool gets used, including:"],
        lists: [
          {
            items: [
              "Traffic flow around the pool",
              "Entry and exit points",
              "Safety clearances",
              "Furniture placement and lounging areas",
              "Long-term maintenance needs",
            ],
          },
        ],
      },
    ],
    photos: [PHOTO.grayPool[1], PHOTO.grayPool[2], PHOTO.grayPool[3], PHOTO.ptPool[0]],
    recent: {
      heading: "Recent Pool Deck Project",
      body: "In Exeter Township, we built a 3-foot pressure-treated walkway around a 12 by 18 foot ground-level pool. It cost $10,000 to $15,000.",
      project: "new-pool-deck-exeter-township-pa",
    },
  },
};

export type ProjectSlug =
  | "new-pool-deck-exeter-township-pa"
  | "composite-deck-construction-limerick-township-pa"
  | "wood-deck-replacement-exeter-township-pa";

export type ProjectPage = {
  slug: ProjectSlug;
  card: string;
  metaTitle: string;
  metaDesc: string;
  eyebrow: string;
  h1: string;
  service: ServicePageSlug;
  specs: [string, string][];
  /** Big numbers at the top of the page. Range is a rounded band, never the exact price. */
  glance: { range: string; size?: string; material: string; location: string };
  intro: string[];
  blocks: Block[];
  cost: Block;
  hero: Photo;
  photos: Photo[];
  before?: Photo;
};

export const PROJECT_PAGES: Record<ProjectSlug, ProjectPage> = {
  "new-pool-deck-exeter-township-pa": {
    slug: "new-pool-deck-exeter-township-pa",
    card: "Pressure-treated pool deck, Exeter Township",
    metaTitle: "New Pool Deck Construction in Exeter Township, PA | Turner’s Decks",
    metaDesc:
      "See a new pressure-treated pool deck built around a 12×18 ground-level pool in Exeter Township, PA. View project details and request a free on-site quote.",
    eyebrow: "Project spotlight: adding a pool deck",
    h1: "Pressure-Treated Pool Deck in Exeter Township, PA",
    service: "pool-decks",
    specs: [
      ["Project Type", "New Pool Deck Construction"],
      ["Primary Service", "Pool Decks"],
      ["Approximate Size", "12′ × 18′ pool with 3′ wide deck walkway"],
      ["Decking Material", "Pressure-Treated Lumber"],
      ["Finish", "Natural, stain-ready wood"],
      ["Location", "Exeter Township, Berks County, PA"],
    ],
    glance: { range: "$10,000 to $15,000", size: "12′ × 18′ pool, 3′ walkway", material: "Pressure-treated wood", location: "Exeter Township" },
    intro: [
      "The homeowners wanted a simple, affordable way to get around their 12 by 18 foot ground-level pool. We built a 3-foot pressure-treated walkway on all sides, low enough to need no stairs or railings.",
    ],
    blocks: [
      {
        heading: "Project Goals & Layout",
        body: ["The goal of this project was to add a practical deck surface around the pool while keeping the footprint efficient and the cost reasonable."],
        lists: [
          {
            label: "Approximate pool & deck layout:",
            items: [
              "Pool size: ~12′ × 18′ ground-level pool",
              "Deck width: ~3′ wide walkway surrounding the pool",
              "Elevation: Ground-level (no stairs or railings required)",
            ],
          },
        ],
        after: [
          "This layout provides enough space for safe movement, seating, and pool access without taking up unnecessary yard space, a common request for homeowners with smaller backyards or pool areas.",
        ],
      },
    ],
    cost: {
      heading: "Cost Range for This Project",
      body: ["This one cost $10,000 to $15,000. Your price depends on:"],
      lists: [{ items: ["Total deck square footage", "Site access and ground conditions", "Framing requirements", "Any future upgrades (staining, skirting, lighting)"] }],
      after: ["Every pool deck is custom-built and quoted based on the specific layout and site conditions."],
    },
    hero: PHOTO.ptPool[0],
    photos: PHOTO.ptPool,
  },
  "composite-deck-construction-limerick-township-pa": {
    slug: "composite-deck-construction-limerick-township-pa",
    card: "Trex composite deck, Limerick Township",
    metaTitle: "Composite Deck Construction in Limerick Township, PA | Turner’s Decks",
    metaDesc:
      "See a 520-square-foot Trex composite deck built to replace a concrete patio in Limerick Township, PA. View materials, layout, and project details.",
    eyebrow: "Project spotlight: replacing a patio with a composite deck",
    h1: "Composite Deck Construction in Limerick Township, PA",
    service: "new-deck-construction",
    specs: [
      ["Project Type", "New Deck Construction (Patio Replacement)"],
      ["Primary Service", "New Deck Construction"],
      ["Decking Material", "Trex Select Composite Decking"],
      ["Deck Color", "Pebble Grey"],
      ["Railing System", "RDI white vinyl railing with black aluminum balusters"],
      ["Skirting", "White PVC horizontal skirting"],
      ["Location", "Limerick Township, Montgomery County, PA"],
    ],
    glance: { range: "$55,000 to $60,000", size: "About 520 sq ft", material: "Trex Select, Pebble Grey", location: "Limerick Township" },
    intro: [
      "The homeowners had a concrete patio and wanted more room and easier access to the yard. We replaced it with a 520 sq ft Trex Select deck in Pebble Grey, a little larger than the patio, with stairs off the back and off the side by the fence gate.",
    ],
    blocks: [
      {
        heading: "Project Scope & Layout",
        body: ["The new deck was designed to be slightly larger than the original patio, creating a more functional outdoor living space with multiple access points."],
        lists: [
          {
            label: "Approximate size & layout:",
            items: [
              "Total deck size: ~520 square feet",
              "Width: ~32′ wide",
              "Projection from house: ~30′ from the main section, ~20′ from the shorter side",
              "Stairs: one set off the back of the deck, and one set off the side closest to the fence gate",
            ],
          },
        ],
        after: ["This layout improved circulation, yard access, and overall usability compared to the original patio."],
      },
      {
        heading: "Materials, Finishes & Construction Details",
        lists: [
          {
            items: [
              "Decking: Trex Select composite decking",
              "Deck Color: Pebble Grey",
              "Railing: RDI white vinyl railing with black aluminum balusters",
              "Fascia: White PVC fascia boards",
              "Skirting: Horizontal white PVC skirting (1×8 boards, spaced ~1″ apart)",
              "Framing: Built to code",
            ],
          },
        ],
        after: [
          "Composite decking was selected for its durability, consistent appearance, and low-maintenance performance. White PVC fascia and skirting were added to create a clean, finished look while concealing framing and utilities below the deck.",
          "An access panel was also incorporated into the skirting to allow future access to the dryer vent for maintenance.",
        ],
      },
      {
        heading: "Site-Specific Considerations",
        body: [
          "To accommodate the new deck layout, the existing exterior water spigot near the Bilco door was relocated to the side of the home near the gate. The final location was determined based on interior framing conditions to ensure proper function and accessibility.",
          "All required permits and inspections were included as part of the project.",
        ],
      },
    ],
    cost: {
      heading: "Average Cost Range",
      body: ["This one cost $55,000 to $60,000. Your price depends on:"],
      lists: [
        {
          items: [
            "Total square footage",
            "Composite decking and railing selections",
            "Stair count and layout",
            "Skirting and finishing details",
            "Site-specific adjustments",
          ],
        },
      ],
      after: ["Final pricing can vary as projects evolve, particularly when additional finishing elements such as skirting or access panels are added."],
    },
    hero: PHOTO.limerick[0],
    photos: PHOTO.limerick,
  },
  "wood-deck-replacement-exeter-township-pa": {
    slug: "wood-deck-replacement-exeter-township-pa",
    card: "Wood-to-Trex deck replacement, Exeter Township",
    metaTitle: "Replacing an Old Wood Deck in Exeter Township, PA | Composite Deck Replacement",
    metaDesc:
      "See how we replaced an aging wood deck with low-maintenance Trex composite decking in Exeter Township, PA. Project details, materials, and cost range.",
    eyebrow: "Project spotlight",
    h1: "Wood-to-Trex Deck Replacement in Exeter Township, PA",
    service: "deck-replacement",
    specs: [
      ["Project Type", "Deck Replacement"],
      ["Primary Service", "Replacement Decks"],
      ["Location", "Exeter Township, Berks County, PA"],
      ["Material", "Trex composite deck"],
    ],
    glance: { range: "$40,000 to $50,000", material: "Trex composite", location: "Exeter Township" },
    intro: [
      "The old wood deck needed constant upkeep and was wearing out. The homeowners wanted to keep the same footprint and stop staining, so we tore it out and rebuilt it in Trex composite with new railings.",
    ],
    blocks: [
      {
        heading: "Why This Project Needed a Replacement",
        body: [
          "The original deck had reached the end of its lifespan. Like many older wood decks, it required frequent maintenance and no longer met the homeowners’ needs for safety, durability, or appearance.",
          "A full deck replacement allowed us to:",
        ],
        lists: [
          {
            items: [
              "Remove deteriorating materials",
              "Upgrade to modern composite decking",
              "Improve railing safety and consistency",
              "Deliver a long-term, low-maintenance solution",
            ],
          },
        ],
      },
    ],
    cost: {
      heading: "Cost Range for This Project",
      body: ["This one cost $40,000 to $50,000. Your price depends on:"],
      lists: [{ items: ["Total deck size", "Railing style and materials", "Stairs and access points", "Optional upgrades such as lighting or fascia details"] }],
      after: ["Every replacement deck is custom-quoted based on site conditions and homeowner goals."],
    },
    hero: PHOTO.woodToTrex[0],
    photos: PHOTO.woodToTrex,
    before: PHOTO.woodToTrexBefore,
  },
};

export const PROJECT_LIST = Object.values(PROJECT_PAGES);
export const SERVICE_LIST = Object.values(SERVICE_PAGES);
