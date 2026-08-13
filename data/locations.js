import { ObjectId } from 'mongodb';
import { locations, users, reviews } from '../config/mongoCollections.js';
import { checkId, checkString } from '../helpers.js';

const ALLOWED_TYPES = ['cafe', 'museum', 'park', 'restaurant', 'other'];
const ALLOWED_PRICE_CATEGORIES = ['Free', '$', '$$', '$$$', '$$$$'];

function checkType(value) {
  value = checkString(value);
  value = value.toLowerCase();
  if (!ALLOWED_TYPES.includes(value)) {
    throw 'Type must be one of: cafe, museum, park, restaurant, other';
  }
  return value;
}

function checkOptionalString(value, label, maxLen) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw `${label} must be a string`;
  value = value.trim();
  if (value.length === 0) return null;
  if (maxLen && value.length > maxLen) {
    throw `${label} cannot be longer than ${maxLen} characters`;
  }
  return value;
}

function checkZipCode(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw 'ZIP code must be a string';
  value = value.trim();
  if (value.length === 0) return null;
  if (!/^\d{5}$/.test(value)) throw 'ZIP code must be 5 digits';
  return value;
}

function checkLatitude(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (isNaN(num)) throw 'Latitude must be a number';
  if (num < -90 || num > 90) throw 'Latitude must be between -90 and 90';
  return num;
}

function checkLongitude(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (isNaN(num)) throw 'Longitude must be a number';
  if (num < -180 || num > 180) throw 'Longitude must be between -180 and 180';
  return num;
}

function checkPhone(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw 'Phone must be a string';
  value = value.trim();
  if (value.length === 0) return null;
  if (!/^[\d\s().+\-]{7,20}$/.test(value)) {
    throw 'Phone must be a valid phone number';
  }
  return value;
}

function checkWebsite(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw 'Website must be a string';
  value = value.trim();
  if (value.length === 0) return null;
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    throw 'Website must be a valid URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw 'Website must use http or https';
  }
  return value;
}

function checkPriceCategory(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw 'Price category must be a string';
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === 'free') return 'Free';
  if (!ALLOWED_PRICE_CATEGORIES.includes(normalized)) {
    throw 'Price category must be one of: Free, $, $$, $$$, $$$$';
  }
  return normalized;
}

function serializeLocation(loc) {
  if (!loc) return loc;
  const out = { ...loc };
  out._id = out._id.toString();
  if (out.addedBy && typeof out.addedBy === 'object') {
    out.addedBy = out.addedBy.toString();
  }
  return out;
}

// actor=null → dataset-seeded (auto-approved).
// actor.role==='admin' → admin-added (auto-approved).
// otherwise → user-suggested (awaits admin approval).
export async function createLocation(input, { actor = null } = {}) {
  if (!input) throw 'Must provide location data';

  const name = checkString(input.name);
  if (name.length > 100) throw 'Name cannot be longer than 100 characters';
  const type = checkType(input.type);

  const address = checkOptionalString(input.address, 'Address', 200);
  const zipCode = checkZipCode(input.zipCode);
  const latitude = checkLatitude(input.latitude);
  const longitude = checkLongitude(input.longitude);
  const phone = checkPhone(input.phone);
  const website = checkWebsite(input.website);
  const priceCategory = checkPriceCategory(input.priceCategory);

  const addedBy = actor ? new ObjectId(checkId(actor._id)) : null;
  const approved = !actor || actor.role === 'admin';

  const newLocation = {
    name,
    type,
    address,
    zipCode,
    latitude,
    longitude,
    phone,
    website,
    averageRating: null,
    totalReviews: 0,
    priceCategory,
    addedBy,
    approved,
    createdAt: new Date()
  };

  const locationsCol = await locations();
  const result = await locationsCol.insertOne(newLocation);
  if (!result.acknowledged || !result.insertedId) throw 'Could not create location';

  return serializeLocation({ ...newLocation, _id: result.insertedId });
}

export async function getLocationById(id, opts = {}) {
  if (id === undefined) throw 'Must have a locationId';
  id = checkId(id);

  const locationsCol = await locations();
  const loc = await locationsCol.findOne({ _id: new ObjectId(id) });
  if (loc === null) throw 'No location found with that id';

  if (opts.requireApproved && !loc.approved) throw 'No location found with that id';
  return serializeLocation(loc);
}

// Browse approved locations.
// filters: { type, priceCategory, minRating, search, sort }
// sort: 'top' | 'recent' | 'name' (default)
export async function browseLocations(filters = {}) {
  const query = { approved: true };

  if (filters.type) query.type = checkType(filters.type);

  if (filters.priceCategory !== undefined && filters.priceCategory !== null && filters.priceCategory !== '') {
    query.priceCategory = checkPriceCategory(filters.priceCategory);
  }

  if (filters.minRating !== undefined && filters.minRating !== null && filters.minRating !== '') {
    const min = Number(filters.minRating);
    if (isNaN(min)) throw 'Min rating must be a number';
    if (min < 1 || min > 5) throw 'Min rating must be between 1 and 5';
    query.averageRating = { $gte: min };
  }

  if (filters.search) {
    const search = checkString(filters.search);
    if (search.length > 100) throw 'Search query is too long';
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.name = { $regex: safe, $options: 'i' };
  }

  let sort;
  switch (filters.sort) {
    case 'top':
      sort = { averageRating: -1, totalReviews: -1, name: 1 };
      break;
    case 'recent':
      sort = { createdAt: -1 };
      break;
    case 'name':
    default:
      sort = { name: 1 };
      break;
  }

  const locationsCol = await locations();
  const results = await locationsCol.find(query).sort(sort).toArray();
  return results.map(serializeLocation);
}

export async function getPendingLocations() {
  const locationsCol = await locations();
  const usersCol = await users();
  const pending = await locationsCol
    .find({ approved: false })
    .sort({ createdAt: 1 })
    .toArray();
  if (pending.length === 0) return [];

  const submitterIds = [
    ...new Set(pending.filter((p) => p.addedBy).map((p) => p.addedBy.toString()))
  ].map((id) => new ObjectId(id));

  let emailById = new Map();
  if (submitterIds.length > 0) {
    const submitters = await usersCol
      .find({ _id: { $in: submitterIds } })
      .project({ email: 1 })
      .toArray();
    emailById = new Map(submitters.map((u) => [u._id.toString(), u.email]));
  }

  return pending.map((p) => {
    const out = serializeLocation(p);
    out.submitterEmail = (p.addedBy && emailById.get(p.addedBy.toString())) || '(unknown)';
    out.createdAtDisplay = p.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    return out;
  });
}

export async function approveLocation(locationId) {
  if (locationId === undefined) throw 'Must have a locationId';
  locationId = checkId(locationId);

  const locationsCol = await locations();
  const result = await locationsCol.updateOne(
    { _id: new ObjectId(locationId) },
    { $set: { approved: true } }
  );
  if (result.matchedCount === 0) throw 'No location found with that id';
  if (!result.acknowledged) throw 'Could not approve location';
  return { approved: true, locationId };
}

export async function rejectLocation(locationId) {
  if (locationId === undefined) throw 'Must have a locationId';
  locationId = checkId(locationId);

  const locationsCol = await locations();
  const oid = new ObjectId(locationId);
  const deleted = await locationsCol.findOneAndDelete({ _id: oid, approved: false });
  if (deleted) return { rejected: true, locationId };

  // findOneAndDelete didn't match — disambiguate: missing vs already-approved.
  const exists = await locationsCol.findOne({ _id: oid }, { projection: { _id: 1 } });
  if (!exists) throw 'No location found with that id';
  throw 'Cannot reject an already-approved location';
}

// $pull and $addToSet are idempotent — try the remove first; if it didn't
// modify anything, the favorite wasn't there, so add it. One round-trip on
// unfavorite, two on favorite, and no read-then-write race.
export async function toggleFavoriteLocation(userId, locationId) {
  const userOid = new ObjectId(checkId(userId));
  const locOid = new ObjectId(checkId(locationId));

  const usersCol = await users();
  const pullRes = await usersCol.updateOne(
    { _id: userOid, favoriteLocations: locOid },
    { $pull: { favoriteLocations: locOid } }
  );
  if (pullRes.modifiedCount === 1) return { favorited: false };

  const addRes = await usersCol.updateOne(
    { _id: userOid },
    { $addToSet: { favoriteLocations: locOid } }
  );
  if (addRes.matchedCount === 0) throw 'No user found with that id';
  return { favorited: true };
}

export async function getFavoriteLocationsForUser(userId) {
  userId = checkId(userId);
  const usersCol = await users();
  const user = await usersCol.findOne(
    { _id: new ObjectId(userId) },
    { projection: { favoriteLocations: 1 } }
  );
  if (user === null) throw 'No user found with that id';
  const ids = user.favoriteLocations || [];
  if (ids.length === 0) return [];

  const locationsCol = await locations();
  const list = await locationsCol
    .find({ _id: { $in: ids }, approved: true })
    .sort({ name: 1 })
    .toArray();
  return list.map(serializeLocation);
}

export async function isFavoritedByUser(userId, locationId) {
  userId = checkId(userId);
  locationId = checkId(locationId);
  const usersCol = await users();
  const user = await usersCol.findOne(
    { _id: new ObjectId(userId) },
    { projection: { favoriteLocations: 1 } }
  );
  if (!user) return false;
  return (user.favoriteLocations || []).some((id) => id.toString() === locationId);
}

// Core recommendation engine. Scores each location TYPE by the user's own
// 4+ star ratings, then returns unvisited, rated locations of those types
// ranked best-first. Returns the FULL ranked pool (up to poolSize) plus the
// signal the callers need; slicing is the caller's job.
//   → { reason: 'based-on-reviews' | 'top-rated', preferredTypes, ranked: [...] }
async function computeRankedRecommendations(userId, poolSize) {
  const userOid = new ObjectId(userId);
  const reviewsCol = await reviews();
  const locationsCol = await locations();

  const userReviews = await reviewsCol.find({ userId: userOid }).toArray();
  const reviewedIds = userReviews.map((r) => r.locationId);

  // Fallback shared by the "no reviews" and "no strong signal" cases: the
  // top-rated places the user hasn't already reviewed.
  const topRated = async () => {
    const fallback = await locationsCol
      .find({
        approved: true,
        averageRating: { $ne: null },
        _id: { $nin: reviewedIds }
      })
      .sort({ averageRating: -1, totalReviews: -1, name: 1 })
      .limit(poolSize)
      .toArray();
    return { reason: 'top-rated', preferredTypes: [], ranked: fallback.map(serializeLocation) };
  };

  if (userReviews.length === 0) return topRated();

  const reviewedLocs = await locationsCol
    .find({ _id: { $in: reviewedIds } })
    .project({ type: 1 })
    .toArray();
  const typeByLocId = new Map(reviewedLocs.map((l) => [l._id.toString(), l.type]));

  const typeScore = new Map();
  for (const r of userReviews) {
    if (r.rating < 4) continue;
    const t = typeByLocId.get(r.locationId.toString());
    if (!t) continue;
    typeScore.set(t, (typeScore.get(t) || 0) + r.rating);
  }

  if (typeScore.size === 0) return topRated();

  const preferredTypes = [...typeScore.keys()];

  const candidates = await locationsCol
    .find({
      approved: true,
      type: { $in: preferredTypes },
      _id: { $nin: reviewedIds },
      averageRating: { $ne: null }
    })
    .toArray();

  candidates.sort((a, b) => {
    const scoreA = (typeScore.get(a.type) || 0) * (a.averageRating || 0);
    const scoreB = (typeScore.get(b.type) || 0) * (b.averageRating || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if ((b.totalReviews || 0) !== (a.totalReviews || 0)) {
      return (b.totalReviews || 0) - (a.totalReviews || 0);
    }
    return a.name.localeCompare(b.name);
  });

  return {
    reason: 'based-on-reviews',
    preferredTypes,
    ranked: candidates.slice(0, poolSize).map(serializeLocation)
  };
}

// The deterministic recommendation list — used directly when the AI is off,
// and as the guaranteed fallback when an AI rank fails.
export async function getRecommendationsForUser(userId, limit = 8) {
  userId = checkId(userId);
  if (!Number.isInteger(limit) || limit < 1) limit = 8;
  if (limit > 24) limit = 24;
  const { reason, preferredTypes, ranked } = await computeRankedRecommendations(userId, limit);
  return { reason, preferredTypes, locations: ranked.slice(0, limit) };
}

// A wider, pre-vetted shortlist (default ~15) handed to the AI re-ranker.
// Every entry is already a sane, rated, unvisited match — so the AI can
// curate and order, but can never surface something broken or irrelevant.
export async function getRecommendationCandidates(userId, limit = 15) {
  userId = checkId(userId);
  if (!Number.isInteger(limit) || limit < 1) limit = 15;
  if (limit > 30) limit = 30;
  const { reason, preferredTypes, ranked } = await computeRankedRecommendations(userId, limit);
  return { reason, preferredTypes, candidates: ranked.slice(0, limit) };
}

export { ALLOWED_TYPES, serializeLocation };
