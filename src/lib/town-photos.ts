// Photos for each town page, so the 13 pages don't all show the same five shots.
// Local jobs go on their own town where we have one (Exeter, Limerick, Amity, Reading);
// the rest rotate through other finished decks. "build" is an in-progress shot beside the permit steps.
import { PHOTO, type Photo } from "./photos";

type TownPhotos = { hero: Photo; build: Photo; recent: [Photo, Photo, Photo] };

const P = PHOTO;
export const TOWN_PHOTOS: Record<string, TownPhotos> = {
  douglassville: { hero: P.grayPatioDeck, build: P.limerick[13], recent: [P.elevatedTrees, P.privacy[2], P.poolCorner] },
  amity: { hero: P.elevated, build: P.framing, recent: [P.elevatedRail, P.elevatedStairs, P.groundSide] },
  "exeter-township": { hero: P.woodToTrex[0], build: P.woodToTrex[7], recent: [P.ptPool[0], P.privacyAfter, P.woodToTrex[2]] },
  birdsboro: { hero: P.poolAfter, build: P.ptPool[10], recent: [P.replacementLattice, P.brownComposite, P.grayPool[1]] },
  "union-township": { hero: P.brownCompositeStairs, build: P.limerick[14], recent: [P.poolRailing, P.wrappedSteps, P.replacementAfter] },
  reading: { hero: P.privacyAfter, build: P.framing, recent: [P.privacy[0], P.woodToTrex[4], P.grayPool[0]] },
  limerick: { hero: P.limerick[9], build: P.limerick[13], recent: [P.limerick[2], P.limerick[5], P.limerick[10]] },
  royersford: { hero: P.replacementAfter, build: P.woodToTrex[7], recent: [P.poolSide, P.grayPool[2], P.replacementSkirt] },
  collegeville: { hero: P.grayPool[0], build: P.ptPool[10], recent: [P.limerick[7], P.poolTowardHouse, P.groundComposite] },
  "upper-providence-township": { hero: P.limerick[3], build: P.limerick[14], recent: [P.replacementDeck, P.grayPool[3], P.compositeNew] },
  pottstown: { hero: P.poolDeck, build: P.framing, recent: [P.woodToTrex[5], P.coveredPorch, P.groundSide] },
  coventry: { hero: P.groundComposite, build: P.limerick[13], recent: [P.woodToTrex[1], P.poolRailing, P.limerick[11]] },
  "west-chester": { hero: P.limerick[4], build: P.woodToTrex[7], recent: [P.grayPatioDeck, P.privacy[3], P.poolSide] },
};

const FALLBACK: TownPhotos = { hero: P.compositeNew, build: P.limerick[13], recent: [P.replacementSkirt, P.groundComposite, P.poolDeck] };
export const townPhotos = (slug: string): TownPhotos => TOWN_PHOTOS[slug] ?? FALLBACK;
