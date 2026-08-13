// data/recommendations.js
//
// Orchestrates the recommender: engine builds a vetted shortlist → the AI
// curates/orders/explains it → the result is STORED on the user document.
// Explore then reads the stored result, so page loads never make an AI call.
//
// Cost model: recompute happens on the user's own review events (and a lazy
// staleness refresh), never per page load — so spend tracks real taste
// changes, not traffic.

import { ObjectId } from 'mongodb';
import { users, locations } from '../config/mongoCollections.js';
import { checkId } from '../helpers.js';
import {
  getRecommendationCandidates,
  serializeLocation
} from './locations.js';
import { rankRecommendations, annotateRecommendations } from './ai.js';

const SHORTLIST_SIZE = 15;
const STALE_MS = 6 * 60 * 60 * 1000; // serve stored, refresh in background after 6h

// Build the recommendation set and persist it on the user doc.
// Never throws in a way that should break a review write — callers fire it
// and .catch(). Returns the stored shape.
export async function computeAndStore(userId) {
  userId = checkId(userId);

  const { reason, preferredTypes, candidates } =
    await getRecommendationCandidates(userId, SHORTLIST_SIZE);

  let picks = null;
  let source = null;

  // Preferred path: let the AI curate + order + explain the shortlist.
  if (candidates.length > 0) {
    const ranked = await rankRecommendations({ reason, preferredTypes }, candidates);
    if (ranked && ranked.length > 0) {
      picks = ranked;
      source = 'ai-ranked';
    }
  }

  // Fallback: deterministic engine order + heuristic "why" lines. Also the
  // path taken when there is no API key at all.
  if (!picks) {
    const top = candidates.slice(0, 8);
    picks = await annotateRecommendations({ reason, preferredTypes }, top);
    source = 'heuristic';
  }

  const stored = {
    computedAt: new Date(),
    source, // 'ai-ranked' | 'heuristic'
    reason, // 'based-on-reviews' | 'top-rated' — drives the section heading
    picks: picks.map((p) => ({ locationId: p._id, why: p.why }))
  };

  const usersCol = await users();
  await usersCol.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { recommendations: stored } }
  );
  return stored;
}

// Turn a stored recommendation record into live location objects for the view.
// Locations that have since been deleted or unapproved are silently dropped,
// and the stored order is preserved.
async function hydrate(stored) {
  const out = { reason: stored.reason, source: stored.source, locations: [] };
  if (!stored.picks || stored.picks.length === 0) return out;

  const ids = stored.picks.map((p) => new ObjectId(p.locationId));
  const locationsCol = await locations();
  const docs = await locationsCol
    .find({ _id: { $in: ids }, approved: true })
    .toArray();
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));

  for (const p of stored.picks) {
    const doc = byId.get(p.locationId);
    if (!doc) continue; // deleted / unapproved since we stored it
    const loc = serializeLocation(doc);
    loc.why = p.why;
    out.locations.push(loc);
  }
  return out;
}

// What the Explore route calls. Reads the stored recs (no AI call); computes
// synchronously only the first time; serves stored + refreshes in the
// background once stale.
export async function getStoredOrCompute(userId) {
  userId = checkId(userId);

  const usersCol = await users();
  const user = await usersCol.findOne(
    { _id: new ObjectId(userId) },
    { projection: { recommendations: 1 } }
  );
  const stored = user?.recommendations;

  if (!stored) {
    const fresh = await computeAndStore(userId);
    return hydrate(fresh);
  }

  if (Date.now() - new Date(stored.computedAt).getTime() > STALE_MS) {
    // Don't block the page; refresh for next time.
    computeAndStore(userId).catch((e) =>
      console.error('background rec recompute failed:', e.message)
    );
  }
  return hydrate(stored);
}
