"""Push the 3D map snapshot into Elasticsearch.

This is the only Elastic surface in the stack: the map's points, edges, and
theme islands. The Plume lake, interviews, and anything else stay in
Supabase / local JSON.

  python elastic_map.py
  python elastic_map.py --coords data/coords.json

Needs ELASTIC_URL + ELASTIC_API_KEY in .env (Elastic Cloud trial is enough).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from elasticsearch import Elasticsearch, helpers

INDEX_DEFAULT = "hackmit-map"

MAPPINGS = {
    "properties": {
        "kind": {"type": "keyword"},
        "project_id": {"type": "keyword"},
        "project_name": {
            "type": "text",
            "fields": {"raw": {"type": "keyword"}},
        },
        "hackathon_id": {"type": "keyword"},
        "track": {"type": "keyword"},
        "confidence": {"type": "keyword"},
        "cluster_id": {"type": "integer"},
        "cluster_label": {"type": "keyword"},
        "is_winner": {"type": "boolean"},
        "x": {"type": "float"},
        "y": {"type": "float"},
        "z": {"type": "float"},
        "source": {"type": "keyword"},
        "target": {"type": "keyword"},
        "cosine": {"type": "float"},
        "weight": {"type": "float"},
        "writeup": {"type": "text"},
        "description": {"type": "text"},
        "rank": {"type": "integer"},
        "score": {"type": "float"},
    }
}


def client_from_env() -> tuple[Elasticsearch, str]:
    load_dotenv(Path(__file__).resolve().parent / ".env")
    url = (os.environ.get("ELASTIC_URL") or "").rstrip("/")
    key = os.environ.get("ELASTIC_API_KEY") or ""
    index = os.environ.get("ELASTIC_INDEX") or INDEX_DEFAULT
    if not url or not key:
        raise SystemExit(
            "Set ELASTIC_URL and ELASTIC_API_KEY in backend/.env"
        )
    return Elasticsearch(url, api_key=key, request_timeout=60), index


def attach_writeups(coords: dict, projects_path: Path) -> dict:
    if not projects_path.exists():
        return coords
    import similarity as sim

    projects = json.loads(projects_path.read_text()).get("projects") or []
    by_id = {p["project_id"]: sim.writeup_of(p)[:2000] for p in projects}
    points = []
    for p in coords.get("points") or []:
        q = dict(p)
        q["writeup"] = by_id.get(p.get("project_id"), "") or (p.get("description") or "")
        points.append(q)
    out = dict(coords)
    out["points"] = points
    return out


def docs_from_coords(coords: dict) -> list[dict]:
    actions: list[dict] = [
        {
            "_id": "meta",
            "kind": "meta",
            "built_at": coords.get("built_at"),
            "method": coords.get("method"),
            "count": coords.get("count"),
        }
    ]
    for p in coords.get("points") or []:
        pid = p.get("project_id")
        actions.append({"_id": f"p-{pid}", "kind": "point", **p})
    for e in coords.get("edges") or []:
        sid, tid = e.get("source"), e.get("target")
        actions.append({"_id": f"e-{sid}-{tid}", "kind": "edge", **e})
    for c in coords.get("clusters") or []:
        actions.append({"_id": f"c-{c.get('id')}", "kind": "cluster", **c})
    return actions


def upload_coords(
    coords: dict,
    client: Elasticsearch | None = None,
    index: str | None = None,
    projects_path: Path | None = None,
) -> int:
    here = Path(__file__).resolve().parent
    coords = attach_writeups(coords, projects_path or here / "data" / "projects.json")

    es, default_index = (client, index) if client and index else (None, None)
    if es is None:
        es, default_index = client_from_env()
    index = index or default_index or INDEX_DEFAULT

    if es.indices.exists(index=index):
        es.indices.delete(index=index)
    es.indices.create(index=index, mappings=MAPPINGS)

    bulk_actions = []
    for doc in docs_from_coords(coords):
        action = {
            "_index": index,
            "_id": doc["_id"],
        }
        action.update((k, v) for k, v in doc.items() if k != "_id")
        bulk_actions.append(action)
    success, errors = helpers.bulk(es, bulk_actions, refresh="wait_for")
    if errors:
        raise RuntimeError(f"Elasticsearch bulk had errors: {errors[:3]}")
    print(f"Indexed {success} docs into {index}")
    return int(success)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--coords",
        type=Path,
        default=Path("data/coords.json"),
        help="coords.json produced by similarity.py",
    )
    args = ap.parse_args()
    here = Path(__file__).resolve().parent
    path = args.coords if args.coords.is_absolute() else here / args.coords
    coords = json.loads(path.read_text())
    if "points" not in coords:
        raise SystemExit(f"{path} is not a coords.json snapshot")
    upload_coords(coords, projects_path=here / "data" / "projects.json")


if __name__ == "__main__":
    main()
