# frontend — 3D project similarity map

Next.js client for the Plume similarity graph. The graph is built in
`backend/` (`similarity.py`); this app renders it.

**Where data lives**

- **Elasticsearch** — 3D map snapshot (points, evidenced edges, theme islands)
- **Supabase** — interviews / everything that is not the map

## Setup

```bash
npm install
cp .env.example .env.local   # add Elastic + Supabase keys
npm run dev   # http://localhost:3000
```

Create an [Elastic Cloud trial](https://www.elastic.co/cloud/cloud-trial-overview),
copy the Elasticsearch endpoint and an API key into `.env.local`, then load
the map index from the backend:

```bash
cd ../backend
source .venv/bin/activate
python similarity.py --copy-public ../frontend/public/map
python elastic_map.py
```

The map reads `GET /api/map`, which queries Elastic. If `ELASTIC_URL` is
unset it falls back to `public/map/coords.json` for local work without a
cluster. An amber **Elasticsearch** chip in the toolbar means the live
index is in use.

**Pull live 2026** (in the header) re-fetches HackMIT 2026 from Plume and
rebuilds the map + forecast. It shells out to `../backend/refresh.py`
and needs that repo's `.venv`. Optional: `BACKEND_DIR`, `BACKEND_PYTHON`,
`REFRESH_SECRET` in `.env.local`.

## What you are looking at

- **Position** — UMAP of a 64-d LSA projection of project writeups.
- **Line** — a connection that passed the evidence rule (mutual nearest
  neighbors + distinctive shared terms). Track and popular sponsor tags
  do **not** create lines. See `../backend/SIMILARITY.md`.
- Thin / empty writeups (most of live HackMIT 2026) are hidden by default.

The old interview form still exists at `/data` plumbing if you need it;
the home page is the map.
