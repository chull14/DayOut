// data/ai.js
//
// Writes ONE short "why this fits you" sentence per recommended location,
// using Anthropic's Messages API.
//
// Design contract ("build now, key later"):
//   - With an API key (AI_API_KEY set), it asks Claude to write the sentences.
//   - With no key, or on ANY error/timeout, it silently falls back to a
//     deterministic heuristic sentence.
// Callers therefore never have to handle failure: annotateRecommendations()
// ALWAYS returns the locations with a `.why` string attached. The AI is
// seasoning, never a hard dependency.

const API_KEY = process.env.AI_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-latest';

const TIMEOUT_MS = 6000; // hard ceiling — a page load must never hang on the AI
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX = 200;

// Simple in-memory cache so re-loading Explore doesn't re-call the API for the
// same set of recommendations. Keyed by the reason + the exact location ids.
const cache = new Map(); // key -> { at: epochMs, reasons: string[] }

export function aiIsConfigured() {
  return API_KEY.length > 0;
}

// ---- Heuristic fallback (no network, always available) --------------------

function typePhrase(type) {
  switch (type) {
    case 'cafe': return 'cafe';
    case 'museum': return 'museum';
    case 'park': return 'green space';
    case 'restaurant': return 'restaurant';
    default: return 'spot';
  }
}

// A plain, honest sentence built from data we already have. This is what shows
// when there is no API key — the feature is fully usable without any AI.
function heuristicReason(loc, context) {
  const rating =
    typeof loc.averageRating === 'number' ? loc.averageRating.toFixed(1) : null;
  const phrase = typePhrase(loc.type);

  if (context.reason === 'based-on-reviews') {
    const liked = (context.preferredTypes || []).includes(loc.type);
    if (liked && rating) {
      return `A ${rating}★ ${phrase} — you tend to rate ${phrase}s highly.`;
    }
    if (liked) {
      return `A ${phrase}, the kind of place you've enjoyed before.`;
    }
    return rating
      ? `Highly rated at ${rating}★ by other visitors.`
      : `Popular with other DayOut visitors.`;
  }
  // reason === 'top-rated'
  return rating
    ? `One of NYC's top-rated spots at ${rating}★.`
    : `A crowd favorite on DayOut.`;
}

// ---- Provider calls --------------------------------------------------------

function buildPrompt(context, locations) {
  const preferred = (context.preferredTypes || []).join(', ') || 'none yet';
  const lines = locations.map((l, i) => {
    const rating =
      typeof l.averageRating === 'number' ? `${l.averageRating}★` : 'no rating';
    return `${i + 1}. ${l.name} — type: ${l.type}, ${rating}`;
  });
  return [
    'You help a NYC day-trip app explain its recommendations.',
    `The user tends to enjoy these place types: ${preferred}.`,
    'For each numbered place below, write ONE short sentence (max 15 words)',
    'telling the user why it might suit them. Be warm and concrete, never salesy.',
    'Do not mention that you are an AI. Do not add numbering or quotes.',
    `Return ONLY a JSON array of ${locations.length} strings, in the same order.`,
    '',
    lines.join('\n')
  ].join('\n');
}

async function callAnthropic(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}

// Pull a JSON array of strings out of the model's text, tolerating stray prose
// or code fences around it.
function parseReasons(text, expectedLength) {
  if (!text) return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  let arr;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== expectedLength) return null;
  if (!arr.every((s) => typeof s === 'string' && s.trim().length > 0)) return null;
  return arr.map((s) => s.trim());
}

// ---- Public API ------------------------------------------------------------

// Attaches a `.why` string to every location and returns the same array.
// NEVER throws: on missing key / error / timeout it uses the heuristic.
export async function annotateRecommendations(context, locations) {
  if (!Array.isArray(locations) || locations.length === 0) return locations;

  const withHeuristic = () =>
    locations.map((loc) => ({ ...loc, why: heuristicReason(loc, context) }));

  if (!aiIsConfigured()) return withHeuristic();

  const cacheKey =
    `${context.reason}|${locations.map((l) => l._id).join(',')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return locations.map((loc, i) => ({ ...loc, why: hit.reasons[i] }));
  }

  try {
    const prompt = buildPrompt(context, locations);
    const text = await callAnthropic(prompt);
    const reasons = parseReasons(text, locations.length);
    if (!reasons) return withHeuristic();

    // Cache success only. Cap the cache with simple FIFO eviction.
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at: Date.now(), reasons });

    return locations.map((loc, i) => ({ ...loc, why: reasons[i] }));
  } catch (err) {
    console.error('AI reason generation failed, using heuristic:', err.message);
    return withHeuristic();
  }
}
