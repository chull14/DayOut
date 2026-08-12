import { plans } from '../config/mongoCollections.js'
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
