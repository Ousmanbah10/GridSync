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

To enable Gemini, set these in **`backend/.env`** and restart Django:

```dotenv
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.8-flash
```

The key stays on the backend. Gemini receives headings and the target field definitions, not project rows or MongoDB credentials. AI proposes mappings; the application validates them and reads the original cell values. It does not invent missing costs, dates, locations, or project facts. The standard mode works without an API key. Gemini uses Google's [structured output API](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

This initial importer supports the `Planned Transmission Projects`, `Study Concepts`, and `Substations in Planned Projects` sheet names, with headings in the first populated row. AI can match renamed columns within those sheets; arbitrary workbook layouts are not supported yet. Workbook formulas use saved values, so recalculate and save in Excel first if relevant.

Source identity uses the workbook's SHA-256 hash. Reimporting identical file bytes, even renamed, skips existing records and preserves later edits. A modified workbook is a separate source snapshot; cross-version reconciliation is future work. Duplicate project Record IDs block import, while duplicate substation source IDs are retained as distinct source rows with warnings. Voltage/capacity zero placeholders become unknown with their original values preserved.

Previews expire after 30 minutes and are lost when Django restarts (process-local cache). Imports use insert-only upserts in batches; a failed import may be partially saved, and retrying completes it without duplicating records. The source record alone does not prove all rows finished importing.

This is a **local development workspace**. API access requires `DEBUG=True` and a loopback connection, uses Django CSRF protection, and is proxied by Vite. It has no public user authentication; add authentication, shared preview storage, and a background worker before remote hosting. The Django/MongoDB backend is not a Cloudflare Worker and is not deployed through Sites.

```sh
backend/.venv/bin/python backend/manage.py test database
```
