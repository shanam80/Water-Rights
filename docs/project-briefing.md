# AcreFoot — Western Water Rights Marketplace — Project Briefing

**Project name: AcreFoot** (domain: acrefoot.io, confirmed available). Named after the actual unit water rights are measured in — recognizable to industry professionals, teachable to newcomers, and not tied to the surface-water/ditch side of things the way alternatives like "Headgate" or "Ditchrider" would be (both of which, worth noting, turned out to already be in use by real water-rights businesses when checked).

**Purpose of this document:** a complete handoff so a new working session (in Claude Code) can pick this project up without re-discovering everything from scratch. Read this fully before writing any code.

**Person's background:** No coding or web-development experience. Explanations should stay plain-language and non-technical — the "why," not just the "how."

---

## 1. The vision

An online marketplace for western U.S. water rights, similar in spirit to Zillow/realtor.com for real estate, with two core features:

1. **Water availability lookup** — search an address, tap a map, or use GPS to see what water rights exist near or on a specific property: who owns them, how senior they are, what they're good for (irrigation acreage, household supply), and whether they're a well or surface-water right.
2. **Marketplace** — eventually, let water right owners and buyers list, browse, and transact — the differentiated feature no current competitor fully offers.

**Competitive landscape (researched, not guessed) — six players, two tiers:**
- **Consumer/free tier:** WaterMap NM (small studio, free address/map lookup, New Mexico only — no visible monetization), Western Water Market / LandApp (plain listing boards, no real data intelligence).
- **Professional/enterprise tier:** B3 Insight (mature, 12 years, covers CO/CA/MT/NM/TX/WY, sold to oil & gas/legal/institutional buyers), Headgate/loadstonelabs.com (new, early-access, Colorado-River-Basin-focused, built on the same Colorado HydroBase API this project uses — appears small/unfunded based on site language and no funding history found, but a real and legitimate competitor for the professional tier specifically).
- **Texas-specific:** Well Water Finders (well-yield estimation only, no GCD/regulatory layer — see §8).
- **The open niche:** a free, consumer-friendly tool for Colorado/Utah/Idaho specifically, that goes further than anyone else by adding real physical well-yield data *and* an actual transaction/community marketplace — neither of which any competitor fully offers today. Idaho and Utah remain genuinely uncontested even at the free-consumer tier.

**Business model — important strategic finding, not just a feature list:** every competitor actually proven to generate revenue in this space (B3, Headgate) sells to *professionals* (attorneys, engineers, institutional buyers), not consumers — nobody has proven a sustainable business on free-consumer-only. The likely right model, based on this evidence: **free consumer lookup as the lead-generation/brand layer** (genuinely differentiated — nobody else offers a good free version), **paired with a paid professional tier** (title companies, water attorneys, ag lenders, ranch brokers) for the real revenue — similar in spirit to how Zillow's free Zestimate feeds its actual B2B/agent-lead revenue. Don't build "free consumer tool + eventual marketplace commission" as the only revenue plan without also building toward this B2B layer.

**Rollout idea — community/matching board (do this before full transaction infrastructure):** a simple "Looking for water rights" / "Have water rights to sell" board where users can post and browse, before building payments/escrow/legal-transfer infrastructure. This solves the classic marketplace cold-start problem (a marketplace with zero listings and zero buyers is worthless on day one) cheaply, lets you observe real demand patterns before investing in the harder transactional build, and doubles as an early community-building tool — getting real water-rights-community users engaged early is treated as critical to the rollout, not an afterthought. (Working name only — refine terminology before shipping.)

**Messaging must be in-platform by default, not just a nice-to-have:** if people can freely swap contact info the moment they connect, they take the conversation off-platform immediately — the platform then has no visibility into whether a match happened, no data on what buyers actually want, and no path to ever monetize that connection (matters directly for the B2B/professional-tier revenue plan above — a real "buyer looking for irrigation rights near X" is itself a valuable lead). This is a known problem for two-sided marketplaces (sometimes called "leakage" or "disintermediation"). Plan: build simple, visible in-platform messaging as the default way people connect on the board. Don't over-invest yet in technically blocking contact info from being shared in messages — that's fiddly to do well and premature before real usage data exists; established marketplaces (Airbnb, Etsy, Upwork) mostly just make in-platform messaging the easy default rather than fully policing it. One thing to decide before shipping, not retrofit later: **if the platform can see these messages (e.g. for moderation or lead purposes), that must be disclosed plainly to users up front, in the terms — both the right thing to do and reduces legal exposure if a dispute comes up.**

**Structural risk worth tracking:** the entire product depends on free public government APIs the project doesn't control — several have already changed shape or gone dead mid-build (Colorado's well detail page, Idaho's original water rights URL). Budget for this as an ongoing maintenance reality, not a one-time build risk.

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
4. From there: real hosting, then Utah's remaining pieces (parcels, wells), then §7's next states, then the marketplace layer, then §8's Texas concept.

## 7. Expansion priority: which states to add next, and why

All research below, not guesses — confirmed via live search before committing to this order.

**Do first — Wyoming and Montana:**
- Both are "pure" prior appropriation states (the "Colorado Doctrine") — same clean legal model as Colorado/Utah/Idaho, no added regulatory complexity layer.
- Both border the existing three states directly — builds a genuine contiguous regional footprint rather than scattered states.
- **Montana** already has a live, working ArcGIS-based query tool (`gis.dnrc.mt.gov/apps/WRQS/`) — structurally similar to what's already been built against.
- **Wyoming** has a documented many-to-many relationship between points of diversion and *irrigated land polygons* in its GIS data — potentially more specific "place of use" precision than any of the three current states offer. Worth real excitement, verify live before committing to this claim.
- No existing competitor in either state.

**Do after — Nevada:** has its own live ArcGIS points-of-diversion service (`arcgis.water.nv.gov`), technically promising. But Nevada's water rights are entangled with Colorado River interstate compact politics — a different order of complexity and controversy than a single state's internal system. Better tackled with more infrastructure and credibility already in place, not as state #4.

**Deprioritize:**
- **New Mexico** — WaterMap NM (a live competitor found during market research) already occupies this exact niche.
- **Arizona** — its 1980 Groundwater Code adds Active Management Areas, an extra regulatory layer similar in kind to Texas's GCD complexity (see §8) — more like a second Texas-style project than a quick fifth/sixth state.
- **Alaska** — remote, different economics, low near-term commercial priority.

## 8. Separate concept: a Texas product (different from the CO/UT/ID model — do not force-fit)

**Why Texas needs a fundamentally different product, not a fourth state added to the existing pattern:** Texas groundwater follows the "rule of capture," not prior appropriation. Groundwater is not part of the mineral estate — unless expressly severed, it is held by the surface owner, and can be severed and sold separately like mineral rights. There is no state-tracked "water right" record with a priority date the way CO/UT/ID have — ownership is a default incident of land ownership, not an independent government-issued right. This means the core "look up the water right" lookup tool doesn't translate to Texas at all; what actually works is different:

**The idea: a database of (1) Groundwater Conservation District restrictions and (2) well completion/production data**, since these are the genuinely trackable, regulatory things in Texas's system.

- **Well data — strong, confirmed, statewide, updated nightly:** TWDB's Groundwater Database (GWDB) has inventoried nearly 140,000 wells, with location, depth, well type, owner, driller, construction/completion data, aquifer, water-level and water-quality data, downloadable as pipe-delimited files. **Confirmed: includes an actual Yield field (gallons per minute), plus static/pumping water level and pump test details** — genuine production volume data, not just construction specs (verified via a real well record example, not assumed). Not every well will have every field populated — same "show what's there, gracefully handle what's missing" pattern used everywhere else in this project. Better centralized than Colorado's per-permit well situation.
- **GCD boundaries — real and centralized, but this is boundaries only, NOT the actual restriction rules:** TWDB publishes real GCD boundary GIS data — usable for the same point-in-polygon boundary technique already proven in Colorado/Idaho/Utah, to answer "which district is this property in." **This does not include the actual restriction content (production limits, spacing rules, permitting requirements)** — see "the genuine gap" below. Don't build a feature that implies restriction details are available when only the boundary/district-name is actually confirmed yet.
- **Parcels/ownership — confirmed real and statewide, strengthens this concept significantly:** the **StratMap** program, run by TxGIO (Texas Geographic Information Office — a division of TWDB, the same agency behind the well data above), aggregates land parcels from 245+ appraisal districts and ~10 million address points annually into a common statewide schema, downloadable via the TxGIO DataHub. ~90% of appraisal district data has been acquired and translated into the common schema — strong, but not 100%, and update frequency varies by county (no single "as of" date for the whole state). Texas's own 2019 planning report bluntly noted "Texas does not have a parcel-based statewide property rights dataset... there is no consistent statewide resource" — StratMap is the state's active answer to that gap, closer in spirit to Idaho's originally-fragmented starting point than to Colorado's cleaner one, but a real, structurally sound aggregation, not a per-county scavenger hunt like Idaho's parcels turned out to be. This means Texas could plausibly get parcels + GCD boundaries + wells all from state-level sources — verify current StratMap access/download details live before building, same discipline as every other data source in this project.
- **District-county alignment isn't clean — use real boundary polygons, not county names:** there are 98 confirmed GCDs in Texas, 60 single-county and 38 multi-county, and confirmed GCDs are located within only 173 of 254 counties (81 counties have no GCD at all; coverage isn't statewide). A pure county-name lookup would be right most of the time but subtly wrong at the edges — same lesson as Idaho's Large POU districts.
- **District restriction summaries — DECISION: build the extraction pipeline from TWDB directly, not TAGD.** Real spot-check evidence (not assumption) supports this:
  - **TWDB is the source of truth.** TWDB centrally archives every confirmed district's current, TWDB-approved management plan PDF, in a consistent, predictable per-district folder pattern: `twdb.texas.gov/groundwater/docs/GCD/{district-code}/{district-code}_mgmt_plan{year}.pdf` — confirmed across multiple real districts, e.g. `pgcd` (Prairielands), `cuwcd` (Clearwater UWCD), `tgcd` (Texana), `ntvgcd` (Neches & Trinity Valleys). Since districts are legally required to submit these directly to TWDB and must review/readopt at least every 5 years, this should cover every confirmed GCD (not just some) and reflect the current approved plan.
  - **Spot-check confirmed TAGD is genuinely stale, not just theoretically at-risk of being stale.** Checked two districts directly: Prairielands GCD's plan was updated March 2024 (with an even newer rules summary effective January 2023); North Texas GCD's plan was approved by TWDB February 23, 2024 — both after TAGD's stated 2023 data collection date. Several other districts turned up in the same research with 2024–2025 plan dates (Rolling Plains GCD, Neches & Trinity Valleys GCD). This is a consistent real pattern across independently-checked districts, not a single fluke — treat TAGD's numbers as likely at least a year behind current, sometimes catching an outdated plan version entirely.
  - **What this means practically: build a pipeline that (1) discovers each district's current PDF via TWDB's file pattern above (verify the pattern holds across a larger sample first — the exact per-district code isn't guessable from the district's name alone, e.g. "Prairielands" → `pgcd`, so a code-lookup step is needed), (2) downloads it, (3) extracts the relevant restriction values (spacing rules, production limits, permitting approach, thresholds) from the legal PDF text — this last step is the real engineering work, likely best done with LLM-assisted document extraction given the length and legal density of these plans (50-100+ pages each), not simple text parsing.** TAGD's interactive database (`tagd.halff.com` — note: this is a JavaScript map app that doesn't expose data via simple fetch, would need browser dev-tools inspection to find its real API, same technique used earlier for Ada County, ID parcels and Utah's water rights endpoint) can still be used as a fast bootstrap for a demo before the TWDB pipeline is built, and/or a later cross-check on extracted values — but it is not the system of record.
  - **What restriction content actually looks like, to scope the extraction target realistically:** typically covers spacing requirements between wells, historic-use vs. operating permit calculations, production rate limits, thresholds triggering extra review (e.g., one district requires a full hydrogeological report for any well over 200 GPM), and drought-contingency rules. One genuinely useful fact applies statewide regardless of local district rules and could be shown on every district's page as a baseline, no extraction needed: production fees are capped by Texas Water Code at $1/acre-foot annually for agricultural use and $10/acre-foot for all other uses.
- **Competitive note:** Well Water Finders already does Texas-specific well-yield estimation (point at an address, get depth/yield estimates from ~3,800 proprietary surveys plus historical drilled-well records). The GCD-restriction layer combined with well data may still be a genuine gap even though standalone well-yield isn't — verify this combination doesn't already exist before building.
- **Realistic scope:** build the well-data + boundary lookup first (strong, matches the proven pattern). Treat "extract actual restriction text from each district's individual management plan" as a harder, separate follow-on phase — don't promise both at once.

## 9. The three prototype files

Attached/available alongside this briefing: `colorado-water-rights-lookup.html`, `idaho-water-rights-lookup.html`, `utah-water-rights-lookup.html`. Each is fully self-contained and can be opened directly in a browser to see current functionality before rebuilding.
