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
