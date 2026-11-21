// Real Turner's Decks project photos (from Pat's Drive). Files live in
// src/assets/images and are resized + converted to WebP at build time.
// Projects are labeled by type only, no customer names. Add towns once confirmed.
import type { ImageMetadata } from "astro";
import a1 from "@/assets/images/ground-level-composite-deck-wrapped-steps.jpg";
import a2 from "@/assets/images/composite-deck-picture-frame-border-steps.jpg";
import a3 from "@/assets/images/gray-composite-deck-new-build.jpg";
import a4 from "@/assets/images/new-deck-site-before.jpg";
import a5 from "@/assets/images/new-composite-deck-after.jpg";
import b1 from "@/assets/images/composite-pool-deck-replacement-after.jpg";
import b2 from "@/assets/images/old-pool-deck-before-replacement.jpg";
import b3 from "@/assets/images/composite-pool-deck-above-ground-pool.jpg";
import b4 from "@/assets/images/pool-deck-white-vinyl-railing-black-balusters.jpg";
import b5 from "@/assets/images/composite-pool-deck-side-view.jpg";
import c1 from "@/assets/images/composite-deck-replacement-white-railing.jpg";
import c2 from "@/assets/images/brown-composite-deck-white-railing.jpg";
import c3 from "@/assets/images/composite-deck-lattice-skirting.jpg";
import c4 from "@/assets/images/worn-wood-deck-before-replacement.jpg";
import c5 from "@/assets/images/old-wood-deck-lattice-before.jpg";
import d1 from "@/assets/images/elevated-pressure-treated-deck-pond.jpg";
import d2 from "@/assets/images/elevated-deck-staircase-railing.jpg";
import d3 from "@/assets/images/pressure-treated-deck-stairs.jpg";
import d4 from "@/assets/images/elevated-deck-framing-posts-beams.jpg";
import e1 from "@/assets/images/old-pool-deck-stairs-before.jpg";
import e2 from "@/assets/images/pool-deck-stairs-white-vinyl-after.jpg";
import hero from "@/assets/images/modern-composite-deck-hero.jpg";

export type Photo = { src: ImageMetadata; alt: string };
const p = (src: ImageMetadata, alt: string): Photo => ({ src, alt });

// Photos from the old WordPress site's project pages (GPS and camera data stripped).
const files = import.meta.glob<{ default: ImageMetadata }>("../assets/images/*.jpg", { eager: true });
const img = (name: string): ImageMetadata => {
  const f = files[`../assets/images/${name}.jpg`];
  if (!f) throw new Error(`Missing photo: ${name}.jpg`);
  return f.default;
};
const series = (prefix: string, alts: string[]) => alts.map((alt, i) => p(img(`${prefix}-${String(i + 1).padStart(2, "0")}`), alt));

export const HERO = p(hero, "Modern composite backyard deck with railing at dusk");

export const PHOTO = {
  groundComposite: p(a1, "Ground-level gray composite deck with wrapped steps built by Turner's Decks"),
  compositeBorder: p(a2, "Composite deck with picture-frame border and wrap-around steps"),
  compositeNew: p(a3, "New gray composite deck off the back of a two-story home"),
  newSiteBefore: p(a4, "Backyard before a new deck was built"),
  newSiteAfter: p(a5, "Same backyard after a new composite deck with wrapped steps"),
  poolAfter: p(b1, "Composite pool deck with white vinyl railing after replacement"),
  poolBefore: p(b2, "Old pool deck before replacement"),
  poolDeck: p(b3, "Gray composite pool deck around an above-ground pool"),
  poolRailing: p(b4, "Pool deck with white vinyl railing and black balusters"),
  poolSide: p(b5, "Side view of a composite pool deck with railing"),
  replacementAfter: p(c1, "Deck replacement with brown composite decking and white railing"),
  replacementDeck: p(c2, "Brown composite deck with white vinyl railing and black balusters"),
  replacementSkirt: p(c3, "Replacement composite deck with white railing and lattice skirting"),
  replacementBefore: p(c4, "Worn wood deck before replacement"),
  replacementBefore2: p(c5, "Old wood deck with lattice before replacement"),
  elevated: p(d1, "Elevated pressure-treated deck with staircase overlooking a pond in Amity Township, PA"),
  elevatedStairs: p(d2, "Elevated deck with straight staircase and wood railings"),
  ptStairs: p(d3, "Pressure-treated deck staircase with railings on both sides"),
  framing: p(d4, "Deck framing with posts and beams during construction"),
  poolStairsBefore: p(e1, "Old pool deck stairs before replacement"),
  poolStairsAfter: p(e2, "Pool deck and stairs with white vinyl railing after replacement"),
  ptPool: series("pt-pool-deck-exeter", [
    "Pressure-treated pool deck around an above-ground pool in Exeter Township, PA",
    "Pool deck with horizontal wood railings and a wide walkway beside the pool",
    "Pressure-treated deck boards running up to the pool steps",
    "Deck walkway from the house to the pool with wood railings",
    "Ground-level pool deck with wood railings and the pool filter beside it",
    "Side view of the finished pool deck and railings",
    "Pool deck seen from the house, with the pool equipment pad in front",
    "Pool deck connecting to the steps of the home's existing deck",
    "New pressure-treated pool deck boards with the existing deck behind",
    "Pool deck walkway boards installed along the pool wall",
    "Pool deck framing on blocks beside the above-ground pool",
  ]),
  limerick: series("trex-deck-limerick", [
    "Elevated Trex composite deck with white vinyl railing and black balusters in Limerick Township, PA",
    "Composite deck with white PVC skirting and stairs to the yard",
    "Rear view of the 520-square-foot Pebble Grey composite deck",
    "Pebble Grey Trex decking across the full width of the deck",
    "Composite deck surface looking toward the outdoor dining area",
    "Outdoor dining set on the new composite deck",
    "Composite deck beside the home's arched window",
    "Composite deck with horizontal white PVC skirting, seen from the yard",
    "Composite deck stairs with white railing and black balusters",
    "Composite deck and stairs at sunset",
    "Side stairs off the composite deck toward the fence gate",
    "Side view of the deck, stairs, and white skirting",
    "White PVC skirting and fascia below the composite deck",
    "New deck framing built over the old patio area",
    "Pressure-treated joists for the new composite deck",
  ]),
  woodToTrex: series("wood-to-trex-exeter", [
    "Trex composite deck with black railing that replaced an old wood deck in Exeter Township, PA",
    "Trex composite deck surface with black aluminum railing",
    "New composite deck looking out over the backyard",
    "Composite deck stairs with landscaping below",
    "Side view of the replacement deck and stairs",
    "Composite deck with black railing and a covered grill",
    "Composite stairs with black aluminum railing",
    "Composite deck boards going down during the replacement",
  ]),
  woodToTrexBefore: p(img("wood-to-trex-exeter-before"), "Old wood deck with lattice skirting before replacement"),
  woodToTrexTearout: p(img("wood-to-trex-exeter-tearout"), "House wall after the old wood deck was torn out"),
  grayPool: series("gray-composite-pool-deck", [
    "Gray composite pool deck around an above-ground pool",
    "Composite pool deck meeting a covered patio",
    "Composite pool deck walkway along the patio",
    "Stairs with white railing up to the composite pool deck",
    "Work area by the house during a pool deck project",
  ]),
  brownComposite: p(img("brown-composite-deck-black-railing"), "Brown composite deck with black aluminum railing"),
  brownCompositeStairs: p(img("brown-composite-deck-black-railing-stairs"), "Brown composite deck and stairs with black railing"),
  mahoganyPorch: p(img("mahogany-porch-floor"), "Mahogany porch floor with a herringbone corner pattern"),
  coveredPorch: p(img("covered-porch-mahogany-white-railing"), "Covered porch with mahogany decking and white railing"),
  grayPatioDeck: p(img("gray-composite-deck-patio-furniture"), "Gray composite deck with patio furniture and an umbrella"),
  // From the 2026 job folders (Drive), names and addresses left out.
  privacyBefore: p(img("composite-deck-privacy-wall-exeter-before"), "Old stained wood deck with horizontal railings before replacement"),
  privacyAfter: p(img("composite-deck-privacy-wall-exeter-after"), "Brown composite deck with a privacy wall, white vinyl railing and stairs in Exeter Township, PA"),
  privacy: series("composite-deck-privacy-wall-exeter", [
    "Composite privacy wall with horizontal boards on white posts beside the deck",
    "Composite stairs with white vinyl railing and black balusters",
    "Composite deck, privacy wall and stairs seen from the yard",
    "White vinyl railing with black balusters in front of the privacy wall",
    "Side view of the composite deck, privacy wall and stairs",
  ]),
  poolTowardHouse: p(img("composite-pool-deck-toward-house"), "Composite pool deck looking back toward the house"),
  poolCorner: p(img("composite-pool-deck-corner-railing"), "Corner of a composite pool deck with white railing and black balusters"),
  groundSide: p(img("ground-level-composite-deck-side"), "Side view of a ground-level gray composite deck"),
  wrappedSteps: p(img("composite-deck-wrapped-steps-closeup"), "Wrapped composite steps with a picture-frame border"),
  elevatedTrees: p(img("elevated-pt-deck-under-trees"), "Elevated pressure-treated deck under willow trees"),
  elevatedRail: p(img("elevated-deck-railing-pond-view"), "View of the pond from an elevated deck railing"),
  replacementLattice: p(img("composite-deck-white-railing-lattice"), "Composite deck with white railing and lattice skirting"),
  secondStory: p(img("second-story-deck-white-railing-stairs"), "Second-story deck with white railing and stairs"),
};

export type Project = { title: string; type: string; blurb?: string; /** Intro for the photo section when the project also has a before-and-after slider, so the slider caption isn't repeated. */ more?: string; photos: Photo[]; before?: Photo; after?: Photo };

export const PROJECTS: Project[] = [
  { title: "Composite pool deck replacement", type: "Pool deck", blurb: "An old wood pool deck replaced with gray composite decking, white vinyl railing, and black balusters, with plenty of room to lounge around an above-ground pool.", more: "More of the finished pool deck: the walkway around the pool, the railing corners, and the view back toward the house.", before: PHOTO.poolBefore, after: PHOTO.poolAfter, photos: [PHOTO.poolDeck, PHOTO.poolRailing, PHOTO.poolSide, PHOTO.poolTowardHouse, PHOTO.poolCorner] },
  { title: "Composite deck replacement with white railing", type: "Deck replacement", blurb: "A worn wood deck torn out and rebuilt with brown composite decking and white vinyl railing, keeping the original footprint.", more: "More of the finished deck, from the white railing down to the lattice skirting.", before: PHOTO.replacementBefore2, after: PHOTO.replacementSkirt, photos: [PHOTO.replacementAfter, PHOTO.replacementDeck, PHOTO.replacementLattice] },
  { title: "Ground-level composite deck", type: "New deck", blurb: "A new gray composite deck close to the ground, with wrapped steps on every side and a picture-frame border.", more: "A closer look at the wrapped steps and the picture-frame border.", before: PHOTO.newSiteBefore, after: PHOTO.newSiteAfter, photos: [PHOTO.groundComposite, PHOTO.compositeBorder, PHOTO.compositeNew, PHOTO.groundSide, PHOTO.wrappedSteps] },
  { title: "Composite deck and privacy wall in Exeter Township", type: "Deck replacement", blurb: "A small stained wood deck at a townhouse replaced with premium composite decking, white PVC fascia, white vinyl railing with black balusters, new stairs, and a rebuilt composite privacy wall between neighbors.", more: "Up close: the privacy wall, the new stairs, and the white railing with black balusters.", before: PHOTO.privacyBefore, after: PHOTO.privacyAfter, photos: PHOTO.privacy },
  { title: "Elevated pressure-treated deck by a pond in Amity Township", type: "New deck", blurb: "A tall, freestanding pressure-treated deck in Amity Township, built among willow trees with a long staircase up to a view of the pond. It's a fort for the grandkids, and their grandfather is adding the finishing touches himself.", photos: [PHOTO.elevated, PHOTO.elevatedStairs, PHOTO.ptStairs, PHOTO.elevatedTrees, PHOTO.elevatedRail, PHOTO.framing] },
  { title: "Pool deck stair replacement", type: "Pool deck", blurb: "Old pool deck stairs replaced with composite treads and white vinyl railing.", before: PHOTO.poolStairsBefore, after: PHOTO.poolStairsAfter, photos: [] },
];

export const SERVICE_IMAGES: Record<string, Photo> = {
  "new-deck-construction": PHOTO.groundComposite,
  "deck-replacement": PHOTO.privacyAfter,
  "pool-decks": PHOTO.grayPool[0],
};

/** Alternates for the service cards on town pages, so each town shows a different mix. */
export const SERVICE_IMAGE_SETS: Record<string, Photo[]> = {
  "new-deck-construction": [PHOTO.groundComposite, PHOTO.compositeNew, PHOTO.limerick[0], PHOTO.groundSide, PHOTO.limerick[9]],
  "deck-replacement": [PHOTO.privacyAfter, PHOTO.woodToTrex[0], PHOTO.replacementDeck, PHOTO.replacementAfter, PHOTO.brownComposite],
  "pool-decks": [PHOTO.grayPool[0], PHOTO.poolDeck, PHOTO.ptPool[1], PHOTO.poolAfter, PHOTO.poolCorner],
};
