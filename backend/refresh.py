"""One-button live refresh: Plume scrape → similarity map → forecast → Elastic.

  python refresh.py            # re-fetch hack-2026, rebuild map + forecast
  python refresh.py --all      # re-scrape every stored hackathon

The frontend "Pull live 2026" button runs this script. Status is written to
data/refresh_status.json so the UI can poll without keeping the HTTP request
open for the whole scrape.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATUS_PATH = HERE / "data" / "refresh_status.json"
PUBLIC_MAP = HERE.parent / "frontend" / "public" / "map"
PUBLIC_FORECAST = HERE.parent / "frontend" / "public" / "forecast"
WRITEUP_FIELDS = (
    "description",
    "what_it_does",
    "inspiration",
    "how_we_built_it",
    "challenges_we_ran_into",
    "accomplishments",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def writeup_len(p: dict) -> int:
    parts = []
    for k in WRITEUP_FIELDS:
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
    return len("\n\n".join(parts))


def read_status() -> dict:
    if not STATUS_PATH.exists():
        return {"state": "idle"}
    try:
        return json.loads(STATUS_PATH.read_text())
    except json.JSONDecodeError:
        return {"state": "idle"}


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def write_status(payload: dict) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(STATUS_PATH)


def summarize() -> dict:
    projects_path = HERE / "data" / "projects.json"
    forecast_path = HERE / "data" / "forecast.json"
    graph_path = HERE / "data" / "graph.json"
    out: dict = {}
    if projects_path.exists():
        lake = json.loads(projects_path.read_text())
        rows = lake.get("projects") or []
        by = Counter(p.get("hackathon_id") for p in rows)
        h26 = [p for p in rows if p.get("hackathon_id") == "hack-2026"]
        tracks = Counter((p.get("track") or "NO TRACK") for p in h26)
        out.update(
            {
                "scraped_at": lake.get("scraped_at"),
                "count": len(rows),
                "hackathons": dict(by),
                "hack2026": len(h26),
                "hack2026_writeup_ge_200": sum(1 for p in h26 if writeup_len(p) >= 200),
                "hack2026_with_description": sum(1 for p in h26 if (p.get("description") or "").strip()),
                "hack2026_tracks": dict(tracks),
            }
        )
    if graph_path.exists():
        graph = json.loads(graph_path.read_text())
        corpus = (graph.get("method") or {}).get("corpus") or {}
        out["edges"] = graph.get("count_edges") or corpus.get("edges")
        out["content_eligible"] = corpus.get("content_eligible")
        out["theme_islands"] = corpus.get("theme_islands")
        out["graph_built_at"] = graph.get("built_at")
    if forecast_path.exists():
        forecast = json.loads(forecast_path.read_text())
        rows = forecast.get("hack2026") or []
        out["forecast_built_at"] = forecast.get("built_at")
        out["forecastable"] = sum(
            1 for r in rows if r.get("confidence") in ("high", "medium")
        )
        out["forecast_n"] = len(rows)
    return out


class Job:
    def __init__(self, mode: str) -> None:
        prev = read_status()
        self.payload: dict = {
            "state": "running",
            "mode": mode,
            "step": "start",
            "pid": os.getpid(),
            "started_at": now_iso(),
            "finished_at": None,
            "error": None,
            "log": [],
            "summary": prev.get("summary") or {},
        }
        self.flush()

    def flush(self) -> None:
        write_status(self.payload)

    def log(self, line: str, step: str | None = None) -> None:
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        msg = f"{stamp} {line}"
        print(msg, flush=True)
        log = list(self.payload.get("log") or [])
        log.append(msg)
        self.payload["log"] = log[-60:]
        if step:
            self.payload["step"] = step
        self.flush()

    def run_py(self, argv: list[str], step: str) -> None:
        self.log("$ " + " ".join(argv), step=step)
        proc = subprocess.Popen(
            [sys.executable, "-u", *argv],
            cwd=HERE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            text = line.rstrip()
            if text:
                self.log(text)
        rc = proc.wait()
        if rc != 0:
            raise SystemExit(f"{argv[0]} exited {rc}")

    def finish(self, ok: bool, error: str | None = None) -> None:
        self.payload["state"] = "ok" if ok else "error"
        self.payload["step"] = "done" if ok else self.payload.get("step")
        self.payload["finished_at"] = now_iso()
        self.payload["error"] = error
        try:
            self.payload["summary"] = summarize()
        except Exception as e:
            self.log(f"summary failed: {e}")
        self.flush()


def already_running() -> dict | None:
    st = read_status()
    if st.get("state") == "running" and pid_alive(st.get("pid")):
        return st
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Pull live Plume data and rebuild map + forecast")
    ap.add_argument(
        "--all",
        action="store_true",
        help="Re-scrape every hackathon (slow). Default is HackMIT 2026 only.",
    )
    ap.add_argument(
        "--status",
        action="store_true",
        help="Print data/refresh_status.json and exit",
    )
    args = ap.parse_args()

    if args.status:
        print(json.dumps(read_status(), indent=2))
        return

    running = already_running()
    if running:
        raise SystemExit(f"refresh already running (pid {running.get('pid')})")

    mode = "all" if args.all else "live"
    job = Job(mode)
    try:
        if args.all:
            job.run_py(
                ["sync.py", "--refresh-details", "--no-supabase"],
                "scrape",
            )
        else:
            job.run_py(["sync.py", "--live"], "scrape")

        job.run_py(
            [
                "similarity.py",
                "--copy-public",
                str(PUBLIC_MAP),
                "--no-elastic",
            ],
            "graph",
        )
        job.run_py(
            ["predict.py", "--copy-public", str(PUBLIC_FORECAST)],
            "forecast",
        )
        try:
            job.run_py(["elastic_map.py"], "elastic")
        except SystemExit as e:
            job.log(f"Elasticsearch upload skipped/failed: {e}")
            job.payload["elastic_error"] = str(e)[:500]
            job.flush()

        job.finish(True)
        s = job.payload.get("summary") or {}
        job.log(
            f"done 2026={s.get('hack2026')} writeups≥200={s.get('hack2026_writeup_ge_200')} "
            f"edges={s.get('edges')} forecastable={s.get('forecastable')}"
        )
    except Exception as e:
        job.log(traceback.format_exc().strip()[-1500:])
        job.finish(False, str(e)[:1500])
        raise SystemExit(1)


if __name__ == "__main__":
    main()
