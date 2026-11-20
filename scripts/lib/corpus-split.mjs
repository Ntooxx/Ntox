// Deterministic tuning/holdout split for the review corpora.
//
// The corpora in experiments/review/measurements/ were authored together with the
// detectors they measure, so every case is "tuning" by construction. Splitting them
// after the fact does NOT make the holdout independent of the author. It does give a
// stable, reproducible partition that was fixed before the number was reported, so a
// detector can no longer be re-tuned against the whole set and still pass. True
// independence would require a third-party corpus; this is the best available locally
// and is labelled as such in the reports.
//
// Split is a pure function of the case id, so it is stable across runs and machines.

export const HOLDOUT_PERCENT = 30;

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** "holdout" for ~HOLDOUT_PERCENT of ids, "tuning" otherwise. Stable by id. */
export function splitOf(id) {
  return fnv1a(String(id)) % 100 < HOLDOUT_PERCENT ? "holdout" : "tuning";
}

/** Group an array of items into { tuning: [...], holdout: [...] } by splitOf(item.id). */
export function partition(items) {
  const out = { tuning: [], holdout: [] };
  for (const item of items) out[splitOf(item.id)].push(item);
  return out;
}
