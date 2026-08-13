import { reviews, locations, users } from '../config/mongoCollections.js';
import { checkId, checkRating, checkString } from '../helpers.js';
import { ObjectId } from 'mongodb';
import { computeAndStore } from './recommendations.js';

// Fire-and-forget: a review write changes the author's taste signal, so we
// recompute their stored recommendations in the background. Never awaited —
// the review response must not wait on (or fail because of) the AI.
function refreshRecommendations(userId) {
  computeAndStore(userId).catch((e) =>
    console.error('recommendation recompute failed:', e.message)
  );
}

async function recomputeLocationAggregates(locationId) {
  const reviewsCol = await reviews();
  const locationsCol = await locations();

  const locOid = new ObjectId(locationId);
  const allReviews = await reviewsCol.find({ locationId: locOid }).toArray();

  let averageRating = null;
  const totalReviews = allReviews.length;

  if (totalReviews > 0) {
    const sum = allReviews.reduce((acc, r) => acc + r.rating, 0);
    averageRating = Math.round((sum / totalReviews) * 10) / 10;
  }

  const result = await locationsCol.updateOne(
    { _id: locOid },
    { $set: { averageRating, totalReviews } }
  );

  if (!result.acknowledged) {
    throw 'Could not update location aggregates';
  }
}

export async function createReview({ locationId, userId, rating, reviewText }) {
  if (locationId === undefined) throw 'Must have a locationId';
  if (userId === undefined) throw 'Must have a userId';
  if (rating === undefined) throw 'Must have a rating';
  if (reviewText === undefined) throw 'Must have reviewText';

  locationId = checkId(locationId);
  userId = checkId(userId);
  rating = checkRating(rating);
  reviewText = checkString(reviewText);
  if (reviewText.length > 2000) throw 'Review text cannot be longer than 2000 characters';

  const locationsCol = await locations();
  const location = await locationsCol.findOne({ _id: new ObjectId(locationId) });
  if (location === null) throw 'No location found with that id';

  const reviewsCol = await reviews();
  const existing = await reviewsCol.findOne({
    locationId: new ObjectId(locationId),
    userId: new ObjectId(userId)
  });
  if (existing !== null) throw 'You have already reviewed this location';

  const newReview = {
    locationId: new ObjectId(locationId),
    userId: new ObjectId(userId),
    rating,
    reviewText,
    createdAt: new Date()
  };

  const result = await reviewsCol.insertOne(newReview);
  if (!result.acknowledged || !result.insertedId) {
    throw 'Could not create review';
  }

  await recomputeLocationAggregates(locationId);
  refreshRecommendations(userId);

  return await getReviewById(result.insertedId.toString());
}

export async function getReviewById(reviewId) {
  if (reviewId === undefined) throw 'Must have a reviewId';
  reviewId = checkId(reviewId);

  const reviewsCol = await reviews();
  const review = await reviewsCol.findOne({ _id: new ObjectId(reviewId) });
  if (review === null) throw 'No review found with that id';

  review._id = review._id.toString();
  review.locationId = review.locationId.toString();
  review.userId = review.userId.toString();
  return review;
}

export async function getReviewsForLocation(locationId) {
  if (locationId === undefined) throw 'Must have a locationId';
  locationId = checkId(locationId);

  const reviewsCol = await reviews();
  const usersCol = await users();

  const list = await reviewsCol
    .find({ locationId: new ObjectId(locationId) })
    .sort({ createdAt: -1 })
    .toArray();

  if (list.length === 0) return [];

  const authorIds = [...new Set(list.map((r) => r.userId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const authors = await usersCol
    .find({ _id: { $in: authorIds } })
    .project({ firstName: 1 })
    .toArray();
  const nameById = new Map(authors.map((u) => [u._id.toString(), u.firstName]));

  return list.map((r) => ({
    _id: r._id.toString(),
    locationId: r.locationId.toString(),
    userId: r.userId.toString(),
    rating: r.rating,
    reviewText: r.reviewText,
    createdAt: r.createdAt,
    authorFirstName: nameById.get(r.userId.toString()) || 'Unknown'
  }));
}

export async function updateReview(reviewId, userId, { rating, reviewText }) {
  if (reviewId === undefined) throw 'Must have a reviewId';
  if (userId === undefined) throw 'Must have a userId';
  if (rating === undefined) throw 'Must have a rating';
  if (reviewText === undefined) throw 'Must have reviewText';

  reviewId = checkId(reviewId);
  userId = checkId(userId);
  rating = checkRating(rating);
  reviewText = checkString(reviewText);
  if (reviewText.length > 2000) throw 'Review text cannot be longer than 2000 characters';

  const reviewsCol = await reviews();
  const existing = await reviewsCol.findOne({ _id: new ObjectId(reviewId) });
  if (existing === null) throw 'No review found with that id';
  if (existing.userId.toString() !== userId) throw 'You can only edit your own review';

  const result = await reviewsCol.updateOne(
    { _id: new ObjectId(reviewId) },
    { $set: { rating, reviewText } }
  );
  if (!result.acknowledged) throw 'Could not update review';

  await recomputeLocationAggregates(existing.locationId.toString());
  refreshRecommendations(userId);

  return await getReviewById(reviewId);
}

// Used by admin moderation table — joins location name + author email so the
// admin can identify what they're deleting at a glance.
export async function getAllReviewsForAdmin() {
  const reviewsCol = await reviews();
  const usersCol = await users();
  const locsCol = await locations();

  const list = await reviewsCol.find({}).sort({ createdAt: -1 }).toArray();
  if (list.length === 0) return [];

  const userIds = [...new Set(list.map((r) => r.userId.toString()))].map((id) => new ObjectId(id));
  const locIds = [...new Set(list.map((r) => r.locationId.toString()))].map((id) => new ObjectId(id));

  const usersList = await usersCol
    .find({ _id: { $in: userIds } })
    .project({ email: 1, firstName: 1 })
    .toArray();
  const locsList = await locsCol
    .find({ _id: { $in: locIds } })
    .project({ name: 1 })
    .toArray();
  const usersMap = new Map(usersList.map((u) => [u._id.toString(), u]));
  const locsMap = new Map(locsList.map((l) => [l._id.toString(), l]));

  return list.map((r) => ({
    _id: r._id.toString(),
    locationId: r.locationId.toString(),
    locationName: locsMap.get(r.locationId.toString())?.name || '(deleted location)',
    userId: r.userId.toString(),
    authorEmail: usersMap.get(r.userId.toString())?.email || '(deleted user)',
    rating: r.rating,
    reviewText: r.reviewText,
    createdAt: r.createdAt.toISOString().slice(0, 16).replace('T', ' ')
  }));
}

export async function deleteReview(reviewId, requester) {
  if (reviewId === undefined) throw 'Must have a reviewId';
  if (!requester || requester._id === undefined) throw 'Must have a requester';

  reviewId = checkId(reviewId);
  const requesterId = checkId(requester._id);
  const requesterRole = requester.role === 'admin' ? 'admin' : 'user';

  const reviewsCol = await reviews();
  const existing = await reviewsCol.findOne({ _id: new ObjectId(reviewId) });
  if (existing === null) throw 'No review found with that id';

  const isAuthor = existing.userId.toString() === requesterId;
  if (!isAuthor && requesterRole !== 'admin') {
    throw 'You can only delete your own review';
  }

  const result = await reviewsCol.deleteOne({ _id: new ObjectId(reviewId) });
  if (result.deletedCount !== 1) throw 'Could not delete review';

  await recomputeLocationAggregates(existing.locationId.toString());
  refreshRecommendations(existing.userId.toString());

  return { deleted: true, reviewId };
}
