# Western Water Rights

A marketplace and lookup tool for western U.S. water rights. See
[`docs/project-briefing.md`](docs/project-briefing.md) for the full project
background — read that first if you're new here.

## What's in this project

- **`server/`** — the backend. A small Node.js program that talks to state
  government data sources on your behalf (something a browser alone can't
  always do — some of those sources block direct browser requests).
- **`public/`** — the real frontend (`index.html`). This is what you actually
  see and click around in — it's served by the backend, so there's one
  server to run, not two.
- **`prototypes/`** — the three original single-file demos (Colorado, Idaho,
  Utah). Kept for reference and still open directly in a browser standalone.
  Colorado's proven logic has since moved into `server/` + `public/`; Idaho
  and Utah are still only in their prototype files.
- **`docs/`** — background reading, including the original project briefing.

## Running it

You'll need [Node.js](https://nodejs.org) installed (any recent version).

```bash
npm install
npm start
```

Then open `http://localhost:3001` in a browser — that's the actual lookup
tool: search by address, tap the map, or search by county. Everything on
the page comes from the API endpoints below, which you can also call
directly if you just want the raw data.

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

## Verifying the scraper still works

Because this depends on a government website that could change its layout
at any time, there's a quick self-check script:

```bash
npm run test:well-scraper
```

It looks up a few known real wells and checks the data comes back correctly
formatted. Run it after any change to `server/services/colorado/wellCompletionScraper.js`,
or periodically to make sure Colorado hasn't changed the page.
