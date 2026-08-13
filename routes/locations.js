import { Router } from 'express';
import xss from 'xss';
import {
  browseLocations,
  getLocationById,
  createLocation,
  getPendingLocations,
  approveLocation,
  rejectLocation,
  toggleFavoriteLocation,
  isFavoritedByUser,
  ALLOWED_TYPES
} from '../data/locations.js';
import { getStoredOrCompute } from '../data/recommendations.js';
import { getReviewsForLocation } from '../data/reviews.js';
import { getCommentsForLocation } from '../data/comments.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { checkId } from '../helpers.js';
import planData from '../data/plans.js'

const router = Router();

function jsonError(res, e) {
  if (typeof e !== 'string') {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
  let status = 400;
  if (/no location found|no user found/i.test(e)) status = 404;
  return res.status(status).json({ ok: false, error: e });
}

function requireAdminJson(req, res) {
  if (!req.session.user) {
    res.status(401).json({ ok: false, error: 'You must be logged in' });
    return false;
  }
  if (req.session.user.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin only' });
    return false;
  }
  return true;
}

function validateCreateLocationInput(input) {
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw 'Location name is required';
  }
  if (!input.type || typeof input.type !== 'string' || input.type.trim().length === 0) {
    throw 'Location type is required';
  }
  if (!ALLOWED_TYPES.includes(input.type.toLowerCase())) {
    throw 'Type must be one of: ' + ALLOWED_TYPES.join(', ');
  }
  if (input.name.trim().length > 100) {
    throw 'Name cannot be longer than 100 characters';
  }
  if (input.zipCode && !/^\d{5}$/.test(input.zipCode.trim())) {
    throw 'ZIP code must be 5 digits';
  }
  if (input.latitude !== '') {
    const latitude = Number(input.latitude);
    if (isNaN(latitude) || latitude < -90 || latitude > 90) {
      throw 'Latitude must be between -90 and 90';
    }
  }
  if (input.longitude !== '') {
    const longitude = Number(input.longitude);
    if (isNaN(longitude) || longitude < -180 || longitude > 180) {
      throw 'Longitude must be between -180 and 180';
    }
  }
  if (input.website) {
    let url;
    try {
      url = new URL(input.website);
    } catch (e) {
      throw 'Website must be a valid URL';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw 'Website must use http or https';
    }
  }
}

router.get('/', async function (req, res) {
  const filters = {};
  if (req.query.type) filters.type = xss(String(req.query.type));
  if (req.query.priceCategory) filters.priceCategory = xss(String(req.query.priceCategory));
  if (req.query.minRating) filters.minRating = xss(String(req.query.minRating));
  if (req.query.search) filters.search = xss(String(req.query.search));
  if (req.query.sort) filters.sort = xss(String(req.query.sort));

  const vm = {
    title: 'Explore',
    types: ALLOWED_TYPES,
    activeType: filters.type || '',
    activePrice: filters.priceCategory || '',
    activeMinRating: filters.minRating || '',
    activeSearch: filters.search || '',
    activeSort: filters.sort || 'name'
  };

  try {
    const list = await browseLocations(filters);
    let recommendations = null;
    if (req.session.user) {
      try {
        // Reads the user's STORED recommendations (no AI call on page load).
        // Computes synchronously only on first-ever load; refreshes in the
        // background when stale. Each pick already carries its "why" line.
        recommendations = await getStoredOrCompute(req.session.user._id);
      } catch (recErr) {
        console.error('recommendations failed:', recErr);
      }
    }
    return res.render('explore', {
      ...vm,
      locations: list,
      empty: list.length === 0,
      recommendations
    });
  } catch (e) {
    return res.status(400).render('explore', {
      ...vm,
      locations: [],
      empty: true,
      error: typeof e === 'string' ? e : 'Server error'
    });
  }
});

router.get('/add', requireLogin, async function (req, res) {
  res.render('addLocation', { title: 'Suggest a Location', types: ALLOWED_TYPES });
});

router.post('/', requireLogin, async function (req, res) {
  const body = req.body || {};
  const input = {
    name: xss(body.name || ''),
    type: xss(body.type || ''),
    address: xss(body.address || ''),
    zipCode: xss(body.zipCode || ''),
    latitude: xss(String(body.latitude ?? '')),
    longitude: xss(String(body.longitude ?? '')),
    phone: xss(body.phone || ''),
    website: xss(body.website || ''),
    priceCategory: xss(String(body.priceCategory ?? ''))
  };
  const vm = { title: 'Suggest a Location', types: ALLOWED_TYPES };

  try {
    validateCreateLocationInput(input);
    const created = await createLocation(input, { actor: req.session.user });
    if (created.approved) return res.redirect('/explore/' + created._id);
    return res.render('addLocation', {
      ...vm,
      success: 'Thanks! Your location was submitted and is awaiting admin approval.'
    });
  } catch (e) {
    return res.status(400).render('addLocation', {
      ...vm,
      ...input,
      error: typeof e === 'string' ? e : 'Could not create location'
    });
  }
});

router.get('/admin/pending', requireAdmin, async function (req, res) {
  try {
    const pending = await getPendingLocations();
    return res.render('adminLocationsHost', { title: 'Pending Locations', pending });
  } catch (e) {
    return res.status(500).render('error', {
      title: 'Server Error',
      error: typeof e === 'string' ? e : 'Server error'
    });
  }
});

router.post('/admin/:id/approve', async function (req, res) {
  if (!requireAdminJson(req, res)) return;
  try {
    const result = await approveLocation(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return jsonError(res, e);
  }
});

router.post('/admin/:id/reject', async function (req, res) {
  if (!requireAdminJson(req, res)) return;
  try {
    const result = await rejectLocation(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return jsonError(res, e);
  }
});

router.post('/:id/favorite', async function (req, res) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: 'You must be logged in' });
  }
  try {
    const result = await toggleFavoriteLocation(req.session.user._id, req.params.id);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return jsonError(res, e);
  }
});

router.get('/:id', async function (req, res) {
  let locationId;
  try {
    locationId = checkId(req.params.id);
  } catch (e) {
    return res.status(400).render('error', {
      title: 'Bad Request',
      error: typeof e === 'string' ? e : 'Invalid id'
    });
  }

  try {
    const sessionUser = req.session.user;
    const isAdmin = !!(sessionUser && sessionUser.role === 'admin');
    const location = await getLocationById(locationId, { requireApproved: !isAdmin });

    const [reviewsList, commentsList, isFavorited] = await Promise.all([
      getReviewsForLocation(locationId),
      getCommentsForLocation(locationId),
      sessionUser ? isFavoritedByUser(sessionUser._id, locationId) : Promise.resolve(false)
    ]);

    const userReview = sessionUser
      ? reviewsList.find((r) => r.userId === sessionUser._id) || null
      : null;

    const userPlans = req.session.user ? await planData.getAllPlans(req.session.user._id) : []
    return res.render('locationDetail', {
      title: location.name,
      location,
      reviewsList,
      commentsList,
      userReview,
      isFavorited,
      isPending: !location.approved,
      userPlans,
      user: req.session.user,
      planError: req.query.planError || null
    });
  } catch (e) {
    if (typeof e === 'string' && /no location found/i.test(e)) {
      return res.status(404).render('error', { title: 'Not Found', error: 'Location not found' });
    }
    return res.status(500).render('error', {
      title: 'Server Error',
      error: typeof e === 'string' ? e : 'Server error'
    });
  }
});

export default router;
