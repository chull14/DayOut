import { Router } from 'express'
const router = Router();
import friendData from '../data/friends.js'
import { checkId } from '../helpers.js';
import { requireLogin } from '../middleware/auth.js';

// Every friends route needs an authenticated user.
router.use(requireLogin);

router.get('/', async (req, res) => {
  // GET all friends
  try {
    const userId = checkId(req.session.user._id)
    const friendsList = await friendData.getFriends(userId)
    const pending = await friendData.getPendingReq(userId)
    res.render('friends', { title: 'Friends', friendsList, pending })
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
});

router.get('/search', async (req, res) => {
  try {
    const userId = checkId(req.session.user._id)
    const query = req.query.q
    const results = query ? await friendData.searchUsers(query, userId) : []
    const friendsList = await friendData.getFriends(userId)
    const pending = await friendData.getPendingReq(userId)

    res.render('friends', { title: 'Friends', friendsList, pending, searchResults: results, query })
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
});

router.post('/request/:userId', async (req, res) => {
  // POST send friend request
  try {
    const reqId = checkId(req.session.user._id)
    const recId = checkId(req.params.userId)
    await friendData.sendFriendReq(reqId, recId)
    res.redirect('/friends')
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
});

router.post('/accept/:reqId', async (req, res) => {
  // POST accept a friend request
  try {
    const recId = checkId(req.session.user._id)
    const reqId = checkId(req.params.reqId)
    await friendData.acceptFriendReq(reqId, recId)
    res.redirect('/friends')
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
});

router.post('/decline/:reqId', async (req, res) => {
  // POST decline a friend request
  try {
    const recId = checkId(req.session.user._id)
    const reqId = checkId(req.params.reqId)
    await friendData.declineFriendReq(reqId, recId)
    res.redirect('/friends')
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
});

router.post('/remove/:friendId', async (req, res) => {
  try {
    const userId = checkId(req.session.user._id)
    const friendId = checkId(req.params.friendId)
    await friendData.removeFriend(userId, friendId)
    res.redirect('/friends')
  } catch (e) {
    res.status(e.status || 500).render('error', { error: e.message || e })
  }
});

export default router;