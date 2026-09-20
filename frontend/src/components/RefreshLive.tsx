"use client";

import { useEffect, useRef, useState } from "react";

type Status = {
  state?: string;
  step?: string;
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
  log?: string[];
  summary?: {
    scraped_at?: string;
    hack2026?: number;
    hack2026_writeup_ge_200?: number;
    forecastable?: number;
    edges?: number;
    graph_built_at?: string;
  };
};

function fmtTime(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function RefreshLive() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [watch, setWatch] = useState(true);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prevState = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!watch) return;
    let stop = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const r = await fetch("/api/refresh", { cache: "no-store" });
        const j = (await r.json()) as Status;
        if (stop) return;
        setStatus(j);
        if (j.state === "running") {
          timer = window.setTimeout(tick, 1500);
        } else {
          setWatch(false);
        }
      } catch {
        if (!stop) timer = window.setTimeout(tick, 2500);
      }
    };

    tick();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [watch]);

  useEffect(() => {
    if (prevState.current === "running" && status.state === "ok") {
      window.dispatchEvent(new Event("hackmit:refreshed"));
    }
    prevState.current = status.state;
  }, [status.state]);

  async function pull() {
    setErr(null);
    setPosting(true);
    try {
      const r = await fetch("/api/refresh", { method: "POST", cache: "no-store" });
      const j = (await r.json()) as Status & { error?: string };
      if (!r.ok && r.status !== 409) {
        setErr(j.error || `HTTP ${r.status}`);
        return;
      }
      setWatch(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  const running = status.state === "running" || posting;
  const when = fmtTime(status.summary?.scraped_at || status.finished_at);
  const scored = status.summary?.forecastable;
  const n26 = status.summary?.hack2026;
  const label = running
    ? status.step && status.step !== "start"
      ? `Updating ${status.step}…`
      : "Updating…"
    : "Pull live";

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={pull}
        disabled={running}
        title="Re-fetch HackMIT 2026 from Plume, then rebuild the map and forecast"
        className="rounded-full bg-amber-200/90 px-2.5 py-0.5 text-[11px] font-medium text-neutral-900 disabled:opacity-50"
      >
        {label}
      </button>
      {err ? <span className="max-w-[9rem] truncate text-[10px] text-red-400">{err}</span> : null}
      {!running && !err && status.state === "error" && status.error ? (
        <span className="max-w-[9rem] truncate text-[10px] text-red-400" title={status.error}>
          failed
        </span>
      ) : null}
      {!running && !err && when ? (
        <span className="hidden text-[10px] text-neutral-500 sm:inline">
          {when}
          {typeof scored === "number" && typeof n26 === "number" ? ` · ${scored}/${n26}` : ""}
        </span>
      ) : null}
    </span>
  );
}
