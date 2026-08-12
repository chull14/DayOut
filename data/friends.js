import { users, plans } from "../config/mongoCollections.js"
import { ObjectId } from "mongodb"
import { checkId } from "../helpers.js"

// Fields safe to send to templates / the client. Never expose hashedPassword.
const PUBLIC_USER_FIELDS = { firstName: 1, lastName: 1, email: 1 }

const exportedMethods = {
  async sendFriendReq(reqId, recId) {
    reqId = checkId(reqId)
    recId = checkId(recId)

    if (reqId === recId) throw { status: 400, message: 'Cannot send friend request to yourself' }

    const userCollection = await users()

    const requester = await userCollection.findOne({ _id: new ObjectId(reqId) })
    if (!requester) throw { status: 404, message: 'Requesting user not found' }

    const recipient = await userCollection.findOne({ _id: new ObjectId(recId) })
    if (!recipient) throw { status: 404, message: 'User not found' }

    // already friends?
    if ((requester.friends || []).some(id => id.toString() === recId))
      throw { status: 400, message: 'Already friends' }

    // request already sent and still pending?
    if ((recipient.pendingRequests || []).some(id => id.toString() === reqId))
      throw { status: 400, message: 'Friend request already sent' }

    // the other person already requested you — nudge toward accepting instead
    if ((requester.pendingRequests || []).some(id => id.toString() === recId))
      throw { status: 400, message: 'This user already sent you a request — accept it instead' }

    // $addToSet keeps pendingRequests free of duplicates even under a double-submit
    const result = await userCollection.updateOne(
      { _id: new ObjectId(recId) },
      { $addToSet: { pendingRequests: new ObjectId(reqId) } }
    )

    if (result.matchedCount === 0) throw { status: 500, message: 'Could not send friend request' }

    return { status: 'pending' }
  },

  async acceptFriendReq(reqId, recId) {
    reqId = checkId(reqId)
    recId = checkId(recId)

    const userCollection = await users()

    // Only accept a request that is actually pending. Pulling it here also acts
    // as the guard: matchedCount reflects whether the pending request existed.
    const pullResult = await userCollection.updateOne(
      { _id: new ObjectId(recId), pendingRequests: new ObjectId(reqId) },
      {
        $addToSet: { friends: new ObjectId(reqId) },
        $pull: { pendingRequests: new ObjectId(reqId) }
      }
    )

    if (pullResult.matchedCount === 0)
      throw { status: 404, message: 'No pending request from that user' }

    // $addToSet avoids a duplicate friend entry if this ever runs twice
    await userCollection.updateOne(
      { _id: new ObjectId(reqId) },
      { $addToSet: { friends: new ObjectId(recId) } }
    )

    return { status: 'accepted' }
  },

  async declineFriendReq(reqId, recId) {
    reqId = checkId(reqId)
    recId = checkId(recId)

    const userCollection = await users()
    const result = await userCollection.updateOne(
      { _id: new ObjectId(recId) },
      { $pull: { pendingRequests: new ObjectId(reqId) } }
    )

    if (result.modifiedCount === 0) throw { status: 404, message: 'Request not found' }

    return { status: 'declined' }
  },

  async getFriends(userId) {
    userId = checkId(userId)

    const userCollection = await users()
    const user = await userCollection.findOne({ _id: new ObjectId(userId) })

    if (!user) throw { status: 404, message: 'User not found' }

    const friendList = await userCollection.find(
      { _id: { $in: user.friends || [] } },
      { projection: PUBLIC_USER_FIELDS }
    ).toArray()

    const planCollection = await plans()
    const friendsWithPlans = await Promise.all(
      friendList.map(async (friend) => {
        const recentPlan = await planCollection.findOne(
          { userId: friend._id, isPublic: true },
          { sort: { createdAt: -1 } }
        )
        return { ...friend, recentPlan }
      })
    )

    return friendsWithPlans
  },

  async getPendingReq(userId) {
    userId = checkId(userId)

    const userCollection = await users()
    const user = await userCollection.findOne({ _id: new ObjectId(userId) })

    if (!user) throw { status: 404, message: 'User not found' }

    const pending = await userCollection.find(
      { _id: { $in: user.pendingRequests || [] } },
      { projection: PUBLIC_USER_FIELDS }
    ).toArray()

    return pending
  },

  async searchUsers(query, currentUserId) {
    currentUserId = checkId(currentUserId)
    if (typeof query !== 'string' || query.trim().length === 0)
      throw { status: 400, message: 'Search query is required' }

    // Escape regex metacharacters so a search term is matched literally
    // (prevents ReDoS / accidental pattern injection from user input).
    const safe = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const userCollection = await users()
    const results = await userCollection.find(
      {
        _id: { $ne: new ObjectId(currentUserId) },
        $or: [
          { firstName: { $regex: safe, $options: 'i' } },
          { lastName: { $regex: safe, $options: 'i' } },
          { email: { $regex: safe, $options: 'i' } }
        ]
      },
      { projection: PUBLIC_USER_FIELDS }
    ).limit(25).toArray()

    return results
  },

  async removeFriend(userId, friendId) {
    userId = checkId(userId)
    friendId = checkId(friendId)

    const userCollection = await users()

    await userCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $pull: { friends: new ObjectId(friendId) } }
    )

    await userCollection.updateOne(
      { _id: new ObjectId(friendId) },
      { $pull: { friends: new ObjectId(userId) } }
    )

    return { status: 'removed' }
  }
}

export default exportedMethods