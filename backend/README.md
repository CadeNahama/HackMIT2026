# backend — Plume lake → similarity graph → 3D map

Public scrape of HackMIT / Blueprint 2025–2026, then a high-rigor similarity
graph used by the Next.js 3D map.

See [DATA.md](./DATA.md) for fields, [SIMILARITY.md](./SIMILARITY.md) for why
track/sponsor tags are *not* edges.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Pipeline

```bash
python sync.py --out data/projects.json --no-supabase
python similarity.py --copy-public ../frontend/public/map
python predict.py --copy-public ../frontend/public/forecast
python elastic_map.py --coords data/coords.json
```

Or one command / one UI button:

```bash
python refresh.py            # live HackMIT 2026 only (cache-busted details)
python refresh.py --all      # every stored hackathon
```

The Next.js **Pull live 2026** button runs `refresh.py`. It re-fetches 2026
writeups/tracks/ranks from Plume, merges them into the existing lake (2025
ranks stay), rebuilds the similarity graph, rebuilds the forecast, and
reindexes Elasticsearch. Status is `data/refresh_status.json`.

`similarity.py` writes `data/graph.json` + `data/coords.json` and optionally
copies them into the frontend. Re-run `refresh.py` whenever 2026 writeups
fill in — cached 2026 details are otherwise stale.

The **3D map** is served from Elasticsearch (`hackmit-map` index). Interviews
and the rest of the product stay in Supabase. After a graph rebuild:

```bash
python elastic_map.py --coords data/coords.json
```

or pass `--elastic` to `similarity.py` (also runs automatically if
`ELASTIC_URL` is set). Copy `ELASTIC_URL` + `ELASTIC_API_KEY` into both
`backend/.env` and `frontend/.env.local`.

## Outputs

| File | Role |
|---|---|
| `data/projects.json` | Full entity lake |
| `data/features.json` | Flat table for a later rank model |
| `data/graph.json` | Nodes + evidenced edges (the rigorous object) |
| `data/forecast.json` | 2026 analogue + ridge forecast (hack-2025 labels only) |
