# What we pull from Plume

Two **public, unauthenticated** endpoints:

1. `GET /api/v3/projects/gallery` — paginated discovery
2. `GET /api/v3/projects/{id}` — full project record (this is the AuraTune-shaped payload)

## Stored per project

| Field | Source | Notes |
|---|---|---|
| writeup (description, what_it_does, inspiration, how we built it, …) | metadata | |
| `track`, `categories[]` `{id,name}` | gallery + detail | track vs sponsor prize |
| `sponsor_challenges[]` `{id,name}` | detail | prizes they **applied to** |
| `prize_winners`, `is_winner` | both | filled after ceremony |
| **`rank`, `score`** | detail | pairwise judging output. Present for **hack-2025**. Null for live **hack-2026** until results land — that's the prediction target. |
| `team_size` | `hackers[]` length | |
| `schools[]`, `n_schools` | each hacker's `organization` | |
| `members[]` | hackers | `first_name`, `last_name`, `organization`, `role`, `status`, ids. Names are often **blank unless the request is logged-in**; orgs still come through unauthenticated. |

## Dropped on purpose

These ride along on the public detail payload but are **registration/ops**, not project features. We never write them:

`finaid`, `travelStatus`, `travelSubmitted`, `travelDenialReasons`, `liabilityDocusignCompleted`, `mediaDocusignCompleted`, `tshirtSize`, `email` (blanked anyway).

## How this feeds the Palantir-style stack

| Layer | File | Role |
|---|---|---|
| Raw lake | `data/projects.json` | every project as an entity, with members / schools / challenges |
| Feature table | `data/features.json` | flat rows for a rank/winner model |
| Embedding space | `data/coords.json` | 3D similarity map |
| Labels | `rank` / `score` / `is_winner` on **hack-2025** (+ bp-2026 prize_winners) | train |
| Predict | **hack-2026** rows with null rank | score live projects |

Suggested model features (already in `features.json`): team size, number of schools, number of sponsor challenges, writeup length, has code/video, track, plus the text embedding. Label = `rank` or `is_winner`.
