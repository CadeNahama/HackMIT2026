import { elasticConfigured } from "@/lib/elastic";
import type { ForecastFile } from "@/lib/forecast";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Hit = {
  project_id: string;
  project_name: string;
  track: string;
  rank: number | null;
  score: number | null;
  description: string;
  writeup: string;
  team_size: number | null;
  es_score: number;
};

async function loadForecast(): Promise<ForecastFile> {
  const file = path.join(process.cwd(), "public/forecast/forecast.json");
  return JSON.parse(await readFile(file, "utf8")) as ForecastFile;
}

function tokenize(s: string) {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n / Math.max(1, a.size + b.size - n);
}

async function elasticNeighbors(text: string): Promise<Hit[]> {
  const url = (process.env.ELASTIC_URL || "").replace(/\/$/, "");
  const key = process.env.ELASTIC_API_KEY || "";
  const index = process.env.ELASTIC_INDEX || "hackmit-map";
  const res = await fetch(`${url}/${encodeURIComponent(index)}/_search`, {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      size: 16,
      query: {
        bool: {
          filter: [
            { term: { kind: "point" } },
            { term: { hackathon_id: "hack-2025" } },
            { exists: { field: "rank" } },
          ],
          must: [
            {
              multi_match: {
                query: text,
                fields: ["writeup^3", "description^2", "project_name", "signature_terms"],
              },
            },
          ],
        },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Elasticsearch ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    hits?: { hits?: Array<{ _score?: number; _source?: Record<string, unknown> }> };
  };
  return (json.hits?.hits || []).map((h) => {
    const s = h._source || {};
    return {
      project_id: String(s.project_id || ""),
      project_name: String(s.project_name || ""),
      track: String(s.track || "NO TRACK"),
      rank: typeof s.rank === "number" ? s.rank : null,
      score: typeof s.score === "number" ? s.score : null,
      description: String(s.description || ""),
      writeup: String(s.writeup || s.description || ""),
      team_size: typeof s.team_size === "number" ? s.team_size : null,
      es_score: h._score || 0,
    };
  });
}

function fileNeighbors(text: string, forecast: ForecastFile): Hit[] {
  const q = tokenize(text);
  return forecast.judged_2025
    .map((j) => ({
      project_id: j.project_id,
      project_name: j.project_name,
      track: j.track,
      rank: j.rank,
      score: j.score,
      description: j.description,
      writeup: j.description,
      team_size: j.team_size,
      es_score: jaccard(q, tokenize(j.description + " " + j.project_name)),
    }))
    .filter((h) => h.es_score > 0)
    .sort((a, b) => b.es_score - a.es_score)
    .slice(0, 16);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    description?: string;
    track?: string;
  };
  const text = (body.description || "").trim();
  if (text.length < 40) {
    return Response.json(
      { error: "Need at least ~40 characters of project description." },
      { status: 400 }
    );
  }

  const forecast = await loadForecast();
  const sizes: Record<string, number> = {};
  for (const j of forecast.judged_2025) sizes[j.track] = j.track_size;

  let hits: Hit[] = [];
  let source: "elasticsearch" | "file" = "file";
  if (elasticConfigured()) {
    try {
      hits = await elasticNeighbors(text);
      source = "elasticsearch";
    } catch {
      hits = fileNeighbors(text, forecast);
      source = "file";
    }
  } else {
    hits = fileNeighbors(text, forecast);
  }

  const usable = hits.filter((h) => h.rank != null && h.track && h.track !== "NO TRACK");
  const weights = usable.map((h) => h.es_score || 0.001);
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const percentileOf = (h: Hit) => {
    const n = sizes[h.track] || 30;
    return 1 - (h.rank as number) / Math.max(n - 1, 1);
  };
  const analogue =
    usable.length === 0
      ? null
      : usable.reduce((s, h, i) => s + percentileOf(h) * weights[i], 0) / wsum;
  const finalist =
    usable.length === 0
      ? null
      : usable.reduce((s, h, i) => s + ((h.rank as number) < 10 ? 1 : 0) * weights[i], 0) /
        wsum;
  const trackVotes: Record<string, number> = {};
  for (const h of usable) {
    trackVotes[h.track] = (trackVotes[h.track] || 0) + (h.es_score || 1);
  }
  const predictedTrack =
    (body.track && body.track !== "NO TRACK" && body.track) ||
    Object.entries(trackVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    null;

  const neighbors = usable.slice(0, 10).map((h) => ({
    project_id: h.project_id,
    project_name: h.project_name,
    track: h.track,
    rank: h.rank as number,
    place: (h.rank as number) + 1,
    track_size: sizes[h.track] || 0,
    score: h.score,
    cosine: h.es_score,
    snippet: (h.writeup || h.description || "").slice(0, 220),
  }));

  const reasons: string[] = [];
  if (text.length < 200) {
    reasons.push("Short prompt — analogue placement will be noisy. Paste a real writeup if you have one.");
  }
  if (predictedTrack) {
    reasons.push(`Judged 2025 neighbors concentrate in ${predictedTrack}.`);
  }
  if (analogue != null) {
    reasons.push(
      `Similarity-weighted analogue percentile ${analogue.toFixed(2)} (1.00 = first in a 2025 track). This is case-matching, not a promised rank.`
    );
  }
  if (finalist != null) {
    reasons.push(
      `Finalist-likeness ${finalist.toFixed(2)}: share of retrieved 2025 neighbors who finished top-10 in their track.`
    );
  }
  if (neighbors[0]) {
    reasons.push(
      `Closest judged analogue: ${neighbors[0].project_name} (${neighbors[0].place} of ${neighbors[0].track_size} in ${neighbors[0].track}).`
    );
  }
  reasons.push(
    "Held-out HackMIT 2025: a writeup ridge model only lifts NDCG@10 from 0.51 (chance) to 0.59. Public text is a weak rank signal; the neighbors are the useful object."
  );

  return Response.json({
    source,
    predicted_track: predictedTrack,
    analogue_percentile: analogue == null ? null : Math.round(analogue * 1000) / 1000,
    finalist_likeness: finalist == null ? null : Math.round(finalist * 1000) / 1000,
    n_neighbors: neighbors.length,
    neighbors,
    reasons,
    model_card: forecast.model_card,
  });
}
