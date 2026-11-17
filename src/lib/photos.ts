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
  elevated: p(d1, "Elevated pressure-treated deck with staircase overlooking a pond"),
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
};

export type Project = { title: string; type: string; photos: Photo[]; before?: Photo; after?: Photo };

export const PROJECTS: Project[] = [
  { title: "Composite pool deck replacement", type: "Pool deck", before: PHOTO.poolBefore, after: PHOTO.poolAfter, photos: [PHOTO.poolDeck, PHOTO.poolRailing, PHOTO.poolSide] },
  { title: "Composite deck replacement with white railing", type: "Deck replacement", before: PHOTO.replacementBefore2, after: PHOTO.replacementSkirt, photos: [PHOTO.replacementAfter, PHOTO.replacementDeck] },
  { title: "Ground-level composite deck", type: "New deck", before: PHOTO.newSiteBefore, after: PHOTO.newSiteAfter, photos: [PHOTO.groundComposite, PHOTO.compositeBorder, PHOTO.compositeNew] },
  { title: "Elevated pressure-treated deck by the pond", type: "New deck", photos: [PHOTO.elevated, PHOTO.elevatedStairs, PHOTO.ptStairs, PHOTO.framing] },
  { title: "Pool deck stair replacement", type: "Pool deck", before: PHOTO.poolStairsBefore, after: PHOTO.poolStairsAfter, photos: [] },
];

export const SERVICE_IMAGES: Record<string, Photo> = {
  "new-deck-construction": PHOTO.groundComposite,
  "deck-replacement": PHOTO.replacementDeck,
  "pool-decks": PHOTO.poolDeck,
};
