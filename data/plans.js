import { plans, users } from '../config/mongoCollections.js'
import { ObjectId } from 'mongodb'
import { checkId, checkDate, checkString, checkTime } from '../helpers.js'

// Convert a plan's ObjectId fields (its own _id/userId and each activity's
// _id/locationId) to strings so callers/templates get plain data, matching how
// the other data modules serialize before returning.
function serializePlan(plan) {
  if (!plan) return plan
  const out = {
    ...plan,
    _id: plan._id?.toString?.() ?? plan._id,
    userId: plan.userId?.toString?.() ?? plan.userId
  }
  if (Array.isArray(plan.activities)) {
    out.activities = plan.activities.map((a) => ({
      ...a,
      _id: a._id?.toString?.() ?? a._id,
      locationId: a.locationId?.toString?.() ?? a.locationId
    }))
  }
  if (Array.isArray(plan.reactions)) {
    out.reactions = plan.reactions.map((r) => r?.toString?.() ?? r)
  }
  if (Array.isArray(plan.comments)) {
    out.comments = plan.comments.map((c) => ({
      ...c,
      _id: c._id?.toString?.() ?? c._id,
      userId: c.userId?.toString?.() ?? c.userId
    }))
  }
  return out
}

// What kind of querying:
// - empty query (handled on frontend?)
// - retrieve all of user's plans
// - retrieve specific plans by id
// - update specific plan by id
// - delete a plan by id

const exportedMethods = {
  async getAllPlans(userId) {
    // GET
    userId = checkId(userId)
    const planCollection = await plans()
    const all = await planCollection.find({ userId: new ObjectId(userId) }).toArray()
    return all.map(serializePlan)
  },

  async getFriendsPublicPlans(userId) {
    // GET — the social feed: every public plan authored by one of my friends,
    // newest first, tagged with the author's display name + a stop count.
    userId = checkId(userId)
    const userCollection = await users()
    const me = await userCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: { friends: 1 } }
    )
    const friendIds = me?.friends || []
    if (friendIds.length === 0) return []

    const planCollection = await plans()
    const feedPlans = await planCollection
      .find({ userId: { $in: friendIds }, isPublic: true })
      .sort({ createdAt: -1 })
      .toArray()
    if (feedPlans.length === 0) return []

    // One round-trip to resolve author names for every plan in the feed.
    const authorIds = [...new Set(feedPlans.map((p) => p.userId.toString()))]
      .map((id) => new ObjectId(id))
    const authors = await userCollection
      .find({ _id: { $in: authorIds } }, { projection: { firstName: 1, lastName: 1 } })
      .toArray()
    const nameById = new Map(
      authors.map((a) => [a._id.toString(), `${a.firstName} ${a.lastName}`.trim()])
    )

    return feedPlans.map((p) => ({
      ...serializePlan(p),
      authorName: nameById.get(p.userId.toString()) || 'A friend',
      activityCount: Array.isArray(p.activities) ? p.activities.length : 0,
      reactionCount: Array.isArray(p.reactions) ? p.reactions.length : 0,
      commentCount: Array.isArray(p.comments) ? p.comments.length : 0
    }))
  },

  async clonePlan(planId, newOwnerId) {
    // POST — copy a plan into the requester's own plans. Clones start private
    // and active so the new owner can edit before re-sharing. You may clone
    // your own plan or any public one; private plans you don't own are off-limits.
    planId = checkId(planId)
    newOwnerId = checkId(newOwnerId)

    const planCollection = await plans()
    const source = await planCollection.findOne({ _id: new ObjectId(planId) })
    if (!source) throw { status: 404, message: 'Plan not found' }

    if (source.userId.toString() !== newOwnerId && !source.isPublic)
      throw { status: 403, message: 'This plan is private' }

    const clonedActivities = Array.isArray(source.activities)
      ? source.activities.map((a) => ({
          _id: new ObjectId(),
          locationId: a.locationId ? new ObjectId(a.locationId) : a.locationId,
          locationName: a.locationName,
          startTime: a.startTime,
          endTime: a.endTime,
          notes: a.notes ?? ''
        }))
      : []

    const now = new Date()
    const copy = {
      userId: new ObjectId(newOwnerId),
      title: `Copy of ${source.title}`,
      date: source.date,
      status: 'active',
      isPublic: false,
      activities: clonedActivities,
      photos: [],
      clonedFrom: new ObjectId(planId),
      createdAt: now,
      updatedAt: now
    }

    const inserted = await planCollection.insertOne(copy)
    return await this.getPlanById(inserted.insertedId.toString())
  },

  // Helper: a plan is interactive (reactable/commentable) if the actor owns it
  // or it's public. Private plans stay locked to their owner.
  async _findVisiblePlan(planId, userId) {
    const planCollection = await plans()
    const plan = await planCollection.findOne({ _id: new ObjectId(planId) })
    if (!plan) throw { status: 404, message: 'Plan not found' }
    if (plan.userId.toString() !== userId && !plan.isPublic)
      throw { status: 403, message: 'This plan is private' }
    return plan
  },

  async toggleReaction(planId, userId) {
    // Toggle a 👍 on a plan. One round-trip to remove; if nothing was removed,
    // the reaction wasn't there, so add it — same idempotent pattern as favorites.
    planId = checkId(planId)
    userId = checkId(userId)
    await this._findVisiblePlan(planId, userId)

    const planCollection = await plans()
    const userOid = new ObjectId(userId)

    const pull = await planCollection.updateOne(
      { _id: new ObjectId(planId), reactions: userOid },
      { $pull: { reactions: userOid } }
    )
    if (pull.modifiedCount === 1) return { reacted: false }

    await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      { $addToSet: { reactions: userOid } }
    )
    return { reacted: true }
  },

  async addComment(planId, userId, authorName, text) {
    planId = checkId(planId)
    userId = checkId(userId)
    text = checkString(text)
    if (text.length > 1000) throw { status: 400, message: 'Comment cannot be longer than 1000 characters' }
    await this._findVisiblePlan(planId, userId)

    const comment = {
      _id: new ObjectId(),
      userId: new ObjectId(userId),
      authorName: typeof authorName === 'string' && authorName.trim() ? authorName.trim() : 'A friend',
      text,
      createdAt: new Date()
    }

    const planCollection = await plans()
    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      { $push: { comments: comment }, $set: { updatedAt: new Date() } }
    )
    if (result.modifiedCount === 0) throw { status: 500, message: 'Could not add comment' }
    return await this.getPlanById(planId)
  },

  async deletePlanComment(planId, commentId, requester) {
    // Author, plan owner, or an admin may remove a comment.
    planId = checkId(planId)
    commentId = checkId(commentId)
    if (!requester || requester._id === undefined) throw { status: 400, message: 'Must have a requester' }
    const requesterId = checkId(requester._id)
    const isAdmin = requester.role === 'admin'

    const planCollection = await plans()
    const plan = await planCollection.findOne({ _id: new ObjectId(planId) })
    if (!plan) throw { status: 404, message: 'Plan not found' }

    const comment = (plan.comments || []).find((c) => c._id.toString() === commentId)
    if (!comment) throw { status: 404, message: 'Comment not found' }

    const isAuthor = comment.userId.toString() === requesterId
    const isPlanOwner = plan.userId.toString() === requesterId
    if (!isAuthor && !isPlanOwner && !isAdmin)
      throw { status: 403, message: 'You cannot delete this comment' }

    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      { $pull: { comments: { _id: new ObjectId(commentId) } }, $set: { updatedAt: new Date() } }
    )
    if (result.modifiedCount === 0) throw { status: 500, message: 'Could not delete comment' }
    return await this.getPlanById(planId)
  },

  async getPlanById(planId) {
    // GET
    planId = checkId(planId)
    const planCollection = await plans()
    const plan = await planCollection.findOne({ _id: new ObjectId(planId) })

    if (!plan) throw { status: 404, message: "Plan not found" }

    return plan
  },

  // async getPlanActivities(planId) {
  //   // GET
  //   planId = checkId(planId)
  //   const planCollection = await plans()
  //   const plan = await planCollection.findOne({ _id: new ObjectId(planId) })

  //   if (!plan) throw { status: 404, message: "Plan not found" }

  //   return plan.activities
  // },

  async getPlanByDate(userId, date) {
    // GET
    userId = checkId(userId)
    date = checkDate(date)
    const planCollection = await plans()
    const plan = await planCollection.findOne({ userId: new ObjectId(userId), date })

    if (!plan) throw { status: 404, message: "Plan not found" }
    return plan
  },

  async newPlan(userId, title, date, isPublic = false, locations = []) {
    // POST
    userId = checkId(userId)
    title = checkString(title)
    date = checkDate(date)

    if (typeof isPublic != 'boolean') throw { status: 400, message: "Error: must be boolean" }

    let activities = []

    if (locations.length > 0) {
      activities = locations.map(({ locationId, startTime, endTime, notes = null }) => ({
        _id: new ObjectId(),
        locationId: new ObjectId(locationId),
        startTime: startTime || null,
        endTime: endTime || null,
        notes
      }))
    }

    const newPlan = {
      userId: new ObjectId(userId),
      title,
      date,
      status: 'active',
      isPublic,
      activities,
      photos: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const planCollection = await plans()
    const newInsert = await planCollection.insertOne(newPlan)
    const newId = newInsert.insertedId
    return await this.getPlanById(newId.toString())
  },

  async addActivity(planId, locationId, locationName, startTime, endTime, notes = "") {
    planId = checkId(planId)
    locationId = checkId(locationId)
    startTime = checkTime(startTime)
    endTime = checkTime(endTime)

    if (typeof notes != 'string') throw { status: 400, message: "Error: notes must be of type string" }

    const toMinutes = (time) => {
      const [hourMin, period] = time.split(/(AM|PM)/)
      let [hours, minutes] = hourMin.trim().split(':').map(Number)
      if (period === 'PM' && hours !== 12) hours += 12
      if (period === 'AM' && hours === 12) hours = 0
      return hours * 60 + minutes
    }

    const newStart = toMinutes(startTime)
    const newEnd = toMinutes(endTime)

    if (newStart >= newEnd) throw { status: 400, message: "Error: start time must be before end time" }

    const planCollection = await plans()
    const plan = await planCollection.findOne({ _id: new ObjectId(planId) })

    for (const activity of plan.activities) {
      const existingStart = toMinutes(activity.startTime)
      const existingEnd = toMinutes(activity.endTime)

      if (newStart < existingEnd && newEnd > existingStart) {
        throw {
          status: 400,
          message: `Time conflict with existing activity: ${activity.locationName} (${activity.startTime} - ${activity.endTime})`
        }
      }
    }

    const newActivity = {
      _id: new ObjectId(),
      locationId: new ObjectId(locationId),
      locationName,
      startTime,
      endTime,
      notes
    }

    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      {
        $push: { activities: newActivity },
        $set: { updatedAt: new Date() }
      }
    )

    if (result.modifiedCount === 0) throw { status: 500, message: "Error: could not add activity" }

    return await this.getPlanById(planId)
  },

  async updatePlan(planId, { title, date, status, isPublic } = {}) {
    // PUT
    planId = checkId(planId)

    const updateFields = {}

    if (title != undefined) updateFields.title = checkString(title)
    if (date != undefined) updateFields.date = checkDate(date)
    if (status !== undefined) {
      if (!['active', 'saved', 'completed'].includes(status))
        throw { status: 400, message: "Error: invalid status" }
      updateFields.status = status
    }

    if (isPublic != undefined) {
      if (typeof isPublic != 'boolean') throw { status: 400, message: "Error: must be boolean" }
      updateFields.isPublic = isPublic
    }

    if (Object.keys(updateFields).length === 0) throw { status: 400, message: "Error: no fields provided to update" }

    updateFields.updatedAt = new Date()

    const planCollection = await plans()
    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      { $set: updateFields }
    )

    if (result.modifiedCount === 0) throw { status: 500, message: "Error: could not update plan" }
    return await this.getPlanById(planId)
  },

  async updateActivity(planId, activityId, { startTime, endTime, notes } = {}) {
    // PUT
    planId = checkId(planId)
    activityId = checkId(activityId)

    const updateFields = {}

    if (startTime != undefined) updateFields.startTime = checkTime(startTime)
    if (endTime != undefined) updateFields.endTime = checkTime(endTime)
    if (notes != undefined) {
      if (typeof notes != 'string') throw { status: 400, message: "Error: notes must of type string" }
      updateFields.notes = notes
    }

    if (Object.keys(updateFields).length === 0) throw { status: 400, message: "Error: no fields provided to update" }

    const setFields = { updatedAt: new Date() }
    if ('startTime' in updateFields) setFields["activities.$.startTime"] = updateFields.startTime
    if ('endTime' in updateFields) setFields["activities.$.endTime"] = updateFields.endTime
    if ('notes' in updateFields) setFields["activities.$.notes"] = updateFields.notes

    const planCollection = await plans()
    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId), "activities._id": new ObjectId(activityId) },
      { $set: setFields }
    )

    if (result.modifiedCount === 0) throw { status: 500, message: "Error: could not update plan" }
    return await this.getPlanById(planId)
  },

  async deletePlan(planId) {
    // DELETE
    planId = checkId(planId)
    const planCollection = await plans()
    const deletedPlan = await planCollection.findOneAndDelete({
      _id: new ObjectId(planId)
    })
    if (!deletedPlan) throw { status: 404, message: "Plan not found" }

    return { ...deletedPlan, deleted: true }
  },

  async deleteActivity(planId, activityId) {
    // DELETE
    planId = checkId(planId)
    activityId = checkId(activityId)

    const planCollection = await plans()
    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      {
        $pull: { activities: { _id: new ObjectId(activityId) } },
        $set: { updatedAt: new Date() }
      }
    )

    if (result.modifiedCount === 0) throw { status: 500, message: "Error: could not delete activity" }
    return await this.getPlanById(planId)
  },

  async addPhoto(planId, photoUrl) {
    planId = checkId(planId)
    photoUrl = checkString(photoUrl)
    if (!/^https?:\/\//i.test(photoUrl)) {
      throw { status: 400, message: 'Photo URL must start with http:// or https://' }
    }

    const planCollection = await plans()
    const result = await planCollection.updateOne(
      { _id: new ObjectId(planId) },
      {
        $addToSet: { photos: photoUrl },
        $set: { updatedAt: new Date() }
      }
    )

    if (result.modifiedCount === 0) throw { status: 500, message: "Error: could not add photo" }
    return await this.getPlanById(planId)
  }
}

export default exportedMethods
