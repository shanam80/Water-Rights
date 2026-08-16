# AcreFoot

A marketplace and lookup tool for western U.S. water rights, live at
[acrefoot.io](https://acrefoot.io). See
[`docs/project-briefing.md`](docs/project-briefing.md) for the full project
background — read that first if you're new here.

## What's in this project

- **`server/`** — the backend. A small Node.js program that talks to state
  government data sources on your behalf (something a browser alone can't
  always do — some of those sources block direct browser requests).
- **`public/`** — the real frontend (`index.html` for Colorado, `idaho.html`
  for Idaho, `utah.html` for Utah, `marketplace.html` for the marketplace).
  This is what you actually see and click around in — it's served by the
  backend, so there's one server to run, not two.
- **`prototypes/`** — the three original single-file demos (Colorado, Idaho,
  Utah). Kept for reference and still open directly in a browser standalone.
  All three states' proven logic has since moved into `server/` + `public/`.
- **`docs/`** — background reading, including the original project briefing.

## Running it

You'll need [Node.js](https://nodejs.org) installed (any recent version)
and a Postgres database — the marketplace feature needs somewhere to store
listings (the state lookup pages don't; they work with zero setup).
[Neon](https://neon.tech) has a free tier with no time limit and is what
this project is built/tested against.

```bash
npm install
cp .env.example .env   # then edit .env and paste in your DATABASE_URL
npm run migrate        # creates the marketplace tables (safe to re-run)
npm start
```

Then open `http://localhost:3001` in a browser — that's the actual lookup
tool. Colorado is the home page; Idaho is at `/idaho.html`, Utah at
`/utah.html`, the marketplace at `/marketplace.html` (there's a link
between all four at the top of each page). Search by address, tap the map,
or (Colorado only) search by county. Everything on the page comes from the
API endpoints below, which you can also call directly if you just want the
raw data.

Everything except the marketplace works with no `.env` file at all — if
you only care about the state lookup tools, `npm install && npm start` is
enough on its own.

## Deploying it (Render)

This is set up to deploy on [Render](https://render.com): connect your
GitHub repo, Render reads `render.yaml` automatically, and it runs
`npm install && npm run migrate` then `npm start` — the migration re-runs
on every deploy, which is safe (it only creates tables that don't already
exist) and means the database schema never drifts out of sync with the
deployed code.

`render.yaml` declares `DATABASE_URL`, `RESEND_API_KEY`, and `EMAIL_FROM`
as variables Render will prompt you to fill in during setup (via
`sync: false` — their values live only in Render's dashboard, never in
this repo). `DATABASE_URL` is required for the marketplace to work;
`RESEND_API_KEY`/`EMAIL_FROM` are optional (see the marketplace section
below). Every other data source this project talks to is a free public
API needing no login or key.

The free tier sleeps after 15 minutes of no traffic and takes ~30 seconds
to wake back up on the next visit — fine for early use, worth upgrading to
the paid always-on tier ($7/mo as of writing) once this has real visitors.
GPS "use my location" specifically needs this to be hosted somewhere with
`https://` (a secure connection) — it won't work over plain `http://` or
from a file opened locally, which is exactly the limitation noted in the
original project briefing.

## The API, if you want the raw data directly

All of it returns JSON (structured data, not a formatted page) — this is
what the frontend at `public/index.html` calls under the hood.

**Water rights, for a whole county:**

```
http://localhost:3001/api/colorado/water-rights?county=WELD
```

**Water rights near a specific point** — adds a parcel/ownership lookup at
that point, splits results into "on this parcel" vs. "nearby," and sorts
nearby ones by actual distance:

```
http://localhost:3001/api/colorado/water-rights?county=WELD&lat=40.2276&lon=-104.3365
```

**Parcel/ownership lookup alone, at a point** (owner name/address, acreage,
land use, plus the parcel's boundary shape):

```
http://localhost:3001/api/colorado/parcel?lat=40.2276&lon=-104.3365
```

**Well construction details, if you know the receipt number** — depth, when
it was drilled, tested water yield. This is the piece that specifically
needed a real backend: the page it comes from blocks direct browser
requests (CORS), so a browser-only tool can't reach it, but a server can:

```
http://localhost:3001/api/colorado/well-completion/0002158
```

**Nearest well permit to a map point + county**, with construction details
automatically attached:

```
http://localhost:3001/api/colorado/wells/nearest?county=WELD&lat=40.2276&lon=-104.3365
```

### A couple of honest caveats, carried over from the prototype

- The "nearest well" match is a best-effort geographic guess, not a
  guaranteed link to a specific water right — Colorado doesn't publish a
  direct connection between the two.
- Not every well has complete construction data on file. Depth is often
  known; static water level and tested yield are frequently blank,
  especially for older permits. When present, the response says so plainly
  rather than showing a misleading blank as zero.
- A water right "on this parcel" is a real point-in-polygon match against
  the parcel's actual boundary, but it's still not a guarantee the right
  serves that property — a right tied to a ditch headgate elsewhere, for
  instance, can genuinely belong to a parcel it doesn't sit on.

## What it can do right now: Idaho

Idaho represents each water right as an actual place-of-use polygon, not
just a point — a real advantage over Colorado's point-based data. Its bulk
well data also already includes depth/yield/static water level directly
(Colorado's does not — that's why Colorado needed the scraper above).

**Every water right covering a specific point** — checked across all of
IDWR's stage layers (claims, permits, licenses/decrees) at once:

```
http://localhost:3001/api/idaho/water-rights?lat=42.56&lon=-114.46
```

**Nearby wells** — closest ~8 wells on file within roughly 1.3 miles,
sorted by distance:

```
http://localhost:3001/api/idaho/wells/nearby?lat=42.56&lon=-114.46
```

### Honest caveats for Idaho

- Some water rights are marked "Large Place of Use" — the shape shown is an
  entire irrigation district's combined boundary, not a specific parcel.
  Falling inside one of these means you're in the district's territory, not
  that this specific right is confirmed for your exact property.
- Parcel/ownership lookup isn't available for Idaho at all. Unlike
  Colorado, there's no unified statewide public parcel API — each of
  Idaho's 44 counties runs its own separate system. This was deliberately
  left out rather than half-built; water rights + wells alone still make
  Idaho a useful lookup.
- The water-rights service lives at a URL whose own folder is named
  `WillBeDeleted` — it's a live mirror IDWR stood up after the original
  service went dark, and the name is a real signal it could move again.
  Worth re-verifying if `server/services/idaho/waterRights.js` ever starts
  failing outright.

## What it can do right now: Utah

Utah's water-rights service turned out to be a custom (non-Esri) endpoint
that only needed JSONP to work around a *browser's* CORS restriction — from
a server there's no such restriction at all, so the backend just calls it
directly and gets plain JSON back. Utah also turned out to have a genuine,
previously-unverified well-logs dataset, confirmed live and cross-checked
against a real water right (its `WIN` field links the two datasets
together) — closing the "wells: not started" gap from the original
briefing, including a scraper for real drilling depth/casing/water-level
history, similar in spirit to Colorado's but a simpler page to parse.

**Nearby water rights (points of diversion)**, sorted by distance:

```
http://localhost:3001/api/utah/water-rights?lat=40.76&lon=-111.89
```

**Nearby wells** — location, associated water right, whether a drilling log
is on file:

```
http://localhost:3001/api/utah/wells/nearby?lat=40.76&lon=-111.89
```

**Drilling log detail for one well**, by its WIN (well identification
number) — drilling method, depth, casing diameter, and water-level readings
over time, when on file:

```
http://localhost:3001/api/utah/wells/434562/log
```

### Honest caveats for Utah

- Place-of-use area matching (whether a right specifically serves a given
  parcel) isn't implemented — Utah's WRPOD data is point-based (where each
  right diverts water), like Colorado's, not polygon-based like Idaho's.
- Parcel/ownership lookup hasn't been researched for Utah at all yet — this
  is genuinely unstarted work, not a deliberate skip like Idaho's.
- Not every well has a drilling log on file, and not every water right's
  `WIN` field points to one (a `WIN` of `0` means none is linked) — the
  frontend and API both say so plainly rather than showing an empty result
  as if something went wrong.

## What it can do right now: Montana

The richest single-state data source in this project. Montana's DNRC runs
one ArcGIS FeatureServer with **both** points of diversion (point
geometry, like Colorado) **and** places of use (real polygons, like
Idaho) — plus reservoirs as a separate layer — and unlike every other
state here, **well depth is built directly into the bulk water-rights
data**, no separate scraper required. Its statewide parcels service is
also excellent: owner name/address, acreage broken down by land use
(irrigated/grazing/forest/etc.), and assessed values.

**Water rights for a county** (points of diversion + reservoirs, no
geometry — this view has no map):

```
http://localhost:3001/api/montana/water-rights?county=GALLATIN
```

**Water rights near a point** — adds parcel lookup, on-parcel matching for
diversions/reservoirs (point-in-polygon against the parcel boundary), and
any place-of-use polygon that covers this exact point (Esri's own spatial
query does that polygon test server-side — no manual point-in-polygon
code needed here, unlike Idaho's):

```
http://localhost:3001/api/montana/water-rights?county=GALLATIN&lat=45.55&lon=-111.15
```

**Parcel/ownership lookup alone, at a point:**

```
http://localhost:3001/api/montana/parcel?lat=45.55&lon=-111.15
```

### Honest caveats for Montana

- The county-only view intentionally skips geometry to keep response
  times reasonable (a busy county can have thousands of point records) —
  it has no map, so nothing is lost by leaving it out.
- Same caveat as everywhere else: a right sitting on a parcel, or a
  place-of-use polygon covering a point, isn't proof that right serves
  that exact property — always confirm with the state directly.

## What it can do right now: Nevada

Nevada's NDWR runs a large, genuinely public ArcGIS catalog with points of
diversion, place-of-use polygons, and — uniquely among every state here —
**well driller reports with full construction detail already
bulk-queryable**: depth, static water level, yield, drawdown, casing, no
scraper needed at all, not even Montana's "depth only" middle ground.

Unlike Colorado/Montana, there's no county-search mode here — Nevada
stores county as an opaque 2-letter code (e.g. `WA`) with no verified
decode table, so only one mapping was ever confirmed (`WA` = Washoe,
cross-checked against real data); not enough to safely guess the rest, so
codes are shown raw rather than translated. This follows Idaho/Utah's
point-only search pattern instead.

**Water rights near a point** — points of diversion (on-parcel matching +
distance-sorted nearby) and place-of-use polygons covering that exact
point:

```
http://localhost:3001/api/nevada/water-rights?lat=39.53&lon=-119.81
```

**Nearby wells**, with real construction detail:

```
http://localhost:3001/api/nevada/wells/nearby?lat=39.53&lon=-119.81
```

**Parcel lookup alone, at a point:**

```
http://localhost:3001/api/nevada/parcel?lat=39.53&lon=-119.81
```

### Honest caveats for Nevada

- A single point can genuinely intersect thousands of place-of-use
  polygons — confirmed live (one test point hit the state service's own
  2000-record transfer limit). That's real data, not a bug: many
  individual water rights within one large irrigation district each carry
  a copy of that same district-wide boundary. The API caps this at 50
  records and says so; the frontend also de-duplicates map polygons by
  `poly_id` so the same shape isn't drawn dozens of times.
- Nevada's parcel data is thinner than Colorado's or Montana's — parcel
  number, acreage, and a link to that county assessor's own record, not
  owner name/address directly.
- County and permit-status codes (`county`, `app_status`) are shown as
  Nevada's own raw abbreviations, not translated to plain English — see
  above for why.

## The marketplace

The differentiator from the original project vision: owners list a water
right, buyers browse and send an inquiry. Deliberately **not** a checkout —
water rights require formal state review to actually transfer ownership, so
"transact" here means connecting buyer and seller directly, the same way it
already happens today (title companies, water attorneys, direct
negotiation), not a payment flow this app processes itself.

**No user accounts.** Creating a listing (`POST /api/marketplace/listings`)
returns an `editToken` shown exactly once — that token, not a login, is
what proves you own a listing later (editing it, marking it sold, reading
its inquiries). The frontend surfaces this as a "save this link" URL like
`/marketplace.html?manage=<id>&token=<token>`. Simpler than building real
auth for v1, at a real cost: **lose the link, lose access** — nothing on
the backend can recover it for you. Worth becoming real accounts once this
has enough users that link-loss becomes a real support burden.

**Email notifications are optional, and degrade gracefully.** Without
`RESEND_API_KEY` set, an inquiry is still saved and fully visible via the
seller's manage link — the app just skips emailing them about it (logs a
line saying so, doesn't error). Set `RESEND_API_KEY` (a free account at
[resend.com](https://resend.com)) and optionally `EMAIL_FROM` to turn
emailing on with no code changes.

Key endpoints (see `server/routes/marketplace.js` for the full set):

```
POST /api/marketplace/listings                    create a listing
GET  /api/marketplace/listings?state=&minPrice=    browse/filter
GET  /api/marketplace/listings/:id                 one listing (public — no contact email)
GET  /api/marketplace/listings/:id/manage?token=   owner view (contact email + inquiries)
PATCH /api/marketplace/listings/:id?token=         edit, or change status (active/sold/removed)
POST /api/marketplace/listings/:id/inquiries       buyer contacts seller
```

## General site contact

`public/contact.html` (linked from every page's footer) is a simple
name/email/message form for anyone with a general question — not tied to
a specific listing. `POST /api/contact` saves it to the `contact_messages`
table regardless of email configuration, and — if both `RESEND_API_KEY`
and `ADMIN_EMAIL` are set — also emails it to `ADMIN_EMAIL`, same
graceful-degradation pattern as marketplace inquiries. The destination
address is never shown on the page itself, only used server-side.

**Not yet built:** an admin copy on every *marketplace* inquiry (as
opposed to this general contact form) — deferred, see the project memory
notes if picking this up later.

## Verifying the scraper still works

Because this depends on a government website that could change its layout
at any time, there's a quick self-check script:

```bash
npm run test:well-scraper
```

It looks up a few known real wells and checks the data comes back correctly
formatted. Run it after any change to `server/services/colorado/wellCompletionScraper.js`,
or periodically to make sure Colorado hasn't changed the page.
