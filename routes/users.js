import { Router } from 'express';
import { createUser, loginUser, getUserById } from '../data/users.js';
import { getFavoriteLocationsForUser } from '../data/locations.js';
import { requireLogin, requireGuest, requireAdmin } from '../middleware/auth.js';
import planData from '../data/plans.js';
import friendData from '../data/friends.js';
import { checkId } from '../helpers.js';
import xss from 'xss';

const router = Router();
const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

function validateLoginInput(email, password) {
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw 'Email is required';
  }
  if (typeof password !== 'string' || password.trim().length === 0) {
    throw 'Password is required';
  }
}

function validateSignupInput(firstName, lastName, email, password, confirmPassword) {
  if (typeof firstName !== 'string' || firstName.trim().length === 0) {
    throw 'First name is required';
  }
  if (typeof lastName !== 'string' || lastName.trim().length === 0) {
    throw 'Last name is required';
  }
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw 'Email is required';
  }
  if (typeof password !== 'string' || password.trim().length === 0) {
    throw 'Password is required';
  }
  if (typeof confirmPassword !== 'string' || confirmPassword.trim().length === 0) {
    throw 'Confirm password is required';
  }

  if (firstName.trim().length < 2 || firstName.trim().length > 20) {
    throw 'First name must be between 2 and 20 characters';
  }
  if (lastName.trim().length < 2 || lastName.trim().length > 20) {
    throw 'Last name must be between 2 and 20 characters';
  }
  // Letters (incl. accented), spaces, hyphens and apostrophes; must start with
  // a letter. Kept in sync with checkName() in helpers.js.
  const nameRegex = /^\p{L}[\p{L} '-]*$/u;
  if (!nameRegex.test(firstName.trim())) {
    throw 'First name must contain only letters, spaces, hyphens, and apostrophes';
  }
  if (!nameRegex.test(lastName.trim())) {
    throw 'Last name must contain only letters, spaces, hyphens, and apostrophes';
  }

  if (password.length < 8) throw 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) throw 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) throw 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) throw 'Password must contain at least one number';
  if (!/[!@#$%^&*]/.test(password)) throw 'Password must contain at least one special character (!@#$%^&*)';
  if (/\s/.test(password)) throw 'Password cannot contain spaces';

  if (password !== confirmPassword) {
    throw 'Passwords do not match';
  }
}

// GET /login
router.get('/login', requireGuest, async function (req, res) {
  res.render('login', { title: 'Login' });
});

// POST /login
router.post('/login', requireGuest, async function (req, res) {
  let body = req.body;
  if (!body) body = {};

  try {
    let email = xss(body.email);
    let password = xss(body.password);
    validateLoginInput(email, password);

    const user = await loginUser(email, password);
    req.session.user = user;

    const redirectTo = user.role === 'admin' ? '/admin' : '/explore';
    if (wantsJson(req)) {
      return res.json({ ok: true, redirectTo });
    }

    if (user.role === 'admin') {
      return res.redirect('/admin');
    } else {
      return res.redirect('/explore');
    }
  } catch (e) {
    const errorMessage = typeof e === 'string' ? e : 'Unable to log in';
    if (wantsJson(req)) {
      return res.status(400).json({ ok: false, error: errorMessage });
    }

    return res.status(400).render('login', {
      title: 'Login',
      error: errorMessage,
      email: body.email
    });
  }
});

// GET /signup
router.get('/signup', requireGuest, async function (req, res) {
  res.render('signup', { title: 'Sign Up' });
});

// POST /signup
router.post('/signup', requireGuest, async function (req, res) {
  let body = req.body;
  if (!body) body = {};

  try {
    let firstName = xss(body.firstName);
    let lastName = xss(body.lastName);
    let email = xss(body.email);
    let password = xss(body.password);
    let confirmPassword = xss(body.confirmPassword);
    validateSignupInput(firstName, lastName, email, password, confirmPassword);

    const result = await createUser(firstName, lastName, email, password);

    if (result.signupCompleted === true) {
      if (wantsJson(req)) {
        return res.json({ ok: true, redirectTo: '/login' });
      }
      return res.redirect('/login');
    }

    return res.status(500).render('error', {
      title: 'Internal Server Error',
      error: 'Internal Server Error'
    });
  } catch (e) {
    const errorMessage = typeof e === 'string' ? e : 'Unable to create account';
    const isDuplicateEmail =
      errorMessage.toLowerCase().includes('email') &&
      (errorMessage.toLowerCase().includes('already') ||
        errorMessage.toLowerCase().includes('used'));

    if (wantsJson(req)) {
      return res.status(400).json({
        ok: false,
        error: errorMessage,
        emailError: isDuplicateEmail ? 'An account with this email already exists' : ''
      });
    }

    return res.status(400).render('signup', {
      title: 'Sign Up',
      error: errorMessage,
      emailError: isDuplicateEmail ? 'An account with this email already exists' : '',
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email
    });
  }
});

// GET /profile
router.get('/profile', requireLogin, async function (req, res) {
  try {
    const user = await getUserById(req.session.user._id);
    const rawPlans = await planData.getAllPlans(req.session.user._id);
    const plans = rawPlans.map((plan) => ({
      ...plan,
      _id: plan._id?.toString ? plan._id.toString() : String(plan._id),
      title: typeof plan.title === 'string' && plan.title.trim().length > 0 ? plan.title : 'Untitled Plan',
      date: plan.date || '',
      status: plan.status || 'active',
      isPublic: !!plan.isPublic,
      photos: Array.isArray(plan.photos) ? plan.photos : []
    }));
    const favoriteSpots = await getFavoriteLocationsForUser(req.session.user._id);
    const savedPlans = plans.filter((plan) => plan.status === 'saved');
    const friendsList = await friendData.getFriends(req.session.user._id);

    res.render('profile', {
      title: 'Profile',
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      favoriteLocations: user.favoriteLocations,
      favoriteSpots,
      friends: friendsList,
      createdAt: user.createdAt,
      plans,
      savedPlans
    });
  } catch (e) {
    return res.status(500).render('error', {
      title: 'Error',
      error: e
    });
  }
});

// GET /profile/:userId — a public view of another member: name, favorite
// spots, and their PUBLIC plans only. Never exposes email or private plans.
router.get('/profile/:userId', requireLogin, async function (req, res) {
  try {
    const viewerId = req.session.user._id;
    const targetId = checkId(req.params.userId);

    // Your own public profile is just your profile.
    if (targetId === viewerId) return res.redirect('/profile');

    const user = await getUserById(targetId);
    const favoriteSpots = await getFavoriteLocationsForUser(targetId);
    const publicPlans = await planData.getPublicPlansByUser(targetId);
    const myFriends = await friendData.getFriends(viewerId);
    const isFriend = myFriends.some((f) => f._id.toString() === targetId);

    res.render('publicProfile', {
      title: `${user.firstName} ${user.lastName}`,
      profileId: targetId,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      favoriteSpots,
      publicPlans,
      isFriend
    });
  } catch (e) {
    const message = typeof e === 'string' ? e : e.message || 'Unable to load profile';
    const status = /no user found|not a valid id/i.test(message) ? 404 : 500;
    return res.status(status).render('error', { title: 'Error', error: message });
  }
});

// POST /logout
router.post('/logout', requireLogin, async function (req, res) {
  req.session.destroy(function () {
    res.clearCookie('DayOutNYC');
    res.redirect('/login');
  });
});

export default router;
