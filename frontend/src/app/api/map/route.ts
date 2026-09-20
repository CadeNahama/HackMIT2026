import { readFile } from "node:fs/promises";
import path from "node:path";
import { elasticConfigured, searchMapIndex } from "@/lib/elastic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fromFile() {
  const file = path.join(process.cwd(), "public/map/coords.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as {
    points: unknown[];
    edges: unknown[];
    clusters?: unknown[];
  };
  return {
    points: raw.points,
    edges: raw.edges,
    clusters: raw.clusters || [],
    source: "file" as const,
  };
}

export async function GET() {
  if (elasticConfigured()) {
    try {
      const payload = await searchMapIndex();
      return Response.json(
        { ...payload, source: "elasticsearch" },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message, source: "elasticsearch" }, { status: 502 });
    }
  }

  try {
    return Response.json(await fromFile(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
