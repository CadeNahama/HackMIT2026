"""Turn scraped project text into 3D coordinates for a similarity map.

Pipeline:
  1. TF-IDF over embed_text (description + build story + track + challenges)
  2. Truncated SVD → 50 dims (topic space)
  3. PCA → 3 dims (x, y, z for the browser)

No API keys required. Swap TF-IDF for real embeddings later if you want.

  python sync.py --out data/projects.json --no-supabase
  python embed_coords.py --in data/projects.json --out data/coords.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sklearn.decomposition import PCA, TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", type=Path, default=Path("data/projects.json"))
    ap.add_argument("--out", type=Path, default=Path("data/coords.json"))
    ap.add_argument("--svd-dims", type=int, default=50)
    args = ap.parse_args()

    here = Path(__file__).resolve().parent
    infile = args.infile if args.infile.is_absolute() else here / args.infile
    outfile = args.out if args.out.is_absolute() else here / args.out

    payload = json.loads(infile.read_text())
    projects = payload["projects"]
    if len(projects) < 3:
        raise SystemExit("Need at least 3 projects to build a 3D map.")

    texts = [(p.get("embed_text") or p.get("project_name") or "").strip() or " " for p in projects]

    # 1–2 char tokens are noise; keep unigrams + bigrams for challenge/track phrases.
    tfidf = TfidfVectorizer(
        max_features=8000,
        ngram_range=(1, 2),
        min_df=2,
        stop_words="english",
    )
    X = tfidf.fit_transform(texts)

    n_svd = min(args.svd_dims, X.shape[0] - 1, X.shape[1] - 1)
    if n_svd < 3:
        raise SystemExit(f"Not enough signal for SVD (got n_svd={n_svd}).")

    mid = TruncatedSVD(n_components=n_svd, random_state=42).fit_transform(X)
    xyz = PCA(n_components=3, random_state=42).fit_transform(mid)

    # Normalize to roughly [-1, 1] so Three.js camera framing is easy.
    for axis in range(3):
        col = xyz[:, axis]
        m = max(abs(col.min()), abs(col.max()), 1e-9)
        xyz[:, axis] = col / m

    points = []
    for p, (x, y, z) in zip(projects, xyz):
        points.append(
            {
                "project_id": p["project_id"],
                "project_name": p["project_name"],
                "hackathon_id": p["hackathon_id"],
                "hackathon_name": p.get("hackathon_name"),
                "year": p.get("year"),
                "track": p.get("track"),
                "sponsor_challenges": p.get("sponsor_challenge_names")
                or p.get("sponsor_challenges")
                or [],
                "is_winner": bool(p.get("is_winner")),
                "prize_winners": p.get("prize_winners") or [],
                "rank": p.get("rank"),
                "score": p.get("score"),
                "team_size": p.get("team_size"),
                "schools": p.get("schools") or [],
                "description": (p.get("description") or "")[:280],
                "x": float(x),
                "y": float(y),
                "z": float(z),
            }
        )

    out = {
        "method": "tfidf → truncated_svd → pca",
        "svd_dims": n_svd,
        "count": len(points),
        "points": points,
    }
    outfile.parent.mkdir(parents=True, exist_ok=True)
    outfile.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(points)} points → {outfile}")


if __name__ == "__main__":
    main()
