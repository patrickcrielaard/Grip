# Grip

A simple to-do application built with FastAPI and Supabase. The app uses a small login page and stores tasks in Supabase via the service role key.

## Quick start

- Install deps: `uv sync --dev` (or `pip install -r requirements.txt`)
- Run locally: `make server` (http://127.0.0.1:8000/)
- Health check: `GET /health`

Required env:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (kept for parity, not used by the server)
- `APP_ENV` (`development`/`testing`/`production`)

## Supabase setup

Run the SQL in `sql/schema.sql` in the Supabase SQL editor. It creates the `app_users` and `tasks` tables plus a starter user.

Default login after running the seed:
- Username: `demo`
- Password: `change-me`

Change it immediately with the update statement included in `sql/schema.sql`.

## Railway

The repo includes a `railway.json` with a start command:

- `python -m grip.main`

## Project structure

```
grip/
├── app.py                # FastAPI app wiring, router includes, static mount
├── main.py               # Entry point to run the server
├── configuration.py      # Env-driven settings (Supabase keys, env flags)
├── supabase_service.py   # Supabase data access helpers
├── routes/               # Login + todo API routes
├── web/
│   ├── templates/        # HTML templates
│   └── static/          # CSS, JS, assets
└── pyproject.toml
```
