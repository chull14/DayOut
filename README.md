# DayOut NYC - Version 1.1

A web app for planning NYC day trips. Browse real NYC locations (museums, parks, restaurants, cafes) seeded from NYC Open Data, build dated plans with time-slotted activities, leave reviews and comments, favorite places, and submit new locations for admin approval. Admins moderate reviews, comments, and pending locations from a single dashboard.


## Team

- Alan Hu
- Connor Hull
- Yang Gao
- Olisa Okose

## Features

- **Auth** — signup, login, logout, profile. AJAX-aware: form posts get redirects, requests with `Accept: application/json` get JSON responses
- **Explore** — grid of approved locations with filters and sort
- **Location detail** — address, contact, average rating, "favorite" toggle, "+ Add to Plan" modal, plus reviews and comments sections inline
- **Reviews** — 1–5 star rating + text up to 2 000 characters, one review per user per location, author can edit or delete, admin can delete any
- **Comments** — text up to 1 000 characters, unlimited per user per location, author or admin can delete
- **Plans** — create dated plans, add time-slotted activities from any location, mark public/private, list all your plans, delete plans or individual activities
- **Friends** — search for users by name or email, send friend requests, accept or decline incoming requests, view friends list with their latest public plan, remove friends
- **Suggest a location** — any signed-in user can submit a new location; it stays pending until an admin approves. Admin-created locations auto-approve
- **Admin dashboard** — moderation tables for reviews, comments, and pending locations; one click deletes or approves


## Tech stack

- **Runtime** — Node.js
- **Server** — Express 5.2
- **Database** — MongoDB 7.2
- **Views** — express-handlebars 9 (layouts + partials + helpers)
- **Frontend** — vanilla JavaScript (`fetch` + JSON), site-wide CSS in `public/css/main.css`
- **Auth** — bcryptjs (10-round password hashing), session cookie `DayOutNYC` (24 h TTL)
- **Input safety** — `xss` library at route boundary for auth and locations; render-layer auto-escape for reviews, comments, and plans

## Prerequisites

- Node.js **≥ 20.19** (required by `mongodb@7.2`)
- MongoDB running on `mongodb://localhost:27017/` (database `dayoutNYC`)

## Quick start

```bash
npm install
npm run seed          # imports locations from seed-data/locations.json
npm start             # http://localhost:3000
```


## Creating an admin account

Sign up a normal user through `/signup`, then promote them in mongosh:

```bash
mongosh dayoutNYC --eval 'db.users.updateOne({email:"<your-email>"}, {$set:{role:"admin"}})'
```

Log out and log back in. Admin accounts are redirected to `/admin` on login and see moderation tables for reviews, comments, and pending locations.

## Project structure

```
app.js                       Express app setup + session + middleware
seed.js                      one-shot loader for seed-data/locations.json
config/                      mongo connection, collections, settings
data/                        data-layer modules (users, locations, plans, reviews, comments)
helpers.js                   shared validation helpers (checkId, checkRating, …)
middleware/auth.js           requireLogin / requireAdmin / requireGuest
routes/                      one router per resource
public/
  css/main.css               site stylesheet (named-color palette)
  js/                        per-page client scripts (auth, reviews, comments, admin-moderation, …)
views/                       Handlebars templates + layouts/main + partials
seed-data/locations.json     NYC Open Data fixture
```

