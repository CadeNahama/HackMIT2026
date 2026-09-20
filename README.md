# HackMIT 2026

3D project-similarity map, 2026 ranking prior, and writeup analogue search for HackMIT / Blueprint.

```
frontend/   Next.js app (map, forecast, match)
backend/    Python pipeline (Plume scrape → graph → forecast → Elasticsearch)
```

## Quick start

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # add Elastic + Supabase keys
npm run dev                  # http://localhost:3000
```

The map reads `GET /api/map` (Elasticsearch). If `ELASTIC_URL` is unset it
falls back to `frontend/public/map/coords.json`.

**Backend**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env         # same Elastic keys; optional Supabase service role
```

Pipeline:

```bash
python sync.py --out data/projects.json --no-supabase
python similarity.py --copy-public ../frontend/public/map
python predict.py --copy-public ../frontend/public/forecast
python elastic_map.py --coords data/coords.json
```

Or one command / the UI **Pull live 2026** button:

```bash
python refresh.py            # live HackMIT 2026 only
python refresh.py --all      # every stored hackathon
```

`refresh.py` copies map + forecast snapshots into `frontend/public/`. Generated
lake files stay in `backend/data/` (gitignored).

Copy `ELASTIC_URL` + `ELASTIC_API_KEY` into both `frontend/.env.local` and
`backend/.env`. Interviews stay in Supabase; the 3D map snapshot lives in
Elasticsearch (`hackmit-map`).

See [frontend/README.md](frontend/README.md), [backend/README.md](backend/README.md),
and [backend/SIMILARITY.md](backend/SIMILARITY.md).
