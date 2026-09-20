"use client";

import AppNav from "@/components/AppNav";
import { placeLine } from "@/lib/forecast";
import { useState } from "react";

type MatchResponse = {
  error?: string;
  source?: string;
  predicted_track?: string | null;
  analogue_percentile?: number | null;
  finalist_likeness?: number | null;
  n_neighbors?: number;
  neighbors?: Array<{
    project_id: string;
    project_name: string;
    track: string;
    rank: number;
    place: number;
    track_size: number;
    score: number | null;
    cosine?: number;
    snippet?: string;
  }>;
  reasons?: string[];
};

const TRACKS = ["", "Beginner", "General", "Education", "Entertainment", "Healthcare", "Sustainability"];

export default function MatchPage() {
  const [description, setDescription] = useState("");
  const [track, setTrack] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatchResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, track: track || undefined }),
      });
      const j = (await r.json()) as MatchResponse;
      if (!r.ok) setResult({ error: j.error || `HTTP ${r.status}` });
      else setResult(j);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#07080c] text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#07080c]/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">Try a writeup</h1>
            <p className="text-[11px] text-neutral-500">
              Match against judged HackMIT 2025 — retrieval in Elasticsearch.
            </p>
          </div>
          <AppNav current="match" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <p className="text-sm leading-relaxed text-neutral-400">
          Paste what you are building. We retrieve the nearest <em>judged</em> 2025
          writeups and report how those analogues actually placed in their tracks.
          That is the honest signal. A global “you will win” score from a weekend
          description is not identified in this data.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            placeholder="What it does, who it’s for, how you’re building it, what is actually hard…"
            className="w-full rounded-xl border border-white/10 bg-[#10131a] px-3 py-2 text-sm outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={track}
              onChange={(e) => setTrack(e.target.value)}
              className="rounded-md border border-white/10 bg-[#10131a] px-2 py-1 text-[12px]"
            >
              <option value="">Infer track from neighbours</option>
              {TRACKS.filter(Boolean).map((t) => (
                <option key={t} value={t}>
                  Competing in {t}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={loading || description.trim().length < 40}
              className="rounded-full bg-neutral-100 px-3 py-1 text-[12px] font-medium text-neutral-900 disabled:opacity-40"
            >
              {loading ? "Matching…" : "Match 2025 judged projects"}
            </button>
          </div>
        </form>

        {result?.error ? (
          <p className="text-sm text-red-400">{result.error}</p>
        ) : null}

        {result && !result.error ? (
          <section className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-[#10131a] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">Inferred track</p>
                <p className="mt-1 text-sm">{result.predicted_track || "unclear"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#10131a] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Analogue percentile
                </p>
                <p className="mt-1 font-mono text-lg">
                  {result.analogue_percentile == null
                    ? "—"
                    : Math.round(result.analogue_percentile * 100)}
                </p>
                <p className="text-[11px] text-neutral-500">100 ≈ first in a 2025 track</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#10131a] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Finalist-likeness
                </p>
                <p className="mt-1 font-mono text-lg">
                  {result.finalist_likeness == null
                    ? "—"
                    : `${Math.round(result.finalist_likeness * 100)}%`}
                </p>
                <p className="text-[11px] text-neutral-500">
                  neighbors who were top-10
                  {result.source === "elasticsearch" ? " · Elasticsearch" : ""}
                </p>
              </div>
            </div>

            <ul className="list-disc space-y-1 pl-4 text-[13px] text-neutral-400">
              {(result.reasons || []).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>

            <div className="overflow-hidden rounded-2xl border border-white/10">
              <div className="border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-500">
                Retrieved 2025 analogues
              </div>
              <ul>
                {(result.neighbors || []).map((n) => (
                  <li key={n.project_id} className="border-b border-white/10 px-3 py-2 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{n.project_name}</p>
                      <p className="shrink-0 text-[11px] text-neutral-500">{placeLine(n)}</p>
                    </div>
                    {n.snippet ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{n.snippet}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
