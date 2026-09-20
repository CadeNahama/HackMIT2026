const POINT_FIELDS = [
  "project_id",
  "project_name",
  "hackathon_id",
  "track",
  "confidence",
  "rank",
  "score",
  "team_size",
  "schools",
  "is_winner",
  "description",
  "signature_terms",
  "sponsor_challenges",
  "cluster_id",
  "cluster_label",
  "n_connections",
  "x",
  "y",
  "z",
] as const;

const EDGE_FIELDS = [
  "source",
  "target",
  "weight",
  "cosine",
  "shared_terms",
  "evidence",
  "same_track",
] as const;

const CLUSTER_FIELDS = ["id", "label", "size", "x", "y", "z"] as const;

type Doc = Record<string, unknown>;

function pick<T extends readonly string[]>(doc: Doc, keys: T) {
  const out: Doc = {};
  for (const k of keys) {
    if (k in doc) out[k] = doc[k];
  }
  return out;
}

export function elasticConfigured() {
  return Boolean(process.env.ELASTIC_URL && process.env.ELASTIC_API_KEY);
}

export async function searchMapIndex() {
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
      size: 2500,
      query: { match_all: {} },
      track_total_hits: false,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Elasticsearch ${res.status}: ${text.slice(0, 400)}`);
  }

  const body = (await res.json()) as {
    hits?: { hits?: Array<{ _source?: Doc }> };
  };
  const hits = body.hits?.hits || [];
  const points: Doc[] = [];
  const edges: Doc[] = [];
  const clusters: Doc[] = [];

  for (const hit of hits) {
    const src = hit._source || {};
    if (src.kind === "point") points.push(pick(src, POINT_FIELDS));
    else if (src.kind === "edge") edges.push(pick(src, EDGE_FIELDS));
    else if (src.kind === "cluster") clusters.push(pick(src, CLUSTER_FIELDS));
  }

  if (points.length === 0) {
    throw new Error("Elasticsearch index has no map points — run python elastic_map.py");
  }

  return { points, edges, clusters };
}
