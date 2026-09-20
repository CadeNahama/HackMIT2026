# Similarity method (why these weights)

This is the contract for `similarity.py`. Numbers are from the 660-project
Plume scrape, content-eligible = writeup ≥ 200 chars (**425** projects,
**90,100** eligible pairs). Representation: TF-IDF unigrams+bigrams on
writeup fields **only** — description, what_it_does, inspiration,
how_we_built_it, challenges, accomplishments. Track names and sponsor
challenge titles are **not** in the text vector, so they cannot inflate
cosine.

## What did *not* earn a connection

| Candidate signal | Mean cosine | vs baseline | Verdict |
|---|---|---|---|
| All pairs | 0.042 | — | background |
| Same track | 0.051 | +0.009 | Real but tiny. 1-NN is same-track 35% vs 17% random — a *color*, not an edge. Beginner×Beginner = 1,891 pairs. |
| Different track | 0.042 | 0 | |
| Share **only** a top-5 sponsor (Anthropic, Windsurf, Rox, YC, Cerebras) | 0.052 | +0.010 | Same weakness as track. Anthropic is on 144 projects. |
| Share a **rare** (non-top-5) sponsor | 0.074 | +0.032 | Modest. 23% of these pairs exceed global p95 vs 4.6% of different-track pairs. Supporting evidence only. |
| Share no sponsor | 0.038 | −0.004 | |
| corr(cosine, sponsor Jaccard \| share≥1) | 0.18 | — | Tags are not a proxy for writeup similarity. |

**Track is never in the edge weight.** Putting it there would draw a complete
subgraph inside each track and drown the actual “two clinical knowledge-graph
projects” connections.

**Popular sponsor tags cannot create edges.** They may appear on an edge as
`shared_sponsors_ignored` for honesty, but they add 0 to `weight`.

## What *does* create an edge

All four must hold:

1. Both writeups ≥ 200 characters (hack-2026 is 88% below this; those nodes sit in a low-confidence halo with **no edges**).
2. Mutual 10-NN in TF-IDF cosine (each project is among the other’s 10 nearest).
3. cosine ≥ 0.14 (≈ corpus p98; random pair p50 is 0.036).
4. **Signature evidence** — each project has a 25-term signature (highest TF-IDF terms after dropping boilerplate and terms in >20% of docs). Shared signatures must be specific:
   - ≥ 4 shared terms, **or**
   - ≥ 3 and at least one is rare (df ≤ 15) or a bigram, **or**
   - ≥ 2 rare terms.

This is what stops “every game-shaped writeup” from linking on `{game, fun, inspired}`.

## Weight (only after an edge exists)

```
weight = 0.72 * scale(cosine, 0.14→0.45)
       + 0.22 * min(1, n_shared_signature_terms / 6)
       + 0.06 * min(1, Σ IDF(rare shared sponsors) / 12)
```

Cosine dominates because it is the only channel that actually measures
what the team wrote. Signature mass is the interpretability constraint.
Rare-sponsor IDF is a 6% tie-breaker (Mentra+Suno is evidence; Anthropic is not).

## 3D layout

Eligible writeups: TF-IDF → 64-d truncated SVD → **UMAP 3D** (`n_neighbors=12`, `min_dist=0.2`, cosine). PCA is a fallback only — on this corpus 3D kNN overlap with TF-IDF neighbors is ~0.44 (UMAP) vs ~0.17 (PCA), and evidenced edges sit at 0.22× random distance (UMAP) vs ~0.50× (PCA).

Thin records: parked on a sphere of radius 2.4 and **hidden by default** so they cannot warp the content map.

**Color is not a forced partition of the cloud.** Average-linkage clustering on writeup cosine (distance cut 0.88) keeps an island only if it has ≥5 projects *and* mean pairwise cosine ≥ 0.14. That is the same specificity floor as an edge. About 18 islands (~150 projects) pass; intra-cosine 0.14–0.25 vs background median 0.021. The rest stay unlabeled (gray): nearby in UMAP is a neighborhood, not a category. KMeans k=12 on the map produced a 61-project “study” blob at intra 0.037 — indistinguishable from a random pair — so it is not used.

Island groups are translated as a rigid set so overlapping themes do not sit on top of each other. Intra-island UMAP structure is preserved.

The landscape is content. The **lines** are the rigorous object. Two projects can sit near each other in 3D (similar bag-of-words) without a line if they failed the evidence rule — that is intentional.

## Examples the rule keeps

| Pair | Why |
|---|---|
| EcoGen — Green Roast | `carbon`, `carbon footprint`, `energy` |
| Heaven's Kitchen — Verde / SafeBites | `dietary restrictions`, `recipe`, `ingredients` |
| 0-Chrono — Solyd | `clinical`, `knowledge graph`, `patient` |
| LaTalk — blue | `mentra glasses`, `note taking`, `speech` |
| Nothole — Track Stars | `ultrasonic sensor`, `arduino`, `accelerometer` |
