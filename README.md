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

There's no frontend yet — this first step is the backend piece that the
browser alone couldn't do: Colorado's well construction data.

## Running it

You'll need [Node.js](https://nodejs.org) installed (any recent version).

```bash
npm install
npm start
```

The server starts at `http://localhost:3001`. Visiting that address in a
browser should show `{"status":"ok", ...}`.

## What it can do right now: Colorado well-completion lookup

Colorado's official well records website shows real construction details —
how deep a well is, when it was drilled, its tested water yield — but that
information lives on a page that a browser isn't allowed to read directly
(a technical restriction called CORS). A backend server doesn't have that
restriction, which is exactly why this project needed one.

Two things you can ask it for, by visiting the URL in a browser or using a
tool like `curl`:

**1. Look up one well's construction details, if you know its receipt number:**

```
http://localhost:3001/api/colorado/well-completion/0002158
```

**2. Find the nearest well permit to a map point, county, and get its construction details automatically:**

```
http://localhost:3001/api/colorado/wells/nearest?county=WELD&lat=40.2276&lon=-104.3365
```

Both return the underlying government data as JSON (structured data, not a
formatted page) — this is a backend building block, not the finished
consumer-facing lookup tool yet. That comes next, once more pieces are in
place.

### A couple of honest caveats, carried over from the prototype

- The "nearest well" match is a best-effort geographic guess, not a
  guaranteed link to a specific water right — Colorado doesn't publish a
  direct connection between the two.
- Not every well has complete construction data on file. Depth is often
  known; static water level and tested yield are frequently blank,
  especially for older permits. When present, the response says so plainly
  rather than showing a misleading blank as zero.

## Verifying the scraper still works

Because this depends on a government website that could change its layout
at any time, there's a quick self-check script:

```bash
npm run test:well-scraper
```

It looks up a few known real wells and checks the data comes back correctly
formatted. Run it after any change to `server/services/colorado/wellCompletionScraper.js`,
or periodically to make sure Colorado hasn't changed the page.
