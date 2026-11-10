import { expect, test } from "vitest";
import { FEATURED_REVIEW, GOOGLE_REVIEWS } from "./reviews";

test("the featured pull quote is taken word for word from that person's Google review", () => {
  const review = GOOGLE_REVIEWS.find((r) => r.name === FEATURED_REVIEW.name);
  expect(review?.text).toContain(FEATURED_REVIEW.text);
});
