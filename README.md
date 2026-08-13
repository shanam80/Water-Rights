# Western Water Rights

A marketplace and lookup tool for western U.S. water rights. See
[`docs/project-briefing.md`](docs/project-briefing.md) for the full project
background — read that first if you're new here.

## What's in this project

- **`server/`** — the backend. A small Node.js program that talks to state
  government data sources on your behalf (something a browser alone can't
  always do — some of those sources block direct browser requests).
- **`prototypes/`** — the three original single-file demos (Colorado, Idaho,
  Utah). Each still opens directly in a browser and works standalone. Their
  proven logic (confirmed URLs, field names) is gradually being moved into
  `server/` as real backend features.
- **`docs/`** — background reading, including the original project briefing.

There's no frontend yet — Colorado's proven data logic (water rights,
parcels/ownership, on-parcel matching, well construction data) has now been
migrated into the backend as real API endpoints. Idaho and Utah are still
only in their standalone prototype files.

## Running it

You'll need [Node.js](https://nodejs.org) installed (any recent version).

```bash
npm install
npm start
```

The server starts at `http://localhost:3001`. Visiting that address in a
browser should show `{"status":"ok", ...}`.

## What it can do right now: Colorado

All of it returns JSON (structured data, not a formatted page yet) — this is
the backend building block, not the finished consumer-facing lookup tool.
That comes next, once a frontend is built to call these.

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

## Verifying the scraper still works

Because this depends on a government website that could change its layout
at any time, there's a quick self-check script:

```bash
npm run test:well-scraper
```

It looks up a few known real wells and checks the data comes back correctly
formatted. Run it after any change to `server/services/colorado/wellCompletionScraper.js`,
or periodically to make sure Colorado hasn't changed the page.
