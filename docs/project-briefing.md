# Western Water Rights Marketplace — Project Briefing

**Purpose of this document:** a complete handoff so a new working session (in Claude Code) can pick this project up without re-discovering everything from scratch. Read this fully before writing any code.

**Person's background:** No coding or web-development experience. Explanations should stay plain-language and non-technical — the "why," not just the "how."

---

## 1. The vision

An online marketplace for western U.S. water rights, similar in spirit to Zillow/realtor.com for real estate, with two core features:

1. **Water availability lookup** — search an address, tap a map, or use GPS to see what water rights exist near or on a specific property: who owns them, how senior they are, what they're good for (irrigation acreage, household supply), and whether they're a well or surface-water right.
2. **Marketplace** — eventually, let water right owners and buyers list, browse, and transact — the differentiated feature no current competitor fully offers.

**Competitive landscape (researched, not guessed):**
- **WaterMap NM** — a small studio's free, consumer-friendly address/map lookup tool, but New Mexico only. Proves the core concept works.
- **B3 Insight** — a mature 12-year-old enterprise platform already covering Colorado (plus CA/MT/NM/TX/WY), but sold to oil & gas / legal professionals, not consumers.
- **Western Water Market / LandApp** — plain listing boards, no real data intelligence.
- **The open niche:** a free, consumer-friendly tool for Colorado/Utah/Idaho specifically, that goes further than anyone else by adding real physical well-yield data *and* an actual transaction marketplace — neither of which any competitor fully offers today.

## 2. Current state: three working browser-only prototypes

Each state has a **single self-contained HTML file** (no backend, opens locally in a browser) with: address search, map-click search, GPS "use my location," a plain-language translation layer over raw government jargon, and an interactive map showing real shapes/points.

### Colorado — most complete
- **Water rights**: `dwr.state.co.us/Rest/GET/api/v2/waterrights/netamount/` — live, CORS-enabled, well-documented once field names were learned (see §4).
- **Parcels + ownership**: `gis.colorado.gov/Public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer/0` — genuinely public, includes owner name/address, acreage, land use. **This was the single most important technical validation of the whole project** — proves parcel-to-owner matching is possible with free public data.
- **On-parcel matching**: point-in-polygon test between a right's coordinates and the parcel boundary — working, with visual map overlay (color-coded by delivery type: well vs. ditch vs. reservoir).
- **Wells**: bulk data only has *permit application* status, not construction depth/yield (that's in individual scanned documents per permit, not bulk-queryable). Direct link to each permit's official file provided instead.
- **Known gap**: well construction/yield data requires a real backend (see §5) — the actual detail page (`WellPermitSearch/View.aspx?receipt=X`) has real depth/pump-rate data as plain text, but blocks direct browser fetch (no CORS support). A server-side fetch would work fine.

### Idaho — strong on water rights and wells, parcels blocked
- **Water rights**: `gis.idwr.idaho.gov/hosting/rest/services/WillBeDeleted/WaterRights/MapServer` (yes, that's really the folder name — the *original* URL at `maps.idwr.idaho.gov` is dead, this is the current live mirror, note it may need re-discovery if it ever breaks). Data is **polygon-based** (actual place-of-use shapes, not just points) — a real advantage over Colorado. Confirmed real fields: `Owner`, `PriorityDate`, `Status`, `WaterUse`, `TotalAcres`, `Source`, `TributaryOf`, `LargePOU` (flags a whole-irrigation-district boundary vs. a specific right — important to distinguish visually, large ones are drawn as dashed outlines only, not filled, to avoid visual clutter from many overlapping district-wide shapes).
- **Wells**: `gis.idwr.idaho.gov/hosting/rest/services/groundwater/wells/MapServer/0` — genuinely bulk-queryable with **depth, static water level, yield (GPM), owner, casing details** — better than Colorado's well data. Confirmed fields: `TotalDepth`, `StaticWaterLevel`, `ProductionRate` (0 usually means "not measured," not "dry well" — handle this explicitly), `Owner`, `WellUse`, `ConstructionDate`.
- **Parcels**: **no unified statewide public API exists.** IDWR's own hosted mirror is explicitly restricted ("cannot be shared outside IDWR," ownership conclusions "expressly unauthorized"). The only genuinely public path found is **per-county** — e.g., confirmed Ada County runs its own system at `gisprod.adacounty.id.gov`. This would mean 44 separate county integrations. **Deliberately deprioritized** — water rights + wells alone make Idaho a strong product without parcels.

### Utah — water rights working, parcels/wells not yet started
- **Water rights**: NOT a standard Esri REST API — Utah's Division of Water Rights runs a **custom endpoint** using JSONP: `maps.waterrights.utah.gov/EsriMap/EsriMapCompanion/query_POD_mode0.asp`. Takes a bounding box (`minLat`/`maxLat`/`minLon`/`maxLon`) plus filter params (pass-through defaults for "show everything": `status=' ,U,A,P'`, `divType='Und,Sur,Spr,Dra,Poi,Red,Ret'`, `useType=',I,S,D,M,X,P,O'`, `appType='WR,CH,EX,RE'`, `altMode='0'`). Response shape: `{"pods": [...], "message": "..."}` — the array key is `pods`. Confirmed real fields: `WRNUM`, `Owner`, `Status`, `Priority` (⚠️ encoded as plain `YYYYMMDD` integer, e.g. `19521209` = Dec 9, 1952 — NOT epoch milliseconds), `CFS`, `Acft`, `Source`, `Type`, `Location` (PLSS legal description).
- **Official record deep link**: `waterrights.utah.gov/asp_apps/wrprint/wrprint.asp?wrnum={number}` — confirmed working, opens the official scanned record.
- **Parcels**: not yet researched.
- **Wells**: not yet researched — but a promising lead was found during Utah water-rights research: `services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Well_Logs/FeatureServer` (Utah Geological Survey geologic logs) — **this citation was later found to be unreliable for a different Utah dataset (the water rights one), so verify this one independently before trusting it.**

## 3. Cross-cutting lessons learned (read before repeating any of these)

These recurring patterns cost real time across all three states — apply them proactively for Utah's remaining work and any future state:

1. **Never trust a guessed URL or field name without live verification.** Every guessed endpoint was wrong at least once (Idaho parcels, Utah's first two URL attempts). Government GIS metadata citations can be stale. The reliable methods that worked: (a) direct web search for the literal service path, (b) asking the person to open the state's own official map tool, open browser DevTools → Network tab, and capture the real request URL live.
2. **Always build a raw-fields fallback.** Every card/popup shows a "show all fields" expandable raw dump of whatever the API actually returned, dynamically generated (not hardcoded field lists). This is how every wrong field-name guess got caught and fixed.
3. **Dates come in inconsistent formats per state/dataset**: epoch milliseconds (Colorado, Idaho), plain YYYYMMDD integers (Utah), and sentinel/placeholder values for "unknown" (year 9999 in Idaho — must be filtered out, not displayed literally).
4. **Zero doesn't always mean zero.** A reported yield/production rate of 0 usually means "not measured," not "no water." State this explicitly rather than silently hiding or showing a misleading 0.
5. **CORS varies unpredictably.** Newer ArcGIS-Online-hosted services (Colorado's parcels, Idaho's "hosting" platform) generally allow direct browser access. Older custom systems (Colorado's legacy well-detail page, potentially others) often don't — this is exactly the class of problem a real backend server solves, since server-to-server requests aren't subject to the browser's CORS restriction.
6. **Test every code change before presenting it.** Two real bugs shipped because a function was accidentally nested inside another function instead of being defined at the top level (works when only the enclosing function needs it, breaks silently everywhere else) — this class of bug doesn't show up in a basic syntax check, only in actual execution. A static "is every called function actually defined and in scope" check (done via a small script) caught it before delivery on the second occurrence.
7. **A single stuck/hanging request needs an explicit timeout.** `fetch()` has no default timeout — a genuinely hung request looks identical to a JavaScript crash from the outside (endless spinner, no error). Always wrap fetches in an `AbortController`-based timeout.

## 4. What "done" looks like for each state, and honest remaining gaps

| | Water rights | Parcels/ownership | Wells/yield |
|---|---|---|---|
| Colorado | ✅ Working | ✅ Working | ⚠️ Permit status only; construction data needs a backend |
| Idaho | ✅ Working (with district-vs-specific handling) | ❌ Blocked — genuinely fragmented, 44 counties | ✅ Working, better than Colorado's |
| Utah | ✅ Working | ⏸ Not started | ⏸ Not started (one unverified lead) |

## 5. Why this project needs Claude Code now, not more of the same

The browser-only, single-HTML-file approach has been the right tool for proving each state's data sources work — but has hit real structural limits:

- **Colorado's well-completion scraping** needs a request made from a real server, not a browser (confirmed CORS block on the source page).
- **A real product** needs actual hosting with a domain, not a file someone opens locally — this also unlocks GPS/location features that only work on a secure (https://) site.
- **Continuing to add features** (Utah parcels/wells, the marketplace layer, Colorado's well scraper) means repeating the same "guess → test live → fix" loop across three growing single files, which doesn't scale well.

**Recommended first steps in Claude Code:**
1. Set up a real project structure (a proper backend + frontend, not one HTML file per state).
2. Migrate the three working prototypes' proven logic (the confirmed URLs and field mappings above) into that structure.
3. Build the Colorado well-completion scraper server-side, where CORS isn't a blocker.
4. From there: real hosting, then Utah's remaining pieces, then the marketplace layer.

## 6. The three prototype files

Attached/available alongside this briefing: `colorado-water-rights-lookup.html`, `idaho-water-rights-lookup.html`, `utah-water-rights-lookup.html`. Each is fully self-contained and can be opened directly in a browser to see current functionality before rebuilding.
