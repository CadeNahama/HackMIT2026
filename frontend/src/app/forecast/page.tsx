"use client";

import AppNav from "@/components/AppNav";
import type { ForecastFile, ForecastRow } from "@/lib/forecast";
import { pct, placeLine } from "@/lib/forecast";
import { useEffect, useMemo, useState } from "react";

const TRACKS = [
  "Education",
  "General",
  "Beginner",
  "Entertainment",
  "Sustainability",
  "Healthcare",
];

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#10131a] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 font-mono text-lg text-neutral-100">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function Row({ r, i }: { r: ForecastRow; i: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-white/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/5"
      >
        <span className="w-6 shrink-0 pt-0.5 font-mono text-[11px] text-neutral-500">{i + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-neutral-100">{r.project_name}</span>
          <span className="mt-0.5 block text-[11px] text-neutral-500">
            {r.predicted_track || "track unclear"}
            {r.team_size ? ` · team of ${r.team_size}` : ""}
            {` · ${r.writeup_chars} chars`}
            {r.has_code_link ? " · has code" : ""}
          </span>
        </span>
        <span className="shrink-0 text-right text-[11px] text-neutral-400">
          <span className="block font-mono text-neutral-200">
            model {pct(r.model_percentile)}
          </span>
          <span className="block">finalist {pct(r.finalist_likeness)}%</span>
        </span>
      </button>
      {open ? (
        <div className="space-y-3 px-11 pb-4 text-xs text-neutral-300">
          <p className="leading-relaxed text-neutral-400">{r.description || "No description."}</p>
          <ul className="list-disc space-y-1 pl-4 text-neutral-400">
            {r.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {r.neighbors.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">
                2025 analogues (judged)
              </p>
              <ul className="space-y-1">
                {r.neighbors.map((n) => (
                  <li key={n.project_id} className="flex justify-between gap-3">
                    <span>{n.project_name}</span>
                    <span className="shrink-0 text-neutral-500">
                      {placeLine(n)}
                      {n.cosine != null ? ` · cos ${n.cosine.toFixed(2)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function ForecastPage() {
  const [data, setData] = useState<ForecastFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<string>("all");
  const [onlyOk, setOnlyOk] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch("/api/forecast", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`forecast ${r.status}`);
          return r.json();
        })
        .then((j) => {
          if (j.error) throw new Error(j.error);
          setError(null);
          setData(j);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
    load();
    window.addEventListener("hackmit:refreshed", load);
    return () => window.removeEventListener("hackmit:refreshed", load);
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.hack2026.filter((r) => {
      if (onlyOk && (r.confidence === "none" || r.confidence === "low")) return false;
      if (track === "all") return true;
      if (track === "insufficient_writeup") return r.confidence === "none";
      return r.predicted_track === track;
    });
  }, [data, track, onlyOk]);

  const card = data?.model_card;
  const nOk = data
    ? data.hack2026.filter((r) => r.confidence === "high" || r.confidence === "medium").length
    : 0;

  return (
    <div className="min-h-[100dvh] bg-[#07080c] text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#07080c]/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">HackMIT 2026 forecast</h1>
            <p className="text-[11px] text-neutral-500">
              {data
                ? `${nOk} of ${data.hack2026.length} gallery cards have enough writeup to score.`
                : error
                  ? error
                  : "Loading forecast…"}
            </p>
          </div>
          <AppNav current="forecast" />
        </div>
      </header>

      {!data || !card ? (
        <p className="mx-auto max-w-5xl px-4 py-6 text-sm text-neutral-500">
          {error || "Loading forecast…"}
        </p>
      ) : (
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <section className="rounded-2xl border border-amber-200/20 bg-amber-200/5 px-4 py-3 text-sm leading-relaxed text-neutral-300">
          Public writeups are a <span className="text-amber-100">weak</span> predictor of
          Plume pairwise rank. On held-out HackMIT 2025 folds, a 32-d LSA ridge lifts
          within-track NDCG@10 from {card.random.mean_track_ndcg10} (chance) to{" "}
          {card.cv_ridge_lsa.mean_track_ndcg10}, and top-10 overlap from{" "}
          {card.random.mean_track_top10_overlap} to {card.cv_ridge_lsa.mean_track_top10_overlap}.
          That is a real lift and a small one. This page ranks 2026 by that model, then
          explains each card with 2025 analogues — not as a results sheet.
        </section>

        <section className="grid gap-2 sm:grid-cols-4">
          <Metric
            label="Chance NDCG@10"
            value={String(card.random.mean_track_ndcg10)}
            hint="5-fold, by track"
          />
          <Metric
            label="Ridge-LSA NDCG@10"
            value={String(card.cv_ridge_lsa.mean_track_ndcg10)}
            hint="best public-text ranker"
          />
          <Metric
            label="Top-10 overlap"
            value={`${Math.round((card.cv_ridge_lsa.mean_track_top10_overlap || 0) * 100)}%`}
            hint={`chance ${Math.round((card.random.mean_track_top10_overlap || 0) * 100)}%`}
          />
          <Metric
            label="2026 scored"
            value={`${nOk}/${data.hack2026.length}`}
            hint="gallery cards with enough writeup"
          />
        </section>

        <section className="text-[12px] leading-relaxed text-neutral-500">
          <p className="mb-2 text-[10px] uppercase tracking-wider">What the labels actually are</p>
          <ul className="list-disc space-y-1 pl-4">
            {card.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-2">{card.read}</p>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTrack("all")}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                track === "all" ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-400"
              }`}
            >
              All scored
            </button>
            {TRACKS.map((t) => (
              <button
                key={t}
                onClick={() => setTrack(t)}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  track === t ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-400"
                }`}
              >
                {t}
                <span className="text-neutral-500">
                  {" "}
                  ({(data.by_track[t] || []).length})
                </span>
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-400">
              <input
                type="checkbox"
                checked={onlyOk}
                onChange={(e) => setOnlyOk(e.target.checked)}
              />
              Hide empty writeups
            </label>
          </div>
          <p className="mb-2 text-[11px] text-neutral-500">
            {typeof card.corpus?.hack2026_public_track === "string"
              ? "Official 2026 track is missing on the public gallery (all NO TRACK). Track here is inferred from nearest HackMIT 2025 writeups. "
              : "Official 2026 tracks from the gallery are shown when present; otherwise track is inferred from nearest HackMIT 2025 writeups. "}
            Model column is 2025 within-track percentile (100 ≈ first). Click a row for analogues.
          </p>
          <ol className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d12]">
            {rows.length === 0 ? (
              <li className="px-4 py-6 text-sm text-neutral-500">No projects in this cut.</li>
            ) : (
              rows.map((r, i) => <Row key={r.project_id} r={r} i={i} />)
            )}
          </ol>
        </section>
      </main>
      )}
    </div>
  );
}
