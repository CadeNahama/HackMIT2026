-- Run in the Supabase SQL editor if you want the gallery table for this pipeline.
-- Local JSON (data/projects.json) works without Supabase.

create table if not exists public.gallery (
  project_id text primary key,
  magic_link text,
  project_name text not null,
  hackathon_id text,
  hackathon_name text,
  year int,
  track text,
  categories jsonb not null default '[]'::jsonb,
  category_names jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '[]'::jsonb,
  sponsor_challenges jsonb not null default '[]'::jsonb,
  sponsor_challenge_names jsonb not null default '[]'::jsonb,
  prize_winners jsonb not null default '[]'::jsonb,
  is_winner boolean not null default false,
  rank int,
  score double precision,
  team_size int,
  schools jsonb not null default '[]'::jsonb,
  n_schools int,
  members jsonb not null default '[]'::jsonb,
  description text,
  what_it_does text,
  inspiration text,
  how_we_built_it text,
  challenges_we_ran_into text,
  accomplishments text,
  what_we_learned text,
  whats_next text,
  code_link text,
  video_demo text,
  links jsonb not null default '[]'::jsonb,
  table_location text,
  needs_power boolean not null default false,
  embed_text text,
  metadata jsonb not null default '{}'::jsonb,
  last_updated timestamptz
);

create index if not exists gallery_hackathon_id_idx on public.gallery (hackathon_id);
create index if not exists gallery_track_idx on public.gallery (track);
create index if not exists gallery_year_idx on public.gallery (year);
create index if not exists gallery_rank_idx on public.gallery (hackathon_id, rank);

-- Optional: allow the Next.js anon key to read for the 3D map.
-- alter table public.gallery enable row level security;
-- create policy "anon read gallery" on public.gallery for select to anon using (true);
