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
  "new-decks": PHOTO.groundComposite,
  "deck-replacement": PHOTO.replacementDeck,
  "pool-decks": PHOTO.poolDeck,
};
