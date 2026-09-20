"""HackMIT 2026 forecast + writeup analogue scorer.

This is not an oracle. Public writeups only weakly predict within-track
rank on held-out HackMIT 2025 folds (see model_card). What *is* defensible:

  • Retrieval: nearest judged 2025 writeups in the same TF-IDF/LSA space
    used for the 3D map (train vectorizer on hack-2025 judged projects only
    — no 2026 leakage into the basis).
  • Analogue placement: similarity-weighted within-track percentile of
    those neighbors, with a bootstrap interval.
  • Finalist-likeness: weighted share of neighbors that finished top-10
    in their 2025 track.
  • Track inference for hack-2026, whose public gallery currently has
    track = NO TRACK for every project.
  • Explicit refusal to rank empty writeups (207/236 of hack-2026).

Blueprint 2025 ranks exist but are a different population (high school).
They are stored as optional analogues, never mixed into the HackMIT scorer.

  python predict.py
  python predict.py --copy-public ../frontend/public/forecast
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.model_selection import StratifiedKFold
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import LabelEncoder

import similarity as sim

JUDGED_EVENT = "hack-2025"
TARGET_EVENT = "hack-2026"
K_NEIGHBORS = 12
LSA_DIMS = 32
MIN_WRITEUP_FOR_FORECAST = 200
FINALIST_K = 10
TOP3_K = 3


def n_fields(p: dict) -> int:
    return sum(1 for k in sim.WRITEUP_FIELDS if isinstance(p.get(k), str) and p[k].strip())


def track_of(p: dict) -> str:
    t = p.get("track")
    return t if t and t != "NO TRACK" else "NO TRACK"


def within_track_percentile(rank: int, n: int) -> float:
    """1.0 = first in track, 0.0 = last. Rank is 0-indexed (best)."""
    if n <= 1:
        return 1.0
    return float(1.0 - rank / (n - 1))


def ndcg_at_k(ranks: np.ndarray, pred: np.ndarray, k: int = 10) -> float:
    n = len(ranks)
    rel = (n - ranks).astype(float)
    order = np.argsort(-pred)
    kk = min(k, n)
    discounts = np.log2(np.arange(2, kk + 2))
    dcg = float(np.sum(rel[order][:kk] / discounts))
    idcg = float(np.sum(np.sort(rel)[::-1][:kk] / discounts))
    return dcg / idcg if idcg else 0.0


def topk_overlap(ranks: np.ndarray, pred: np.ndarray, k: int = 10) -> float:
    kk = min(k, len(ranks))
    true_top = set(np.argsort(ranks)[:kk].tolist())
    pred_top = set(np.argsort(-pred)[:kk].tolist())
    return len(true_top & pred_top) / kk


def eval_within_track(pred: np.ndarray, ranks: np.ndarray, tracks: list[str]) -> dict:
    sizes = Counter(tracks)
    y = np.array([within_track_percentile(int(r), sizes[tracks[i]]) for i, r in enumerate(ranks)])
    rho, _ = spearmanr(pred, y)
    ndcgs, rhos, ov = [], [], []
    for t in sorted(set(tracks)):
        idx = np.array([i for i, tt in enumerate(tracks) if tt == t])
        if len(idx) < 8:
            continue
        p, r = pred[idx], ranks[idx]
        ndcgs.append(ndcg_at_k(r, p, 10))
        rh, _ = spearmanr(p, -r)
        rhos.append(float(rh) if rh == rh else 0.0)
        ov.append(topk_overlap(r, p, 10))
    return {
        "spearman_vs_percentile": None if rho != rho else round(float(rho), 3),
        "mean_track_ndcg10": round(float(np.mean(ndcgs)), 3) if ndcgs else None,
        "mean_track_spearman": round(float(np.mean(rhos)), 3) if rhos else None,
        "mean_track_top10_overlap": round(float(np.mean(ov)), 3) if ov else None,
        "n_tracks_eval": len(ndcgs),
    }


def bootstrap_weighted_mean(values: np.ndarray, weights: np.ndarray, rng: np.random.RandomState, draws: int = 400) -> tuple[float, float, float]:
    n = len(values)
    if n == 0:
        return 0.0, 0.0, 0.0
    means = []
    for _ in range(draws):
        ix = rng.randint(0, n, n)
        w = weights[ix]
        v = values[ix]
        means.append(float(np.sum(w * v) / (np.sum(w) + 1e-9)))
    lo, mid, hi = np.quantile(means, [0.1, 0.5, 0.9])
    return float(mid), float(lo), float(hi)


def confidence_of(writeup_chars: int, mean_cos: float, n_fields_filled: int) -> str:
    if writeup_chars < 80:
        return "none"
    if writeup_chars < MIN_WRITEUP_FOR_FORECAST:
        return "low"
    if writeup_chars >= 800 and n_fields_filled >= 4 and mean_cos >= 0.06:
        return "high"
    return "medium"


def analogue_from_neighbors(
    neighbor_idx: np.ndarray,
    dist: np.ndarray,
    judged: list[dict],
    y: np.ndarray,
    track_size: dict[str, int],
    rng: np.random.RandomState,
) -> dict:
    w = 1.0 / (dist + 1e-6)
    w = w / w.sum()
    perc = y[neighbor_idx]
    tracks = [track_of(judged[j]) for j in neighbor_idx]
    vote = Counter(tracks).most_common(1)[0]
    finalist = np.array([
        1.0 if judged[j]["rank"] < FINALIST_K else 0.0 for j in neighbor_idx
    ])
    top3 = np.array([
        1.0 if judged[j]["rank"] < TOP3_K else 0.0 for j in neighbor_idx
    ])
    mid, lo, hi = bootstrap_weighted_mean(perc, w, rng)
    fin_mid, fin_lo, fin_hi = bootstrap_weighted_mean(finalist, w, rng)
    return {
        "predicted_track": vote[0],
        "track_votes": vote[1],
        "track_confidence": round(vote[1] / len(neighbor_idx), 3),
        "analogue_percentile": round(mid, 3),
        "analogue_percentile_lo": round(lo, 3),
        "analogue_percentile_hi": round(hi, 3),
        "finalist_likeness": round(fin_mid, 3),
        "finalist_likeness_lo": round(fin_lo, 3),
        "finalist_likeness_hi": round(fin_hi, 3),
        "top3_likeness": round(float(np.sum(w * top3)), 3),
        "mean_neighbor_cosine": round(float(np.mean(1.0 - dist)), 3),
        "neighbors": [
            {
                "project_id": judged[j]["project_id"],
                "project_name": judged[j]["project_name"],
                "track": track_of(judged[j]),
                "rank": int(judged[j]["rank"]),
                "place": int(judged[j]["rank"]) + 1,
                "track_size": track_size[track_of(judged[j])],
                "score": judged[j].get("score"),
                "cosine": round(float(1.0 - dist[k]), 3),
                "writeup_chars": len(sim.writeup_of(judged[j])),
            }
            for k, j in enumerate(neighbor_idx[:8])
        ],
    }


def cross_val_card(lsa: np.ndarray, y: np.ndarray, ranks: np.ndarray, tracks: list[str], judged: list[dict]) -> dict:
    te = LabelEncoder().fit_transform(tracks)
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    analog = np.zeros(len(judged))
    finalist = np.zeros(len(judged))
    text_ridge = np.zeros(len(judged))
    for tr, va in skf.split(np.zeros(len(judged)), te):
        nn = NearestNeighbors(n_neighbors=min(K_NEIGHBORS, len(tr)), metric="cosine").fit(lsa[tr])
        dist, ind = nn.kneighbors(lsa[va])
        w = 1.0 / (dist + 1e-6)
        analog[va] = np.sum(w * y[tr][ind], axis=1) / np.sum(w, axis=1)
        fin = np.array([[1.0 if judged[tr[j]]["rank"] < FINALIST_K else 0.0 for j in row] for row in ind])
        finalist[va] = np.sum(w * fin, axis=1) / np.sum(w, axis=1)
        mdl = Ridge(alpha=2.0).fit(lsa[tr], y[tr])
        text_ridge[va] = mdl.predict(lsa[va])
    rng = np.random.RandomState(0)
    random_pred = rng.randn(len(judged))
    writeup_len = np.array([math.log1p(len(sim.writeup_of(p))) for p in judged])
    return {
        "label": "within-track percentile of 0-indexed rank; hack-2025 judged only (n=250)",
        "validation": "5-fold, stratified by official track (no year hold-out exists)",
        "random": eval_within_track(random_pred, ranks, tracks),
        "log_writeup_chars": eval_within_track(writeup_len, ranks, tracks),
        "cv_analogue_knn": eval_within_track(analog, ranks, tracks),
        "cv_finalist_likeness": eval_within_track(finalist, ranks, tracks),
        "cv_ridge_lsa": eval_within_track(text_ridge, ranks, tracks),
        "read": "NDCG@10 ~0.51 is chance. Ridge-LSA is the strongest public-writeup ranker and still only a modest lift. Analogue percentile is for case-matching, not a guaranteed place.",
    }


def reason_bits(row: dict) -> list[str]:
    bits = []
    conf = row["confidence"]
    if conf == "none":
        bits.append("Almost no public writeup — placement cannot be inferred from content.")
        return bits
    if conf == "low":
        bits.append("Writeup is still thin; analogues are noisy.")
    listed = row.get("listed_track")
    if listed and listed != "NO TRACK":
        bits.append(f"Registered on the public 2026 gallery as {listed}.")
    inferred = row.get("inferred_track") or row.get("predicted_track")
    if inferred and inferred != "NO TRACK":
        src = "also cluster" if listed and listed != "NO TRACK" else "cluster"
        bits.append(
            f"Nearest judged 2025 writeups {src} in {inferred} "
            f"({int(round((row.get('track_confidence') or 0) * 12))}/{K_NEIGHBORS} neighbors)."
        )
    lo, hi = row["analogue_percentile_lo"], row["analogue_percentile_hi"]
    bits.append(
        f"Similarity-weighted 2025 analogue percentile {row['analogue_percentile']:.2f} "
        f"(80% bootstrap {lo:.2f}–{hi:.2f}; 1.00 = first in track)."
    )
    bits.append(
        f"Finalist-likeness {row['finalist_likeness']:.2f}: share of those neighbors who finished "
        f"top {FINALIST_K} in their 2025 track (interval {row['finalist_likeness_lo']:.2f}–{row['finalist_likeness_hi']:.2f})."
    )
    neigh = row.get("neighbors") or []
    if neigh:
        best = min(neigh, key=lambda n: n["rank"])
        bits.append(
            f"Closest strong analogue: {best['project_name']} "
            f"({best['place']} of {best['track_size']} in {best['track']}, cosine {best['cosine']:.2f})."
        )
    if row["writeup_chars"] < 800:
        bits.append("HackMIT 2025 top finishes usually had long, multi-section writeups; this one is short.")
    return bits


def score_matrix(
    lsa_q: np.ndarray,
    lsa_j: np.ndarray,
    judged: list[dict],
    y: np.ndarray,
    track_size: dict[str, int],
    projects_q: list[dict],
) -> list[dict]:
    nn = NearestNeighbors(n_neighbors=min(K_NEIGHBORS, len(judged)), metric="cosine").fit(lsa_j)
    dist, ind = nn.kneighbors(lsa_q)
    rng = np.random.RandomState(42)
    out = []
    for i, p in enumerate(projects_q):
        wtxt = sim.writeup_of(p)
        analog = analogue_from_neighbors(ind[i], dist[i], judged, y, track_size, rng)
        nf = n_fields(p)
        conf = confidence_of(len(wtxt), analog["mean_neighbor_cosine"], nf)
        listed = track_of(p)
        analog["inferred_track"] = analog.get("predicted_track")
        analog["track_source"] = "inferred"
        if listed != "NO TRACK":
            analog["predicted_track"] = listed
            analog["track_source"] = "gallery"
        elif len(wtxt) < MIN_WRITEUP_FOR_FORECAST:
            analog["predicted_track"] = None
            analog["track_confidence"] = 0.0
        row = {
            "project_id": p["project_id"],
            "project_name": p["project_name"],
            "hackathon_id": p.get("hackathon_id"),
            "listed_track": track_of(p),
            "team_size": p.get("team_size"),
            "schools": p.get("schools") or [],
            "sponsor_challenges": sim.sponsor_names(p),
            "writeup_chars": len(wtxt),
            "n_writeup_fields": nf,
            "has_code_link": bool(p.get("code_link")),
            "has_video": bool(p.get("video_demo")),
            "description": (p.get("description") or p.get("what_it_does") or "")[:400],
            "confidence": conf,
            **analog,
        }
        if conf == "none":
            row["analogue_percentile"] = None
            row["finalist_likeness"] = None
            row["top3_likeness"] = None
            row["neighbors"] = []
            if row.get("track_source") != "gallery":
                row["predicted_track"] = None
        row["reasons"] = reason_bits(row)
        out.append(row)
    return out


def build(projects: list[dict]) -> dict:
    judged = [
        p for p in projects
        if p.get("hackathon_id") == JUDGED_EVENT and p.get("rank") is not None
    ]
    if len(judged) < 50:
        raise SystemExit("Need judged hack-2025 ranks to fit the analogue space.")
    tracks = [track_of(p) for p in judged]
    track_size = Counter(tracks)
    ranks = np.array([int(p["rank"]) for p in judged])
    y = np.array([within_track_percentile(int(p["rank"]), track_size[track_of(p)]) for p in judged])

    texts = [sim.writeup_of(p) for p in judged]
    stop = ENGLISH_STOP_WORDS.union(sim.EXTRA_STOP)
    vec = TfidfVectorizer(
        max_features=8000,
        ngram_range=(1, 2),
        min_df=3,
        max_df=0.4,
        stop_words=list(stop),
        token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9_+\-]{2,}\b",
    )
    Xj = vec.fit_transform(texts)
    n_svd = min(LSA_DIMS, Xj.shape[0] - 1, Xj.shape[1] - 1)
    svd = TruncatedSVD(n_components=n_svd, random_state=42)
    lsa_j = svd.fit_transform(Xj)

    card = cross_val_card(lsa_j, y, ranks, tracks, judged)
    target = [p for p in projects if p.get("hackathon_id") == TARGET_EVENT]
    n_thin = sum(1 for p in target if len(sim.writeup_of(p)) < MIN_WRITEUP_FOR_FORECAST)
    track_counts = Counter(track_of(p) for p in target)
    public_track: dict | str
    if not track_counts or set(track_counts) <= {"NO TRACK"}:
        public_track = "all NO TRACK on the unauthenticated gallery at scrape time"
    else:
        public_track = dict(track_counts)

    card["corpus"] = {
        "judged_hack2025": len(judged),
        "per_track": dict(track_size),
        "hack2026": len(target),
        "hack2026_writeup_ge_200": len(target) - n_thin,
        "hack2026_public_track": public_track,
        "blueprint_2025_ranked": sum(
            1 for p in projects if p.get("hackathon_id") == "bp-2025" and p.get("rank") is not None
        ),
        "domain_shift": "Blueprint is not mixed into the scorer (high-school judging pool).",
    }
    card["caveats"] = [
        "hack-2025 prize_winners is empty in the public API; labels are rank/score only, not sponsor trophies.",
        "Plume score is often tied at the top of a track; rank still orders projects, so we model rank not raw score.",
        "is_beginner correlates with raw score because larger tracks dilute pairwise win-rate — never pool tracks.",
        f"{n_thin}/{len(target)} hack-2026 gallery cards have <{MIN_WRITEUP_FOR_FORECAST} characters of writeup; those get confidence=none.",
        "A 5-fold lift from NDCG@10 0.51 (chance) to ~0.59 is real and small. Do not treat the 2026 order as a result.",
    ]
    Xt = vec.transform([sim.writeup_of(p) for p in target])
    lsa_t = svd.transform(Xt)
    ridge = Ridge(alpha=2.0).fit(lsa_j, y)
    model_p = np.clip(ridge.predict(lsa_t), 0.0, 1.0)
    scored = score_matrix(lsa_t, lsa_j, judged, y, track_size, target)
    for r, mp in zip(scored, model_p):
        if r["confidence"] == "none":
            r["model_percentile"] = None
        else:
            r["model_percentile"] = round(float(mp), 3)
            r["reasons"].insert(
                1,
                f"Content model (ridge on 32-d writeup LSA, fit on 2025 ranks) places this near percentile {mp:.2f} of a 2025 track.",
            )

    scored.sort(
        key=lambda r: (
            0 if r["confidence"] in ("high", "medium") else 1,
            -(r.get("model_percentile") if r.get("model_percentile") is not None else -1),
            -(r["finalist_likeness"] or -1),
        )
    )

    by_track: dict[str, list[str]] = defaultdict(list)
    for r in scored:
        if r["confidence"] == "none":
            by_track["insufficient_writeup"].append(r["project_id"])
        track_key = r.get("predicted_track") or "unclear"
        if r["confidence"] != "none":
            by_track[track_key].append(r["project_id"])

    judged_mini = [
        {
            "project_id": p["project_id"],
            "project_name": p["project_name"],
            "track": track_of(p),
            "rank": int(p["rank"]),
            "place": int(p["rank"]) + 1,
            "track_size": track_size[track_of(p)],
            "score": p.get("score"),
            "percentile": round(within_track_percentile(int(p["rank"]), track_size[track_of(p)]), 3),
            "team_size": p.get("team_size"),
            "writeup_chars": len(sim.writeup_of(p)),
            "description": (p.get("description") or p.get("what_it_does") or "")[:500],
        }
        for p in judged
    ]

    return {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "model_card": card,
        "hack2026": scored,
        "by_track": {k: v for k, v in by_track.items()},
        "judged_2025": judged_mini,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", type=Path, default=Path("data/projects.json"))
    ap.add_argument("--out", type=Path, default=Path("data/forecast.json"))
    ap.add_argument("--copy-public", type=Path, default=None)
    args = ap.parse_args()
    here = Path(__file__).resolve().parent
    infile = args.infile if args.infile.is_absolute() else here / args.infile
    out = args.out if args.out.is_absolute() else here / args.out

    raw = json.loads(infile.read_text())
    projects = raw["projects"]
    print(f"Loaded {len(projects)} projects", flush=True)
    payload = build(projects)
    payload["scraped_at"] = raw.get("scraped_at")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False) + "\n")
    m = payload["model_card"]
    print("CV ridge LSA", m["cv_ridge_lsa"])
    print("CV analogue", m["cv_analogue_knn"])
    print("chance     ", m["random"])
    n_ok = sum(1 for r in payload["hack2026"] if r["confidence"] in ("high", "medium"))
    print(f"hack-2026 forecastable {n_ok}/{len(payload['hack2026'])}")
    print(f"Wrote {out}")
    if args.copy_public:
        dest = args.copy_public if args.copy_public.is_absolute() else here / args.copy_public
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "forecast.json").write_text(out.read_text())
        print(f"Copied into {dest}")


if __name__ == "__main__":
    main()
