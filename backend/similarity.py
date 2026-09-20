"""High-rigor project similarity graph + 3D content map.

Design is empirical, not aesthetic. Diagnostics that produced the weights
live in SIMILARITY.md. Short version:

  • Track is a *display* attribute, never an edge. Same-track pairs are only
    ~0.008 cosine higher than different-track (0.051 vs 0.042). Connecting
    every Beginner to every Beginner would be 1,891 fake edges.
  • Popular sponsor tags (Anthropic ×144, Windsurf ×98, …) are similarly
    weak. Sharing *only* a top-5 challenge barely moves cosine.
  • Sharing a *rare* sponsor is a modest supporting signal (mean cosine
    0.074 vs 0.038 with no shared sponsor) — used as a small weight bonus
    after a content edge already exists, never as a reason to draw one.
  • hack-2026 is 88% writeups < 200 chars. Those records are plotted in a
    low-confidence halo and get no edges until they have a real writeup.

An edge exists only when ALL of:
  1. Both writeups ≥ 200 characters (content-eligible)
  2. Mutual k-NN in TF-IDF cosine (k=10)
  3. cosine ≥ 0.14  (~p98 of all eligible pairs)
  4. Signature-term evidence (see `passes_evidence`)

3D coordinates are UMAP of a 64-d LSA projection of the writeup TF-IDF
space (local neighborhoods). PCA is a fallback only. Lines = the high-rigor
graph; they are not required for two projects to sit near each other.

  python similarity.py
  python similarity.py --in data/projects.json --out-dir data
"""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.decomposition import PCA, TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.neighbors import NearestNeighbors

WRITEUP_FIELDS = (
    "description",
    "what_it_does",
    "inspiration",
    "how_we_built_it",
    "challenges_we_ran_into",
    "accomplishments",
)

# Tracks leak into `sponsor_challenge_names` on Blueprint. Never treat as prizes.
TRACK_NAMES = {
    "Beginner",
    "General",
    "Education",
    "Entertainment",
    "Healthcare",
    "Sustainability",
    "NO TRACK",
}

# Generic hackathon / product-process language. A shared "we built an app
# using an API" must not count as a connection.
BOILERPLATE = {
    "able", "also", "app", "application", "apps", "based", "build", "building",
    "built", "challenge", "challenges", "claude", "code", "create", "created",
    "creating", "data", "decided", "deploy", "deployed", "developed",
    "development", "did", "difficult", "easy", "end", "experience", "feature",
    "features", "finally", "fun", "future", "get", "goal", "goals", "got",
    "hackathon", "hard", "help", "hour", "hours", "idea", "ideas", "implementation",
    "implemented", "info", "information", "inspired", "inspiration", "just",
    "learn", "learned", "learning", "like", "lot", "lots", "llms", "llm",
    "main", "make", "makes", "making", "mit", "model", "models", "need",
    "needed", "new", "next", "one", "openai", "original", "people", "person",
    "plan", "plans", "platform", "problem", "problems", "process", "processing",
    "project", "prompt", "prompts", "really", "simple", "software", "solution",
    "solutions", "start", "started", "system", "systems", "team", "tech",
    "technologies", "technology", "thing", "things", "time", "tool", "tools",
    "tried", "trying", "two", "use", "used", "user", "users", "uses", "using",
    "want", "wanted", "wants", "way", "ways", "web", "website", "weekend",
    "work", "working", "gpt", "react", "python", "javascript", "typescript",
    "html", "css", "node", "npm", "git", "github", "backend", "frontend",
    "client", "server", "api", "apis", "output", "input",
}

EXTRA_STOP = BOILERPLATE | {
    "we", "our", "us", "they", "their", "hack", "hackmit", "blueprint",
}

MIN_WRITEUP_CHARS = 200
KNN_K = 10
MIN_COSINE = 0.14
SIGNATURE_K = 25
COMMON_DF_FRAC = 0.20  # terms in >20% of eligible docs cannot be signatures
RARE_DF_MAX = 15  # "rare" signature term
SVD_DIMS = 64
TOP_SPONSOR_COUNT = 5  # too popular to count as a reason-to-connect

# Weight mix. Track is intentionally absent.
W_COSINE = 0.72
W_SIGNATURE = 0.22
W_RARE_SPONSOR = 0.06


def writeup_of(p: dict) -> str:
    parts = []
    for k in WRITEUP_FIELDS:
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
    return "\n\n".join(parts)


def sponsor_names(p: dict) -> list[str]:
    names = p.get("sponsor_challenge_names") or []
    out = []
    for n in names:
        if isinstance(n, dict):
            n = n.get("name")
        n = (n or "").strip()
        if n and n not in TRACK_NAMES:
            out.append(n)
    return out


def tokenize_term_ok(term: str) -> bool:
    toks = term.split()
    if any(t in BOILERPLATE for t in toks):
        return False
    if all(len(t) <= 2 for t in toks):
        return False
    return True


def passes_evidence(inter: set[str], df: dict[str, int]) -> tuple[bool, str]:
    """Require specific shared language, not 'app/ai/users' overlap.

    Accept if:
      • ≥4 shared signature terms, or
      • ≥3 and at least one is rare (df≤15) or a bigram, or
      • ≥2 rare terms.
    """
    if not inter:
        return False, "no shared signature terms"
    rare = {t for t in inter if df.get(t, 10**9) <= RARE_DF_MAX}
    bigrams = {t for t in inter if " " in t}
    n = len(inter)
    if n >= 4:
        return True, f"{n} shared signature terms"
    if n >= 3 and (rare or bigrams):
        why = []
        if rare:
            why.append(f"{len(rare)} rare")
        if bigrams:
            why.append(f"{len(bigrams)} bigram")
        return True, f"{n} shared terms ({', '.join(why)})"
    if len(rare) >= 2:
        return True, f"{len(rare)} rare shared terms"
    return False, f"only {n} weak shared terms: {sorted(inter)[:6]}"


def edge_weight(cosine: float, n_shared: int, rare_sponsor_idf_sum: float) -> float:
    cos_n = float(np.clip((cosine - MIN_COSINE) / (0.45 - MIN_COSINE), 0, 1))
    sig_n = min(1.0, n_shared / 6.0)
    sp_n = min(1.0, rare_sponsor_idf_sum / 12.0) if rare_sponsor_idf_sum else 0.0
    return float(W_COSINE * cos_n + W_SIGNATURE * sig_n + W_RARE_SPONSOR * sp_n)


def embed_content_3d(lsa: np.ndarray) -> tuple[np.ndarray, str]:
    """UMAP preserves local writeup neighborhoods; PCA collapses them into a sausage.

    Measured on this corpus: 3D kNN overlap with TF-IDF neighbors is 0.31 (UMAP)
    vs 0.10 (PCA). Evidenced edges sit at 0.22× random distance (UMAP) vs 0.50× (PCA).
    """
    try:
        import umap

        xyz = umap.UMAP(
            n_components=3,
            n_neighbors=12,
            min_dist=0.2,
            metric="cosine",
            random_state=42,
        ).fit_transform(lsa)
        method = "umap-12-0.2 on 64d LSA (cosine)"
    except Exception:
        xyz = PCA(n_components=3, random_state=42).fit_transform(lsa)
        method = "pca fallback on 64d LSA"
    xyz = xyz - xyz.mean(axis=0)
    radii = np.linalg.norm(xyz, axis=1)
    xyz = xyz / (float(radii.max()) or 1.0)
    return xyz, method


def separate_points(xyz: np.ndarray, min_d: float = 0.05, iters: int = 6) -> np.ndarray:
    """Keep overlapping dots from stacking — readability, not a new similarity."""
    from sklearn.metrics.pairwise import euclidean_distances

    xyz = xyz.copy()
    n = len(xyz)
    for _ in range(iters):
        D = euclidean_distances(xyz)
        np.fill_diagonal(D, 99.0)
        for i in range(n):
            js = np.where(D[i] < min_d)[0]
            for j in js:
                if j <= i:
                    continue
                delta = xyz[i] - xyz[j]
                dist = float(np.linalg.norm(delta)) or 1e-6
                push = ((min_d - dist) * 0.45) * (delta / dist)
                xyz[i] += push
                xyz[j] -= push
    return xyz


def pull_along_edges(xyz: np.ndarray, pairs: list[tuple[int, int]], mix: float = 0.07) -> np.ndarray:
    """Tiny spring: evidenced pairs sit a bit closer without collapsing clusters."""
    xyz = xyz.copy()
    for a, b in pairs:
        mid = (xyz[a] + xyz[b]) * 0.5
        xyz[a] = (1 - mix) * xyz[a] + mix * mid
        xyz[b] = (1 - mix) * xyz[b] + mix * mid
    return xyz


GENERIC_TITLE = {
    "file", "files", "unique", "custom", "text", "browser", "preference",
    "demo", "amazing", "unfortunately", "supposed", "stuff", "broken",
    "attempt", "submitted", "world", "different", "content", "kwh",
    "tokens", "token", "usually", "imagine", "key", "ran", "key ran",
    "random", "random forest", "google veo", "veo", "instagram",
    "companies", "company",
}

ACRONYMS = {"eeg", "mcp", "sql", "pdf", "ai", "co2", "pdfs"}


def pretty_term(term: str) -> str:
    parts = []
    for tok in term.split():
        low = tok.lower()
        if low in ACRONYMS:
            parts.append(low.upper())
        elif low == "mentraos":
            parts.append("MentraOS")
        else:
            parts.append(tok.capitalize())
    return " ".join(parts)


def _fold_plurals(bag: Counter, df: Counter) -> None:
    for t in list(bag):
        if " " in t or len(t) < 5 or t.endswith("ss") or not t.endswith("s"):
            continue
        root = t[:-1]
        if bag[root] or df[root]:
            bag[root] += bag.pop(t)
            df[root] = df.get(root, 0) + df.pop(t, 0)


def island_label(members: np.ndarray, signatures: list[list[tuple[str, float]]]) -> str:
    bag: Counter[str] = Counter()
    df: Counter[str] = Counter()
    for i in members:
        seen: set[str] = set()
        for term, score in signatures[i][:10]:
            if term in GENERIC_TITLE or any(tok in GENERIC_TITLE for tok in term.split()):
                continue
            bag[term] += score
            if term not in seen:
                df[term] += 1
                seen.add(term)
    _fold_plurals(bag, df)
    min_df = 2 if len(members) >= 4 else 1
    ranked = [t for t, _ in bag.most_common(20) if df[t] >= min_df]
    if not ranked:
        ranked = [t for t, _ in bag.most_common(4)]
    if not ranked:
        return "Theme"
    # Prefer a shared bigram when it is not just a restatement of the top unigram.
    bigrams = [t for t in ranked if " " in t]
    unigrams = [t for t in ranked if " " not in t]
    if bigrams:
        primary = pretty_term(bigrams[0])
        extra = next((t for t in unigrams if t not in bigrams[0]), None)
        if extra:
            return f"{primary} / {pretty_term(extra)}"
        return primary
    if len(unigrams) >= 2:
        return f"{pretty_term(unigrams[0])} / {pretty_term(unigrams[1])}"
    return pretty_term(unigrams[0])


def theme_islands(
    tfidf,
    signatures: list[list[tuple[str, float]]],
    min_n: int = 5,
    distance_threshold: float = 0.88,
    min_intra: float = 0.14,
) -> tuple[np.ndarray, list[str | None]]:
    """Color only *tight* writeup islands, not a forced KMeans partition.

    Average-linkage on cosine distance. A cluster is shown only if it has
    ≥5 projects and mean pairwise cosine ≥ 0.14 (the same floor as an edge).
    Everything else stays unlabeled: nearby in UMAP is not a category.
    Empirically this yields ~18 islands (~150 projects) with intra 0.14–0.25
    vs background median 0.021. KMeans k=12 on UMAP produced a 61-project
    'study' blob at intra 0.037 — indistinguishable from random pairs.
    """
    n = tfidf.shape[0]
    S = cosine_similarity(tfidf)
    np.fill_diagonal(S, 0.0)
    D = np.clip(1.0 - S, 0.0, 2.0)
    np.fill_diagonal(D, 0.0)
    raw = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=distance_threshold,
    ).fit_predict(D)
    labels = np.full(n, -1, dtype=int)
    names: dict[int, str] = {}
    next_id = 0
    for c in sorted(set(int(x) for x in raw)):
        members = np.where(raw == c)[0]
        if len(members) < min_n:
            continue
        tri = S[np.ix_(members, members)][np.triu_indices(len(members), 1)]
        intra = float(tri.mean()) if tri.size else 0.0
        if intra < min_intra:
            continue
        labels[members] = next_id
        names[next_id] = island_label(members, signatures)
        next_id += 1
    pretty: list[str | None] = [names.get(int(lb)) if lb >= 0 else None for lb in labels]
    return labels, pretty


def spread_theme_islands(
    xyz: np.ndarray,
    labels: np.ndarray,
    min_centroid_d: float = 0.36,
    iters: int = 8,
) -> np.ndarray:
    """Push overlapping theme islands apart so a person can see where they stand.

    Same translation is applied to every member of an island, so intra-island
    UMAP structure is preserved. Mixed (unlabeled) points are not moved as a
    block — they are the leftover landscape.
    """
    xyz = xyz.copy()
    ids = [int(c) for c in np.unique(labels) if int(c) >= 0]
    if len(ids) < 2:
        return xyz
    members = [np.where(labels == c)[0] for c in ids]
    for _ in range(iters):
        cents = np.array([xyz[idx].mean(axis=0) for idx in members])
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                delta = cents[i] - cents[j]
                dist = float(np.linalg.norm(delta)) or 1e-6
                if dist >= min_centroid_d:
                    continue
                push = ((min_centroid_d - dist) * 0.4) * (delta / dist)
                xyz[members[i]] += push
                xyz[members[j]] -= push
    return xyz


def build(projects: list[dict]) -> dict:
    n_all = len(projects)
    writeups = [writeup_of(p) for p in projects]
    eligible_idx = [i for i, w in enumerate(writeups) if len(w) >= MIN_WRITEUP_CHARS]
    ineligible_idx = [i for i in range(n_all) if i not in set(eligible_idx)]

    texts = [writeups[i] for i in eligible_idx]
    stop = ENGLISH_STOP_WORDS.union(EXTRA_STOP)
    vec = TfidfVectorizer(
        max_features=12000,
        ngram_range=(1, 2),
        min_df=3,
        max_df=0.35,
        stop_words=list(stop),
        token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9_+\-]{2,}\b",
    )
    X = vec.fit_transform(texts)
    vocab = np.array(vec.get_feature_names_out())
    df_arr = np.asarray((X > 0).sum(axis=0)).ravel()
    n_el = X.shape[0]
    too_common = df_arr > COMMON_DF_FRAC * n_el
    df_map = {t: int(df_arr[i]) for i, t in enumerate(vocab)}

    def signature(row) -> list[tuple[str, float]]:
        idx = row.indices
        data = row.data
        keep = []
        for j, s in zip(idx, data):
            if too_common[j]:
                continue
            term = vocab[j]
            if not tokenize_term_ok(term):
                continue
            keep.append((term, float(s)))
        keep.sort(key=lambda x: -x[1])
        return keep[:SIGNATURE_K]

    sigs = [signature(X[i]) for i in range(n_el)]
    sigsets = [set(t for t, _ in s) for s in sigs]

    S = cosine_similarity(X)
    np.fill_diagonal(S, 0.0)

    nn = NearestNeighbors(n_neighbors=min(KNN_K + 1, n_el), metric="cosine", algorithm="brute")
    nn.fit(X)
    nn_idx = nn.kneighbors(X, return_distance=False)
    neighbors = [set(row[1:].tolist()) for row in nn_idx]

    # Sponsor IDF on the full corpus (popularity is a global fact).
    all_sponsors = [sponsor_names(p) for p in projects]
    sc = Counter(s for names in all_sponsors for s in names)
    sponsor_idf = {s: math.log((n_all + 1) / (c + 1)) + 1 for s, c in sc.items()}
    top_sponsors = {s for s, _ in sc.most_common(TOP_SPONSOR_COUNT)}

    edges = []
    rejected = Counter()
    for a in range(n_el):
        for b in neighbors[a]:
            if a >= b or a not in neighbors[b]:
                continue
            cos = float(S[a, b])
            if cos < MIN_COSINE:
                rejected["cosine_below_floor"] += 1
                continue
            inter = sigsets[a] & sigsets[b]
            ok, why = passes_evidence(inter, df_map)
            if not ok:
                rejected[why.split(":")[0]] += 1
                continue

            ia, ib = eligible_idx[a], eligible_idx[b]
            sa, sb = set(all_sponsors[ia]), set(all_sponsors[ib])
            shared_sp = sorted(sa & sb)
            rare_shared = [s for s in shared_sp if s not in top_sponsors]
            rare_idf = sum(sponsor_idf[s] for s in rare_shared)
            track_a = projects[ia].get("track")
            track_b = projects[ib].get("track")
            w = edge_weight(cos, len(inter), rare_idf)
            # Rank overlapping terms by min tf-idf in the two docs (actual shared mass).
            mass = {t: 0.0 for t in inter}
            sa_m = dict(sigs[a])
            sb_m = dict(sigs[b])
            for t in inter:
                mass[t] = min(sa_m.get(t, 0), sb_m.get(t, 0))
            shared_terms = [t for t, _ in sorted(mass.items(), key=lambda x: -x[1])]

            edges.append(
                {
                    "source": projects[ia]["project_id"],
                    "target": projects[ib]["project_id"],
                    "source_name": projects[ia]["project_name"],
                    "target_name": projects[ib]["project_name"],
                    "weight": round(w, 4),
                    "cosine": round(cos, 4),
                    "shared_terms": shared_terms[:10],
                    "n_shared_terms": len(inter),
                    "shared_rare_sponsors": rare_shared,
                    "shared_sponsors_ignored": [s for s in shared_sp if s in top_sponsors],
                    "same_track": bool(
                        track_a
                        and track_b
                        and track_a == track_b
                        and track_a not in (None, "NO TRACK")
                    ),
                    "evidence": why,
                }
            )

    edges.sort(key=lambda e: -e["weight"])

    # --- 3D: UMAP of LSA writeups (local neighborhoods). Thin records stay off-map.
    n_svd = min(SVD_DIMS, max(3, n_el - 1), max(3, X.shape[1] - 1))
    lsa = TruncatedSVD(n_components=n_svd, random_state=42).fit_transform(X)
    xyz_el, layout_name = embed_content_3d(lsa)
    edge_pairs = []
    id_to_local = {projects[eligible_idx[i]]["project_id"]: i for i in range(n_el)}
    for e in edges:
        if e["source"] in id_to_local and e["target"] in id_to_local:
            edge_pairs.append((id_to_local[e["source"]], id_to_local[e["target"]]))
    xyz_el = pull_along_edges(xyz_el, edge_pairs, mix=0.07)
    cluster_ids, cluster_names = theme_islands(X, sigs)
    xyz_el = spread_theme_islands(xyz_el, cluster_ids)
    xyz_el = xyz_el - xyz_el.mean(axis=0)
    radii = np.linalg.norm(xyz_el, axis=1)
    xyz_el = xyz_el / (float(radii.max()) or 1.0)
    xyz_el = separate_points(xyz_el, min_d=0.055, iters=6)

    coords = np.zeros((n_all, 3))
    confidence = ["none"] * n_all
    node_cluster = [None] * n_all
    node_cluster_label = [None] * n_all
    for local, gi in enumerate(eligible_idx):
        coords[gi] = xyz_el[local]
        confidence[gi] = "high" if len(writeups[gi]) >= 800 else "medium"
        cid = int(cluster_ids[local])
        node_cluster[gi] = cid if cid >= 0 else None
        node_cluster_label[gi] = cluster_names[local]

    # Thin records: not mixed into UMAP. Parked far out and hidden by default.
    if ineligible_idx:
        rng = np.random.RandomState(1)
        for li, gi in enumerate(ineligible_idx):
            v = rng.normal(size=3)
            v = v / (np.linalg.norm(v) or 1.0)
            coords[gi] = v * 2.4
            confidence[gi] = "low"

    degree = Counter()
    for e in edges:
        degree[e["source"]] += 1
        degree[e["target"]] += 1

    cluster_meta = []
    for c in sorted(set(int(x) for x in cluster_ids) - {-1}):
        members = [i for i, lb in enumerate(cluster_ids) if int(lb) == c]
        pts = xyz_el[members]
        cluster_meta.append(
            {
                "id": c,
                "label": cluster_names[members[0]],
                "size": len(members),
                "x": round(float(pts.mean(axis=0)[0]), 5),
                "y": round(float(pts.mean(axis=0)[1]), 5),
                "z": round(float(pts.mean(axis=0)[2]), 5),
            }
        )

    nodes = []
    for i, p in enumerate(projects):
        local = eligible_idx.index(i) if i in eligible_idx else None
        nodes.append(
            {
                "project_id": p["project_id"],
                "project_name": p["project_name"],
                "hackathon_id": p.get("hackathon_id"),
                "hackathon_name": p.get("hackathon_name"),
                "year": p.get("year"),
                "track": p.get("track"),
                "sponsor_challenges": all_sponsors[i],
                "rank": p.get("rank"),
                "score": p.get("score"),
                "is_winner": bool(p.get("is_winner")),
                "team_size": p.get("team_size"),
                "schools": p.get("schools") or [],
                "description": (p.get("description") or p.get("what_it_does") or "")[:400],
                "writeup_chars": len(writeups[i]),
                "confidence": confidence[i],
                "cluster_id": node_cluster[i],
                "cluster_label": node_cluster_label[i],
                "n_connections": int(degree[p["project_id"]]),
                "signature_terms": [t for t, _ in sigs[local][:12]] if local is not None else [],
                "x": round(float(coords[i, 0]), 5),
                "y": round(float(coords[i, 1]), 5),
                "z": round(float(coords[i, 2]), 5),
            }
        )

    # Degree / components on the high-rigor graph
    adj: dict[str, set] = {n["project_id"]: set() for n in nodes}
    for e in edges:
        adj[e["source"]].add(e["target"])
        adj[e["target"]].add(e["source"])
    seen: set[str] = set()
    components = 0
    isolated_eligible = 0
    for n in nodes:
        pid = n["project_id"]
        if n["confidence"] == "low":
            continue
        if pid in seen:
            continue
        if not adj[pid]:
            isolated_eligible += 1
            seen.add(pid)
            continue
        components += 1
        stack = [pid]
        seen.add(pid)
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)

    iu = np.triu_indices(n_el, 1)
    flat = S[iu]
    method = {
        "content": "tfidf unigram+bigram on writeup fields only (no track, no sponsor names)",
        "layout": layout_name + "; evidenced pairs lightly sprung; theme islands spread; overlapping dots separated",
        "themes": "average-linkage islands on writeup cosine (n≥5, intra≥0.14); unlabeled otherwise — not KMeans on the map",
        "edge_rule": {
            "mutual_knn_k": KNN_K,
            "min_cosine": MIN_COSINE,
            "min_writeup_chars": MIN_WRITEUP_CHARS,
            "evidence": "≥4 signature terms, or ≥3 with a rare/bigram term, or ≥2 rare terms",
            "track_in_edge_weight": False,
            "popular_sponsors_cannot_create_edges": list(top_sponsors),
            "weight": f"{W_COSINE}*scaled_cosine + {W_SIGNATURE}*signature_mass + {W_RARE_SPONSOR}*rare_sponsor_idf",
        },
        "corpus": {
            "projects": n_all,
            "content_eligible": n_el,
            "low_confidence": len(ineligible_idx),
            "edges": len(edges),
            "connected_components": components,
            "eligible_isolates": isolated_eligible,
            "theme_islands": len(cluster_meta),
            "theme_island_projects": sum(c["size"] for c in cluster_meta),
            "cosine_p50": round(float(np.median(flat)), 4),
            "cosine_p95": round(float(np.quantile(flat, 0.95)), 4),
            "cosine_p99": round(float(np.quantile(flat, 0.99)), 4),
            "rejected_mutual_pairs": dict(rejected),
        },
    }
    return {"method": method, "nodes": nodes, "edges": edges, "clusters": cluster_meta}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", type=Path, default=Path("data/projects.json"))
    ap.add_argument("--out-dir", type=Path, default=Path("data"))
    ap.add_argument(
        "--copy-public",
        type=Path,
        default=None,
        help="Also write graph.json into a frontend public/ folder",
    )
    ap.add_argument(
        "--elastic",
        action="store_true",
        help="Upsert the map snapshot to Elasticsearch (also runs if ELASTIC_URL is set)",
    )
    ap.add_argument(
        "--no-elastic",
        action="store_true",
        help="Skip Elasticsearch even if ELASTIC_URL is set",
    )
    args = ap.parse_args()
    here = Path(__file__).resolve().parent
    infile = args.infile if args.infile.is_absolute() else here / args.infile
    out_dir = args.out_dir if args.out_dir.is_absolute() else here / args.out_dir

    projects = json.loads(infile.read_text())["projects"]
    print(f"Loaded {len(projects)} projects", flush=True)
    graph = build(projects)
    print("Graph built", flush=True)
    graph["built_at"] = datetime.now(timezone.utc).isoformat()
    graph["count_nodes"] = len(graph["nodes"])
    graph["count_edges"] = len(graph["edges"])

    out_dir.mkdir(parents=True, exist_ok=True)
    graph_path = out_dir / "graph.json"
    graph_path.write_text(json.dumps(graph, ensure_ascii=False) + "\n")

    # Compact coords file for the 3D client.
    coords = {
        "built_at": graph["built_at"],
        "method": graph["method"],
        "count": len(graph["nodes"]),
        "points": [
            {
                "project_id": n["project_id"],
                "project_name": n["project_name"],
                "hackathon_id": n["hackathon_id"],
                "track": n["track"],
                "confidence": n["confidence"],
                "rank": n["rank"],
                "score": n.get("score"),
                "team_size": n["team_size"],
                "schools": n.get("schools") or [],
                "is_winner": n["is_winner"],
                "description": n["description"],
                "signature_terms": n["signature_terms"],
                "sponsor_challenges": n["sponsor_challenges"],
                "cluster_id": n.get("cluster_id"),
                "cluster_label": n.get("cluster_label"),
                "n_connections": n.get("n_connections", 0),
                "x": n["x"],
                "y": n["y"],
                "z": n["z"],
            }
            for n in graph["nodes"]
        ],
        "clusters": graph.get("clusters") or [],
        "edges": [
            {
                "source": e["source"],
                "target": e["target"],
                "weight": e["weight"],
                "cosine": e["cosine"],
                "shared_terms": e["shared_terms"],
                "evidence": e["evidence"],
                "same_track": e["same_track"],
            }
            for e in graph["edges"]
        ],
    }
    coords_path = out_dir / "coords.json"
    coords_path.write_text(json.dumps(coords, ensure_ascii=False) + "\n")

    m = graph["method"]["corpus"]
    print(f"eligible {m['content_eligible']}/{m['projects']}  edges {m['edges']}  "
          f"components {m['connected_components']}  isolates {m['eligible_isolates']}")
    print(f"theme islands {m.get('theme_islands')} covering {m.get('theme_island_projects')} projects")
    for c in graph.get("clusters") or []:
        print(f"  {c['size']:3}  {c['label']}")
    print(f"Wrote {graph_path}")
    print(f"Wrote {coords_path}")
    if graph["edges"]:
        print("Top edges:")
        for e in graph["edges"][:8]:
            print(f"  {e['weight']:.3f} cos={e['cosine']:.3f}  {e['source_name'][:28]:28} — {e['target_name'][:28]:28}  {e['shared_terms'][:5]}")

    if args.copy_public:
        dest_dir = args.copy_public if args.copy_public.is_absolute() else here / args.copy_public
        dest_dir.mkdir(parents=True, exist_ok=True)
        (dest_dir / "graph.json").write_text(graph_path.read_text())
        (dest_dir / "coords.json").write_text(coords_path.read_text())
        print(f"Copied into {dest_dir}")

    from dotenv import load_dotenv

    load_dotenv(here / ".env")
    if (args.elastic or os.environ.get("ELASTIC_URL")) and not args.no_elastic:
        from elastic_map import upload_coords

        upload_coords(coords)


if __name__ == "__main__":
    main()
