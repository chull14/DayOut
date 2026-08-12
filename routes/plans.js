import { Router } from 'express';
const router = Router();
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import planData from '../data/plans.js'
import { getLocationById } from '../data/locations.js';
import { locations } from '../config/mongoCollections.js';
import distance from '@turf/distance';
import { checkId } from '../helpers.js';
import { requireLogin } from '../middleware/auth.js';

// Every plans route needs an authenticated user.
router.use(requireLogin);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedLocationsPath = path.join(__dirname, '..', 'seed-data', 'locations.json');
let seedLocationByNameCache = null;

async function getSeedLocationByNameMap() {
  if (seedLocationByNameCache) return seedLocationByNameCache;

  try {
    const raw = await fs.readFile(seedLocationsPath, 'utf8');
    const list = JSON.parse(raw);
    const map = new Map();
    for (const loc of list) {
      const key = String(loc?.name || '').trim().toLowerCase();
      if (!key) continue;
      map.set(key, loc);
    }
    seedLocationByNameCache = map;
    return map;
  } catch (e) {
    seedLocationByNameCache = new Map();
    return seedLocationByNameCache;
  }
}

function estimateMinutesFromMeters(distanceMeters) {
  const distanceMiles = distanceMeters * 0.000621371;
  const minutes = 5 + (distanceMiles * 4);
  return Math.max(5, Math.round(minutes));
}

async function computeTravelEstimates(activities) {
  if (!Array.isArray(activities) || activities.length < 2) {
    return { travelLegs: [], totalTravelMinutes: 0, unknownLegCount: 0 };
  }

  const locationsCol = await locations();
  const seedLocationByName = await getSeedLocationByNameMap();
  const locationCache = new Map();

  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const resolveLocationForActivity = async (activity) => {
    const id = activity?.locationId?.toString?.() || '';
    const name = (activity?.locationName || '').trim();
    const cacheKey = id ? `id:${id}` : `name:${name.toLowerCase()}`;

    if (locationCache.has(cacheKey)) return locationCache.get(cacheKey);

    let found = null;
    if (id) {
      try {
        found = await getLocationById(id);
      } catch (e) {
        found = null;
      }
    }

    if (!found && name) {
      found = await locationsCol.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }
      });
    }

    if (
      found &&
      !(typeof found.latitude === 'number' && typeof found.longitude === 'number') &&
      name
    ) {
      const seedLoc = seedLocationByName.get(name.toLowerCase());
      if (seedLoc && typeof seedLoc.latitude === 'number' && typeof seedLoc.longitude === 'number') {
        found = {
          ...found,
          latitude: seedLoc.latitude,
          longitude: seedLoc.longitude
        };
      }
    }

    locationCache.set(cacheKey, found);
    return found;
  };

  const resolvedLocations = [];
  for (const activity of activities) {
    resolvedLocations.push(await resolveLocationForActivity(activity));
  }

  const travelLegs = [];
  let totalTravelMinutes = 0;
  let unknownLegCount = 0;

  for (let i = 0; i < activities.length - 1; i++) {
    const fromAct = activities[i];
    const toAct = activities[i + 1];
    const fromLoc = resolvedLocations[i];
    const toLoc = resolvedLocations[i + 1];

    let minutes = null;
    if (
      fromLoc &&
      toLoc &&
      typeof fromLoc.latitude === 'number' &&
      typeof fromLoc.longitude === 'number' &&
      typeof toLoc.latitude === 'number' &&
      typeof toLoc.longitude === 'number'
    ) {
      const fromPoint = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [fromLoc.longitude, fromLoc.latitude]
        }
      };
      const toPoint = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [toLoc.longitude, toLoc.latitude]
        }
      };
      const distanceMiles = distance(fromPoint, toPoint, { units: 'miles' });
      const distanceMeters = distanceMiles * 1609.34;
      minutes = estimateMinutesFromMeters(distanceMeters);
      totalTravelMinutes += minutes;
    } else {
      unknownLegCount++;
    }

    travelLegs.push({
      fromName: fromAct.locationName || 'Unknown',
      toName: toAct.locationName || 'Unknown',
      minutes
    });
  }

  return {
    travelLegs,
    totalTravelMinutes,
    unknownLegCount
  };
}

router.route('/') // main page
  .get(async (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0]
    try {
      const userId = checkId(req.session.user._id)
      const plan = await planData.getPlanByDate(userId, date)
      res.render('planner', { title: 'Planner', plan, date })
    } catch (e) {
      // no plan found for that date — render empty planner
      res.render('planner', { title: 'Planner', plan: null, date })
    }
  })
  .post(async (req, res) => { // DONE
    // this will give the user the ability to create a new plan
    const fallbackDate = req.body?.date || new Date().toISOString().split('T')[0]
    try {
      const userId = checkId(req.session.user._id)

      if (!req.body) return res.status(400).render('error', { error: 'No data provided' })
      const { title, date, locations } = req.body
      const isPublic = req.body.isPublic === 'true' || req.body.isPublic === true

      const plan = await planData.newPlan(userId, title, date, isPublic, locations)
      res.redirect(`/plans?date=${plan.date}`)
    } catch (e) {
      res.status(e.status || 400).render('planner', {
        title: 'Planner',
        plan: null,
        date: fallbackDate,
        error: e.message || e
      })
    }
  });

router.get('/all', async (req, res) => { // DONE
  // this will retrieve all of the saved plans belonging to the logged-in user 
  try {
    const userId = checkId(req.session.user._id)
    const plans = await planData.getAllPlans(userId)

    res.render('plans', { title: 'My Plans', plans })
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
})

router.post('/activities', async (req, res) => {
  const locationId = req.body?.locationId

  try {
    const userId = checkId(req.session.user._id)

    if (!req.body) return res.status(400).render('error', { error: 'No data provided' })

    const { planId, locationName, startTime, endTime, notes } = req.body
    if (!planId || !locationId || !locationName || !startTime || !endTime)
      return res.status(400).render('error', { error: 'Missing required fields' })

    const plan = await planData.getPlanById(planId)
    if (plan.userId.toString() !== userId)
      return res.status(403).render('error', { error: 'Unauthorized' })

    await planData.addActivity(planId, locationId, locationName, startTime, endTime, notes)
    res.redirect(`/plans/${planId}`)
  } catch (e) {
    if (e.status === 400 && locationId) {
      return res.redirect(`/explore/${locationId}?planError=${encodeURIComponent(e.message || e)}`)
    }
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
})

router.post('/:planId/photos', async (req, res) => {
  try {
    const userId = req.session.user._id
    const planId = req.params.planId
    const photoUrl = req.body.photoUrl

    const plan = await planData.getPlanById(planId)
    if (plan.userId.toString() !== userId) {
      return res.status(403).render('error', { error: 'Unauthorized' })
    }

    await planData.addPhoto(planId, photoUrl)
    res.redirect('/profile')
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
})

router.route('/:planId') // plan specific page
  .get(async (req, res) => { // DONE
    // this will retrieve a plan specified by the user on the frontend
    try {
      const userId = checkId(req.session.user._id)
      const planId = checkId(req.params.planId)

      const plan = await planData.getPlanById(planId)

      if (plan.userId.toString() !== userId && !plan.isPublic)
        return res.status(403).render('error', { error: 'Unauthorized' })

      plan.activities.sort((a, b) => {
        const toMinutes = (time) => {
          const [hourMin, period] = time.split(/(AM|PM)/)
          let [hours, minutes] = hourMin.trim().split(':').map(Number)
          if (period === 'PM' && hours !== 12) hours += 12
          if (period === 'AM' && hours === 12) hours = 0
          return hours * 60 + minutes
        }
        return toMinutes(a.startTime) - toMinutes(b.startTime)
      })

      const isOwner = plan.userId.toString() === userId
      const travel = await computeTravelEstimates(plan.activities || []);
      res.render('plans', {
        title: 'Current Plan',
        plan,
        isOwner,
        travelLegs: travel.travelLegs,
        totalTravelMinutes: travel.totalTravelMinutes,
        unknownLegCount: travel.unknownLegCount
      })
    } catch (e) {
      res.status(e.status || 500).render('error', { error: e.message || e })
    }
  })
  .put(async (req, res) => { // DONE
    // update the time, change date, etc. of a pre-existing plan
    try {
      const userId = checkId(req.session.user._id)
      const planId = checkId(req.params.planId)

      const plan = await planData.getPlanById(planId)
      if (plan.userId.toString() !== userId)
        return res.status(403).render('error', { error: 'Unauthorized' })

      if (!req.body) return res.status(400).render('error', { error: 'No data provided' })
      const { title, date, status } = req.body
      const isPublic = req.body.isPublic === 'true'

      const updatedPlan = await planData.updatePlan(planId, { title, date, status, isPublic })
      res.redirect(`/plans/${updatedPlan._id}`)
    } catch (e) {
      res.status(e.status || 500).render('error', { error: e.message || e })
    }
  })
  .delete(async (req, res) => { // DONE
    // delete a plan
    try {
      const userId = checkId(req.session.user._id)
      const planId = checkId(req.params.planId)
      const plan = await planData.getPlanById(planId)
      if (plan.userId.toString() !== userId)
        return res.status(403).render('error', { error: 'Unauthorized' })

      await planData.deletePlan(planId)
      res.redirect('/plans')
    } catch (e) {
      res.status(e.status || 500).render('error', { error: e.message || e })
    }
  })

router.route('/:planId/activities')
  .get(async (req, res) => { // DONE
    // this will retrive all of the activities/locations of a specific plan
    try {
      const userId = checkId(req.session.user._id)
      const planId = checkId(req.params.planId)

      const plan = await planData.getPlanById(planId)
      if (plan.userId.toString() !== userId)
        return res.status(403).render('error', { error: 'Unauthorized' })

      res.render('activities', { title: 'Plan Activities', activities: plan.activities })  // use plan.activities directly
    } catch (e) {
      res.status(e.status || 500).render('error', { error: e.message || e })
    }
  })
// Note: adding an activity is handled by POST /plans/activities (which passes
// locationName through to planData.addActivity). The old POST /:planId/activities
// handler was unused and called addActivity with a shifted argument list, so it
// has been removed to avoid a second, broken code path.

router.route('/:planId/activities/:activityId')
  .put(async (req, res) => { // DONE
    // update a activity and its parameters
    try {
      const userId = checkId(req.session.user._id)
      const { planId, activityId } = req.params
      const { startTime, endTime, notes } = req.body

      const plan = await planData.getPlanById(planId)
      if (plan.userId.toString() !== userId)
        return res.status(403).render('error', { error: 'Unauthorized' })

      await planData.updateActivity(planId, activityId, { startTime, endTime, notes })
      res.redirect(`/plans/${planId}`)
    } catch (e) {
      res.status(e.status || 500).render('error', { error: e.message || e })
    }
  })
  .delete(async (req, res) => { // DONE
    // delete a specific activity
    try {
      const userId = checkId(req.session.user._id)
      const { planId, activityId } = req.params

      const plan = await planData.getPlanById(planId)
      if (plan.userId.toString() !== userId)
        return res.status(403).render('error', { error: 'Unauthorized' })

      await planData.deleteActivity(planId, activityId)
      res.redirect(`/plans/${planId}`)
    } catch (e) {
      res.status(e.status || 500).render('error', { error: e.message || e })
    }
  })

export default router;
