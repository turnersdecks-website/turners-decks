// Copy for the pages carried over from the old WordPress site, kept at their old addresses so
// search rankings carry over (docs/old-site-copy.md has the original text). Wording is the old
// site's, with em dashes removed. Photos are referenced by key from PHOTO / PROJECT_PHOTOS.
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
      "Professional new deck construction built to last. We design and build custom decks with quality materials, expert craftsmanship, and a clear, stress-free process. Schedule a free consultation today.",
    eyebrow: "New decks",
    h1: "New Deck Construction Built for How You Live",
    intro:
      "We design and build custom decks that feel like a natural extension of your home, crafted with quality materials, expert carpentry, and a process you can trust from start to finish.",
    formValue: "New deck",
    hero: PHOTO.limerick[0],
    blocks: [
      {
        heading: "What’s Included in New Deck Construction",
        body: ["When you hire us for a new deck, you’re getting more than just boards and railings. You’re getting a fully managed build designed to last."],
        lists: [
          {
            items: [
              "Design and layout guidance tailored to your home",
              "Help selecting the right materials for durability and style",
              "Permitting and local code compliance",
              "Professional installation by experienced carpenters",
              "Final walkthrough to ensure every detail is right",
            ],
          },
        ],
      },
      {
        heading: "Is a New Deck Right for You?",
        body: ["New deck construction is ideal for homeowners who want to:"],
        lists: [
          {
            items: [
              "Add functional outdoor living space",
              "Create a place for entertaining, relaxing, or family time",
              "Replace patios or unused yard space with something usable",
              "Increase home value with a permanent outdoor feature",
              "Build a deck that fits their lifestyle, not a one-size-fits-all design",
            ],
          },
        ],
      },
      {
        heading: "Our Approach to Building Your Deck",
        level: 2,
        body: [
          "We believe the best decks start with good conversations.",
          "Every project begins with a consultation where we listen to your ideas, assess your space, and talk through options honestly. From there, we guide you through material choices, layout considerations, and budget expectations so there are no surprises later.",
          "We handle the details that matter most: proper structure, code compliance, and craftsmanship that holds up to real use and real weather.",
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
              "Cedar and mahogany for a natural, premium look",
              "Multiple railing styles to match both safety and design needs",
            ],
          },
        ],
        link: { href: "/deck-materials-guide", label: "Compare decking materials" },
      },
    ],
    photos: [PHOTO.limerick[2], PHOTO.limerick[3], PHOTO.limerick[13], PHOTO.limerick[1]],
    recent: {
      heading: "Recent Deck Construction Projects",
      body: "For a recent homeowner, we designed and built a custom deck that created a seamless transition from the home to the backyard. The result was a durable, low-maintenance outdoor space built for everyday use and entertaining.",
      project: "composite-deck-construction-limerick-township-pa",
    },
  },
  "deck-replacement": {
    slug: "deck-replacement",
    title: "Deck Replacement",
    metaTitle: "Deck Replacement | Rebuild & Upgrade Your Existing Deck",
    metaDesc:
      "Turner’s Decks specializes in deck replacement and rebuilds, upgrading old or unsafe decks with durable composite and wood materials. Free consultation available.",
    eyebrow: "Replacement decks",
    h1: "Deck Replacement Done the Right Way",
    intro:
      "If your existing deck is worn, unsafe, or no longer meeting your needs, we can rebuild it with stronger structure, better materials, and a design that fits how you actually use your space today.",
    formValue: "Deck replacement",
    hero: PHOTO.woodToTrex[0],
    blocks: [
      {
        heading: "When Is It Time to Replace a Deck?",
        body: [
          "Many homeowners contact us when their deck starts showing signs of failure or simply no longer fits their home or lifestyle.",
          "Deck replacement may be the right option if you’re dealing with:",
        ],
        lists: [
          {
            items: [
              "Rotting or soft boards",
              "Failing or undersized structural framing",
              "Loose railings or stairs",
              "Code or safety concerns",
              "An outdated layout that limits usability",
              "A deck that can’t support modern materials",
            ],
          },
        ],
      },
      {
        heading: "What’s Included in Deck Replacement",
        body: ["Replacing a deck isn’t just surface work. It’s a full structural reset.", "Our deck replacement services typically include:"],
        lists: [
          {
            items: [
              "Removal of the existing deck structure",
              "Evaluation of footings and framing",
              "Redesign or layout improvements (if desired)",
              "Material selection guidance",
              "Permits and code compliance",
              "Professional reconstruction and finishing",
              "Final walkthrough and inspection",
            ],
          },
        ],
      },
      {
        heading: "Our Approach to Deck Rebuilds",
        level: 2,
        body: [
          "Every replacement deck starts with a careful assessment.",
          "We don’t assume anything about your existing structure. Instead, we evaluate what can be reused safely and what should be rebuilt to current standards. From there, we help you decide whether you want to keep the same footprint or improve the layout for better flow, safety, or functionality.",
          "Our goal is to rebuild your deck once, and build it to last.",
        ],
      },
      {
        heading: "Materials Commonly Used for Replacement Decks",
        body: [
          "Many homeowners choose to upgrade materials during a deck replacement to reduce maintenance and improve longevity.",
          "Common options include:",
        ],
        lists: [
          {
            items: [
              "Composite and PVC decking for durability and low upkeep",
              "Pressure-treated framing for structural integrity",
              "Cedar or mahogany for a natural, premium appearance",
              "Updated railing systems for safety and style",
            ],
          },
        ],
        link: { href: "/deck-materials-guide", label: "Compare decking materials" },
      },
    ],
    photos: [PHOTO.woodToTrex[1], PHOTO.woodToTrex[3], PHOTO.woodToTrex[6], PHOTO.woodToTrex[5]],
    recent: {
      heading: "Recent Deck Replacement Project",
      body: "We recently replaced an aging deck that had structural issues and outdated materials. The new build improved safety, expanded usable space, and gave the homeowners a low-maintenance deck they can enjoy without constant repairs.",
      project: "wood-deck-replacement-exeter-township-pa",
    },
  },
  "pool-decks": {
    slug: "pool-decks",
    title: "Pool Decks",
    metaTitle: "Pool Deck Builder | Composite & Wood Pool Decks",
    metaDesc:
      "Turner’s Decks designs and builds custom pool decks using composite, PVC, and wood materials. Slip resistant, low maintenance options. Free consultation available.",
    eyebrow: "Pool decks",
    h1: "Pool Deck Construction Designed for Safety and Style",
    intro:
      "A well-built pool deck should feel secure, comfortable, and easy to maintain. We design and build pool decks using materials and layouts that prioritize safety, durability, and long-term performance.",
    formValue: "Pool deck",
    hero: PHOTO.grayPool[0],
    blocks: [
      {
        heading: "Why Pool Decks Require a Specialized Approach",
        body: [
          "Pool decks are exposed to more moisture, foot traffic, and safety concerns than standard decks. Materials, spacing, and layout all matter more in this environment.",
          "A properly built pool deck helps:",
        ],
        lists: [
          {
            items: [
              "Reduce slipping hazards",
              "Improve drainage and airflow",
              "Withstand constant moisture and sun exposure",
              "Create a safer, more enjoyable pool area",
              "Meet local safety and building codes",
            ],
          },
        ],
      },
      {
        heading: "What’s Included in Pool Deck Construction",
        body: ["Our pool deck construction services are designed to address both function and appearance."],
        lists: [
          {
            items: [
              "Layout and spacing designed for safe pool access",
              "Slip-resistant decking recommendations",
              "Structural framing built to handle moisture exposure",
              "Proper drainage and ventilation",
              "Code-compliant railings and barriers where required",
              "Professional installation and finishing",
              "Final walkthrough and inspection",
            ],
          },
        ],
      },
      {
        heading: "Materials Commonly Used for Pool Decks",
        level: 2,
        body: [
          "Material choice is especially important around pools. We help homeowners select options that stay cooler, resist moisture, and require less maintenance.",
          "Common pool deck materials include:",
        ],
        lists: [
          {
            items: [
              "Composite and PVC decking for slip resistance and durability",
              "Pressure-treated framing for structural integrity",
              "Select wood options where appropriate",
              "Railing systems designed for pool safety",
            ],
          },
        ],
        link: { href: "/deck-materials-guide", label: "Learn more about decking materials and how they perform around pools" },
      },
      {
        heading: "Our Approach to Pool Deck Design",
        body: ["Every pool deck begins with a careful evaluation of how the space is used.", "We consider:"],
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
        after: ["Our goal is to build a pool deck that feels intentional, safe, and easy to live with, not something you have to work around."],
      },
    ],
    photos: [PHOTO.grayPool[1], PHOTO.grayPool[2], PHOTO.grayPool[3], PHOTO.ptPool[0]],
    recent: {
      heading: "Recent Pool Deck Project",
      body: "We recently completed a pool deck designed to improve safety and circulation while giving the homeowners a clean, modern look that complements their outdoor space.",
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
      "See a new pressure-treated pool deck built around a 12×18 ground-level pool in Exeter Township, PA. View project details and request a free consultation.",
    eyebrow: "Project spotlight: adding a pool deck",
    h1: "Budget-Friendly Pressure-Treated Pool Deck",
    service: "pool-decks",
    specs: [
      ["Project Type", "New Pool Deck Construction"],
      ["Primary Service", "Pool Decks"],
      ["Approximate Size", "12′ × 18′ pool with 3′ wide deck walkway"],
      ["Decking Material", "Pressure-Treated Lumber"],
      ["Finish", "Natural, stain-ready wood"],
      ["Location", "Exeter Township, Berks County, PA"],
    ],
    intro: [
      "This project involved building a new, ground-level pool deck to create a safe and functional space around an existing pool. The homeowners wanted a simple, budget-conscious solution that would improve access to the pool while keeping the footprint efficient and easy to maintain.",
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
      body: ["New pool deck projects of this size typically fall in the low-to-mid $10,000 range, depending on:"],
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
    intro: [
      "This project involved replacing an existing concrete patio with a large, elevated composite deck designed to improve usability, flow, and access to the backyard. The new deck expanded the usable outdoor space while incorporating clean finishing details and long-term, low-maintenance materials.",
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
              "Framing: Built to code using engineered plans",
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
      body: ["Projects of this size and scope typically fall in the mid-to-high $50,000 range, depending on:"],
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
    intro: [
      "This project involved replacing an aging wood deck with a low-maintenance composite deck designed for long-term durability, improved safety, and everyday use. The homeowners wanted a clean, modern look with minimal upkeep while maintaining the existing footprint and improving the overall function of their outdoor space.",
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
        after: ["This is a common scenario for homeowners considering replacement decks rather than repairs."],
      },
    ],
    cost: {
      heading: "Cost Range for This Project",
      body: ["Projects like this typically fall in the mid-$40,000 range, depending on:"],
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
