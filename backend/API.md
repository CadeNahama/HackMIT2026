# Plume API notes

Everything learned about `https://plume.hackmit.org/api/v3` while building the sync.
Recorded 2026-09-19 (day 1 of HackMIT 2026); the private list is inferred, the public
list is verified.

**Stack:** Flask backend (Flask-JWT-Extended auth), Vite/React frontend using
`openapi-fetch`. No published spec — `/docs`, `/redoc`, `/openapi.json` return the SPA
shell or 404 — and the repo isn't public. The route list below came from grepping
`/api/v3/…` strings out of the frontend bundle (`/assets/index-*.js`), which is
generated from their OpenAPI spec and so is complete: 128 routes.

## Public (no auth) — verified 200

### `GET /projects/gallery`
The only endpoint the sync uses. Params: `hackathon_id`, `page` (1-based),
`items_per_page` (site uses 24), `search`, `track` (repeatable), `preference`
(repeatable), `winners_only=true`. Paginate until `projects` is `[]`.

Returns `{ total_projects, preferences: [challenge names], projects: [...] }`. Each project:

| field | notes |
|---|---|
| `id` | `pr-…` stable internal id — our upsert key |
| `magic_link` | `xxxxx-xxxxx-xxxxx-xxxxx`, slug in `plume.hackmit.org/project/{magic_link}` |
| `name` | |
| `hackathon_id` | `hack-2026` |
| `track` | all `NO TRACK` on day 1; 2025 values were Education / Beginner / Entertainment / General / Healthcare / Sustainability |
| `preferences[]` | sponsor challenges entered |
| `prize_winners[]` | empty until judging; the hook for post-ceremony analysis |
| `table_location` | `TBD` → `Table N` |
| `judging_table_label`, `needs_power`, `join_link` | minor |
| `project_metadata` | **JSON string** — parse it |

Inside `project_metadata`: `description`, `what_it_does`, `inspiration`, `how_we_built_it`,
`individual_contributions`, `challenges_we_ran_into`, `accomplishments`, `what_we_learned`,
`whats_next`, `code_link`, `links`, `video_demo`, `sponsorChallenges[]`,
`project_image_key`, `hide_emails`, `omitted_fields{}`.

No people data. Serves past years too: `hack-2025` is fully populated (319 projects,
tracks, tables, descriptions); `hack-2024` has 0 projects (pre-Plume).

### `GET /projects/get_id/{magic_link}` → `{ "id": "pr-…" }`
Slug → id; how `/project/{slug}` pages resolve.

### `GET /projects/{pr-id}`
Full record (camelCase) plus `categories[]` with ids and **`hackers[]`**. Names and
emails are blanked, but each member's `organization`, `status` (CHECKED_IN),
`travelStatus`, `travelSubmitted`, `finaid`, docusign flags, `tshirtSize` and a stable
`userId` come through unauthenticated. That's registration data, not gallery data —
**don't scrape or store it.** Worth reporting to the organizers.

### `GET /hackathons/{id}/challenges/{ca-id}/projects`
Projects in one challenge, same full-record shape as above including `hackers[]`. Same
caveat. Redundant with `preferences[]` on the gallery.

### `GET /hackathons`
`hack-2024`, `bp-2025`, `hack-2025`, `bp-2026`, `hack-2026`.

### `GET /hackathons/metadata`
Per event `numProjects` / `numUserHackathonRoles` (roles = hackers + mentors + judges +
sponsors). hack-2025: 319 / 5,141. hack-2026 on day 1: 165 (120 published) / 5,455.

### `GET /hackathons/{id}/categories` and `…/challenges`
Aliases; 23 `{ id: "ca-…", name }` sponsor challenges. No descriptions or amounts.

### `GET /hackathons/{id}/tracks`
`[]` for hack-2026 as of day 1.

## Private — 401 `MissingToken`

| group | routes | role |
|---|---|---|
| `projects/prizes`, `prizes/bulk`, `prizes/{id}` | 4 | organizer |
| `schedule/state` + `start/pause/resume/extend/end/reset/configure` | 9 | organizer (judging clock) |
| `schedule/judge/{magic_link}/next\|compare\|skip\|place\|compare/undo` | 5 | judge, via magic link |
| `schedule/comparisons`, `stats`, `ranking/rankings`, `export/rankings` | 4 | organizer |
| `schedule/offline/*` | 4 | organizer (manual fallback) |
| `table-assignment/*` | 10 | organizer |
| `projects/admin/list`, `projects/sponsor/*`, `projects/{id}/edit\|join\|leave\|image*` | 9 | organizer / sponsor / hacker |
| `profiles/*` (me, hacker/{id}, search, schools, interests) | 14 | hacker |
| `forms/*`, `auth/*`, `oauth/*`, `timing/*`, `user/*` | 59 | applications, login, admin |

Directly tested: `schedule/stats`, `projects/prizes`. The rest are inferred from naming
and from which page component calls them.

What the private routes reveal structurally: judging is **pairwise comparison** — a
judge gets two projects and picks one (`/next` polled every 5 s), the frontend computes
`comparisonsLeft = floor(log2(n)) + 1` (binary-insertion ranking), and
`ranking/rankings` + `export/rankings?cutoff=` aggregate and export the top N at the end.
Results reach the public side only through `prize_winners[]` on the gallery.

## How auth works (why curl gets 401)

Login (`POST /auth/login`) returns a JWT — `{ sub, roles, exp, … }` signed with a
server-side secret — as an HttpOnly cookie. Protected routes run `@jwt_required()`:

| you send | server says |
|---|---|
| nothing | 401 — no token in header or cookie |
| a hacker token | 403 on organizer routes — known user, wrong role |
| an organizer/judge token | 200 |

Roles are baked into the token from the database at login and protected by the
signature, so they can't be edited client-side.

## Historical winners

Plume has **no 2025 winner data**: `prize_winners` is empty on all 319 projects and
`winners_only=true` returns 0. HackMIT publishes no winners page. From press coverage,
cross-checked against the 2025 gallery:

| project | prize | plume |
|---|---|---|
| Griddy | Sustainability track | Table 60 |
| eyecraft | Entertainment track | Table 112 |
| Kava | EigenCloud sponsor prize | Table 77 |

## Implications for this project

1. `sync.py` uses only `projects/gallery` — complete for our schema, zero PII, 5 requests.
2. Re-run after Sunday's ceremony to pick up `prize_winners` and `track`.
3. `hack-2025` is a ready-made baseline dataset if we ever want year-over-year.
