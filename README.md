# GridSync

Cross-utility planning platform that identifies overlapping power-grid projects and helps utilities coordinate schedules, resources, budgets, and construction.

Initial scaffold: Django backend and React (JavaScript) frontend with Vite. MongoDB connection support is ready for application data. Django admin, authentication, and sessions still use SQLite. Application collections and APIs await data specifications.

## Requirements

- Python 3.10+ (created with Python 3.13)
- Node.js 22.12+ and npm (or Node.js 20.19+)

## Backend

From the repository root:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/manage.py runserver
```

Django runs at http://127.0.0.1:8000. Settings are configured for local development.

## Frontend

In another terminal:

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173).

If your shell selects the older Node.js 20.17 installation on this Mac, run
`export PATH=/opt/homebrew/bin:$PATH` before the npm commands to use the installed Node.js 26.

## Checks

```sh
backend/.venv/bin/python backend/manage.py check
cd frontend
npm run lint
npm run build
```

## Layout

- `backend/config/`: Django settings and URL configuration
- `backend/manage.py`: Django management commands
- `frontend/src/`: React components and styles

## MongoDB setup — first step

1. Create your MongoDB deployment and a database user with access to your application database. In Atlas, allow your development machine's IP in network access.
2. Copy `backend/.env.example` to `backend/.env`.
3. Fill in `MONGODB_URI` and `MONGODB_DATABASE` (suggested database name: `gridsync`). Keep credentials in the local `.env`, which Git ignores. Existing environment variables take precedence.
4. Check connectivity:

```sh
backend/.venv/bin/python backend/manage.py check_mongodb
```

The check pings MongoDB without writing records or creating collections. It confirms connectivity, not collection read/write permissions. The app can start before MongoDB is configured.

The `backend/database/` app provides `database.mongo.get_database()` for future application data access using [PyMongo](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/connect/mongoclient/). Django ORM models and migrations still target SQLite.

Next step: specify collections, fields, relationships, and sample records. No application schema has been assumed yet.

## Create MongoDB collections

```sh
backend/.venv/bin/python backend/manage.py setup_mongodb
```

Creates `sources`, `projects`, `substations`, and `coordination_opportunities` with validation and indexes. It does not import spreadsheet rows. See [database field mapping](backend/database/SCHEMA.md) for the workbook analysis, field definitions, and next import step.

## Excel import homepage

Start Django and Vite using the commands above, then open the Vite URL. The homepage supports:

1. Uploading an `.xlsx` workbook (up to 10 MB), or using the included June 2026 workbook.
2. Standard Our Grid Future column mapping, or optional Gemini-assisted column mapping.
3. Searching every extracted record, reviewing column mappings and warnings, then explicitly importing.

To enable Gemini through the previous Google AI Studio API, set these in **`backend/.env`** and restart Django:

```dotenv
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.8-flash
```

The key stays on the backend. Gemini receives headings and the target field definitions, not project rows or MongoDB credentials. AI proposes mappings; the application validates them and reads the original cell values. It does not invent missing costs, dates, locations, or project facts. The standard mode works without an API key. The transport is isolated in `backend/database/importing/gemini.py` and uses the Gemini Developer API. The availability indicator checks configuration only, not remote credential validity.

This initial importer supports the `Planned Transmission Projects`, `Study Concepts`, and `Substations in Planned Projects` sheet names, with headings in the first populated row. AI can match renamed columns within those sheets; arbitrary workbook layouts are not supported yet. Workbook formulas use saved values, so recalculate and save in Excel first if relevant.

Source identity uses the workbook's SHA-256 hash. Reimporting identical file bytes, even renamed, skips existing records and preserves later edits. A modified workbook is a separate source snapshot; cross-version reconciliation is future work. Duplicate project Record IDs block import, while duplicate substation source IDs are retained as distinct source rows with warnings. Voltage/capacity zero placeholders become unknown with their original values preserved.

Previews expire after 30 minutes and are lost when Django restarts (process-local cache). Imports use insert-only upserts in batches; a failed import may be partially saved, and retrying completes it without duplicating records. The source record alone does not prove all rows finished importing.

This is a **local development workspace**. API access requires `DEBUG=True` and a loopback connection, uses Django CSRF protection, and is proxied by Vite. It has no public user authentication; add authentication, shared preview storage, and a background worker before remote hosting. The Django/MongoDB backend is not a Cloudflare Worker and is not deployed through Sites.

```sh
backend/.venv/bin/python backend/manage.py test database
```

## Mathematical distance ranking

The independent engine in [`backend/coordination/`](backend/coordination/README.md) matches project locations, calculates spherical distances, and ranks candidates using the touching/crossing, under 1.6 km, under 8 km, and under 40 km bands. Geometry, matching, business rules, orchestration, and database operations are separate files.

```sh
# Read-only preview from MongoDB:
backend/.venv/bin/python backend/manage.py rank_opportunities
# Persist results for the future frontend:
backend/.venv/bin/python backend/manage.py rank_opportunities --save
# Tests:
backend/.venv/bin/python backend/manage.py test coordination database
```

Saved results are available at `/api/opportunities/`. The current workbook supports substation-based proximity; confirmed mapped-route intersections require actual route geometry. See the engine README for formulas, matching assumptions, source selection, and data-coverage diagnostics.

## Google Maps setup

The homepage includes a separate map feature in `frontend/src/features/maps/`, backed by `GET /api/map/substations/` in `backend/mapping/`. It displays MongoDB substation points, name/ID/state search, source-snapshot filtering, source details on click, and map panning. This initial map does not draw transmission routes or coordination overlays. Those can be added separately during the frontend revamp.

Use **Google Cloud Console**, not Google AI Studio:

1. Select the GridSync project (project number `167752816501`) in https://console.cloud.google.com/ .
2. Link a billing account under Billing. Maps JavaScript API requires billing even within its free usage allowance.
3. Open APIs & Services → Library. Enable **Maps JavaScript API**.
4. Open APIs & Services → Credentials → Create credentials → API key. Make a separate browser key for Maps; do not reuse the backend Gemini key.
5. Edit that key. Under application restrictions, choose **Websites** and add `http://localhost:5173/*` and `http://127.0.0.1:5173/*`. Under API restrictions, restrict it to **Maps JavaScript API**. Save.
6. Put the key in the existing Git-ignored `frontend/.env.local`:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_maps_browser_key
```

7. Restart `npm run dev`. Start Django as usual in a separate terminal. The frontend uses port 5173 and fails rather than silently changing to an unapproved port.

The Maps browser key is intentionally visible in browser requests; website and API restrictions protect its use. Never put Gemini credentials or the MongoDB URI in any `VITE_` variable. No Map ID is required by this implementation, which uses Google's GeoJSON Data layer. Places, Geocoding, and Routes APIs are not required to display existing coordinates.

Billing budgets provide alerts, not hard spending caps. Review API quotas for usage control. Add your production website origin to key restrictions when deploying. Setup references: [Google API setup](https://developers.google.com/maps/documentation/javascript/get-api-key), [key restrictions](https://developers.google.com/maps/api-security-best-practices), [Data layer](https://developers.google.com/maps/documentation/javascript/datalayer).

Google imagery and browser rendering must be verified after a valid Maps key and billing are configured. Missing-key setup works without contacting Google Maps. Substation rows at the same coordinates overlap; clustering and grouped selection remain future improvements.

## Overview layout

The default page is the utility projects map. `frontend/src/features/overview/` separates map rendering, filtering helpers, and page layout. The dark sidebar links to the overview, the saved coordination list, and the existing Projects import workspace. Consultation is visibly disabled until implemented.

`GET /api/map/overview/` serves one source snapshot (latest imported by default), joined project/substation locations, supplied route geometry, and saved spatial candidates. The filters apply to project records; an opportunity appears only when both records pass. Unassociated substations appear in the unfiltered view and are excluded when project filters narrow the selection. Owner colors use the complete snapshot's owner list, so they remain stable as filters change; colors repeat after six owners.

Counts are project records, not unique project groups. Red highlights indicate saved proximity candidates. Only the selected candidate gets a dashed distance comparison line. Actual transmission routes remain unavailable until supplied, and unknown timeline overlap is displayed as “Not assessed.” The importer remains available under Projects. Frontend filter tests: `node --test frontend/src/features/overview/model.test.js`.


## Project research and evidence-based chat

Open **Projects → View project** (or **Details** on a map opportunity / **Research & chat** in Coordination).
The library has project/utility/state/type filters and retains the Excel import screen behind **Import Excel**.

The first-project workflow supports:

- Imported specifications with separate construction, in-service and state/federal permitting fields.
- **Research this project**: Gemini URL Context reads up to six supplied public links, including supported PDFs.
  Optional Google Search looks for additional project-specific sources. It does not download an archive,
  crawl every nested link, or bypass paywalls. Public identity fields and source links are sent to Gemini;
  database credentials and raw spreadsheet rows are not included.
- A saved research report, tool-returned citations, source retrieval status, proposed dates/costs/status,
  missing-field summary and the five latest research runs.
- **Mark reviewed / Reject / Reset review** on individual proposals. Review does not update canonical project
  fields or rerun coordination scoring. Construction dates, project-level budgets, publication dates and
  project identity still need verification against original documents.
- Project Q&A using the imported record and selected research run, with evidence references. No automatic
  live search occurs during chat, rejected findings are excluded, and each question is independent.
  Chat messages are session-only; research and finding review states are stored.

Research uses the existing backend GEMINI_API_KEY / GEMINI_MODEL configuration and the Gemini Developer API
(no Vertex AI migration). The configured model must support URL Context and Google Search. Research normally
uses two Gemini calls (grounded report then structured proposals); chat uses one. Credentials remain backend-only.
A 429 response means the key/model hit rate or quota limits: check Gemini API quota/billing or retry later.
There is no automatic retry loop. Source-tool access is documented at
https://ai.google.dev/gemini-api/docs/generate-content/url-context.

Implementation is separated into:
- backend/research/evidence.py: URL allowlist, source metadata, serialization and evidence validation.
- backend/research/ai.py: research/chat prompts and Gemini orchestration.
- backend/research/views.py: local-only, CSRF-protected API and MongoDB persistence.
- frontend/src/features/projects/: library, details, research review and chat.

New collection: project_research, created on first successful research save with a project/history index.
Research snapshots reference the exact project record ObjectId (not just its display name). Existing project,
substation and opportunity records are not changed. Existing application access remains development-only.

Evidence limits: source URLs must appear in Google's grounding/retrieval metadata; proposed supporting passages
must occur in the saved AI report. These checks do not independently verify the original document quotation
or semantic attribution. The UI labels proposals as unverified, keeps report passages distinct from original
document quotes, and preserves conflicting proposals for review. Scanned/inaccessible documents or empty
tool metadata can produce no findings. Tool-supported reports survive an extraction failure.

Validation:
    backend/.venv/bin/python backend/manage.py test research database mapping coordination
    npm --prefix frontend run lint
    npm --prefix frontend run build

Pilot: SRP Abel-Pfister-Ball project search/details worked against MongoDB. The live research request returned
HTTP 429; a successful live research/chat run still needs verification once API quota is available.
