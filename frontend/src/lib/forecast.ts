export type Neighbor = {
  project_id: string;
  project_name: string;
  track: string;
  rank: number;
  place: number;
  track_size: number;
  score: number | null;
  cosine?: number;
  writeup_chars?: number;
};

export type ForecastRow = {
  project_id: string;
  project_name: string;
  hackathon_id: string;
  listed_track: string;
  predicted_track: string | null;
  track_confidence: number;
  team_size: number | null;
  schools: string[];
  sponsor_challenges: string[];
  writeup_chars: number;
  n_writeup_fields: number;
  has_code_link: boolean;
  has_video: boolean;
  description: string;
  confidence: "high" | "medium" | "low" | "none";
  analogue_percentile: number | null;
  analogue_percentile_lo: number | null;
  analogue_percentile_hi: number | null;
  finalist_likeness: number | null;
  finalist_likeness_lo: number | null;
  finalist_likeness_hi: number | null;
  top3_likeness: number | null;
  model_percentile: number | null;
  mean_neighbor_cosine: number | null;
  neighbors: Neighbor[];
  reasons: string[];
};

export type ModelCard = {
  label: string;
  validation: string;
  random: Metrics;
  log_writeup_chars: Metrics;
  cv_analogue_knn: Metrics;
  cv_finalist_likeness: Metrics;
  cv_ridge_lsa: Metrics;
  read: string;
  corpus: Record<string, unknown>;
  caveats: string[];
};

export type Metrics = {
  spearman_vs_percentile: number | null;
  mean_track_ndcg10: number | null;
  mean_track_spearman: number | null;
  mean_track_top10_overlap: number | null;
  n_tracks_eval: number;
};

export type ForecastFile = {
  built_at: string;
  scraped_at?: string;
  model_card: ModelCard;
  hack2026: ForecastRow[];
  by_track: Record<string, string[]>;
  judged_2025: Array<{
    project_id: string;
    project_name: string;
    track: string;
    rank: number;
    place: number;
    track_size: number;
    score: number | null;
    percentile: number;
    team_size: number | null;
    writeup_chars: number;
    description: string;
  }>;
};

export function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}`;
}

export function placeLine(n: Neighbor) {
  return `${n.place} of ${n.track_size} in ${n.track}`;
}
