"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import AppNav from "@/components/AppNav";

type Point = {
  project_id: string;
  project_name: string;
  hackathon_id: string;
  track: string | null;
  confidence: "high" | "medium" | "low";
  rank: number | null;
  score?: number | null;
  team_size: number | null;
  schools?: string[];
  is_winner: boolean;
  description: string;
  signature_terms: string[];
  sponsor_challenges: string[];
  cluster_id: number | null;
  cluster_label: string | null;
  n_connections: number;
  x: number;
  y: number;
  z: number;
};

type Edge = {
  source: string;
  target: string;
  weight: number;
  cosine: number;
  shared_terms: string[];
  evidence: string;
  same_track: boolean;
};

type Cluster = {
  id: number;
  label: string;
  size: number;
  x: number;
  y: number;
  z: number;
};

type Payload = {
  points: Point[];
  edges: Edge[];
  clusters: Cluster[];
  source?: "elasticsearch" | "file";
};

const TRACK_COLOR: Record<string, string> = {
  Beginner: "#7aa2ff",
  General: "#c4b5fd",
  Education: "#86efac",
  Entertainment: "#f9a8d4",
  Healthcare: "#fb7185",
  Sustainability: "#5eead4",
  "NO TRACK": "#737373",
};

const CLUSTER_COLOR = [
  "#7aa2ff",
  "#f9a8d4",
  "#86efac",
  "#fbbf24",
  "#67e8f9",
  "#c4b5fd",
  "#fb7185",
  "#a3e635",
  "#fda4af",
  "#5eead4",
  "#fcd34d",
  "#93c5fd",
  "#f0abfc",
  "#6ee7b7",
  "#fdba74",
  "#a5b4fc",
  "#fca5a5",
  "#7dd3fc",
];

const MIXED_COLOR = "#64748b";

const HACKATHONS: { id: string; label: string; short: string }[] = [
  { id: "hack-2025", label: "HackMIT 2025", short: "H '25" },
  { id: "hack-2026", label: "HackMIT 2026", short: "H '26" },
  { id: "bp-2025", label: "Blueprint 2025", short: "BP '25" },
  { id: "bp-2026", label: "Blueprint 2026", short: "BP '26" },
];

const SCALE = 5.6;
const DEFAULT_CAM: [number, number, number] = [0, 1.35, 8.4];

function colorFor(p: Point, mode: "theme" | "track") {
  if (mode === "track") return TRACK_COLOR[p.track || "NO TRACK"] || MIXED_COLOR;
  if (p.cluster_id == null) return MIXED_COLOR;
  return CLUSTER_COLOR[p.cluster_id % CLUSTER_COLOR.length];
}

function ordinal(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function rankLine(p: Point) {
  if (p.rank == null || !p.track || p.track === "NO TRACK") return null;
  return `${ordinal(p.rank + 1)} in ${p.track}`;
}

function Recenter({ points, enabled }: { points: Point[]; enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const wasEnabled = useRef(false);
  const key = points
    .map((p) => p.project_id)
    .sort()
    .join("|");

  useEffect(() => {
    if (enabled && points.length > 0) {
      wasEnabled.current = true;
      const cx = (points.reduce((s, p) => s + p.x, 0) / points.length) * SCALE;
      const cy = (points.reduce((s, p) => s + p.y, 0) / points.length) * SCALE;
      const cz = (points.reduce((s, p) => s + p.z, 0) / points.length) * SCALE;
      if (![cx, cy, cz].every(Number.isFinite)) return;
      let span = points.length === 1 ? 1.15 : 0.7;
      for (const p of points) {
        const d = Math.hypot(p.x * SCALE - cx, p.y * SCALE - cy, p.z * SCALE - cz);
        if (d > span) span = d;
      }
      span = Math.min(span, 2.4);
      camera.position.set(cx, cy + span * 0.32, cz + Math.max(3.6, span * 2.8));
      camera.lookAt(cx, cy, cz);
      camera.updateProjectionMatrix();
      invalidate();
      return;
    }
    if (wasEnabled.current) {
      wasEnabled.current = false;
      camera.position.set(...DEFAULT_CAM);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      invalidate();
    }
  }, [key, enabled, camera, invalidate, points]);
  return null;
}

export default function ProjectMap() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hideLow, setHideLow] = useState(true);
  const [colorMode, setColorMode] = useState<"theme" | "track">("theme");
  const [edgeMode, setEdgeMode] = useState<"inspect" | "all">("inspect");
  const [hackathons, setHackathons] = useState<string[]>(HACKATHONS.map((h) => h.id));
  const [query, setQuery] = useState("");
  const [clusterFilter, setClusterFilter] = useState<number | "mixed" | null>(null);
  const [trackFilter, setTrackFilter] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/map", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`map ${r.status}`);
          return r.json();
        })
        .then((j) => {
          if (j.error) throw new Error(j.error);
          setError(null);
          setData({
            points: j.points,
            edges: j.edges,
            clusters: j.clusters || [],
            source: j.source,
          });
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
    load();
    window.addEventListener("hackmit:refreshed", load);
    return () => window.removeEventListener("hackmit:refreshed", load);
  }, []);

  useEffect(() => {
    if (!data) return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    const named = data.points.filter(
      (p) =>
        p.project_name.toLowerCase().includes(q) &&
        !(hideLow && p.confidence === "low") &&
        hackathons.includes(p.hackathon_id)
    );
    if (named.length === 1) setSelected(named[0].project_id);
  }, [query, data, hideLow, hackathons]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setSelected(null);
        setHovered(null);
        setQuery("");
        setClusterFilter(null);
        setTrackFilter(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, Point>();
    for (const p of data?.points || []) m.set(p.project_id, p);
    return m;
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const hset = new Set(hackathons);
    const base = data.points.filter((p) => {
      if (hideLow && p.confidence === "low") return false;
      if (!hset.has(p.hackathon_id)) return false;
      if (clusterFilter === "mixed" && p.cluster_id != null) return false;
      if (typeof clusterFilter === "number" && p.cluster_id !== clusterFilter) return false;
      if (trackFilter && (p.track || "NO TRACK") !== trackFilter) return false;
      if (!q) return true;
      return (
        p.project_name.toLowerCase().includes(q) ||
        (p.track || "").toLowerCase().includes(q) ||
        (p.cluster_label || "").toLowerCase().includes(q) ||
        p.signature_terms.some((t) => t.toLowerCase().includes(q))
      );
    });
    if (!q) return base;
    const nameHits = data.points.filter((p) => {
      if (hideLow && p.confidence === "low") return false;
      if (!hset.has(p.hackathon_id)) return false;
      return p.project_name.toLowerCase().includes(q);
    });
    const keep = new Set((nameHits.length ? nameHits : base).map((p) => p.project_id));
    if (nameHits.length) {
      const extra = new Set<string>();
      const seed = new Set(keep);
      for (const e of data.edges) {
        if (seed.has(e.source)) extra.add(e.target);
        if (seed.has(e.target)) extra.add(e.source);
      }
      for (const id of extra) keep.add(id);
    }
    return data.points.filter(
      (p) => keep.has(p.project_id) && !(hideLow && p.confidence === "low") && hset.has(p.hackathon_id)
    );
  }, [data, hideLow, query, hackathons, clusterFilter, trackFilter]);

  const visibleIds = useMemo(() => new Set(visible.map((p) => p.project_id)), [visible]);

  const focusId = selected || hovered;
  const neighborIds = useMemo(() => {
    const s = new Set<string>();
    if (!focusId || !data) return s;
    s.add(focusId);
    for (const e of data.edges) {
      if (e.source === focusId) s.add(e.target);
      if (e.target === focusId) s.add(e.source);
    }
    return s;
  }, [focusId, data]);

  const neighborhoodView = visible.length > 0 && visible.length <= 48;

  const framePoints = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    const named = visible.filter((p) => p.project_name.toLowerCase().includes(q));
    return named.length ? named : visible;
  }, [visible, query]);

  const drawnEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter((e) => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
      if (neighborhoodView) return true;
      if (edgeMode === "all") return e.weight >= 0.4;
      if (!focusId) return false;
      return e.source === focusId || e.target === focusId;
    });
  }, [data, visibleIds, edgeMode, focusId, neighborhoodView]);

  const selectedPoint = selected ? byId.get(selected) : undefined;
  const hoveredPoint = hovered && hovered !== selected ? byId.get(hovered) : undefined;

  const selectedEdges = useMemo(() => {
    if (!selected || !data) return [];
    return data.edges
      .filter((e) => e.source === selected || e.target === selected)
      .sort((a, b) => b.weight - a.weight);
  }, [selected, data]);

  const visibleClusters = useMemo(() => {
    if (!data) return [];
    const counts = new Map<number, number>();
    for (const p of visible) {
      if (p.cluster_id == null) continue;
      counts.set(p.cluster_id, (counts.get(p.cluster_id) || 0) + 1);
    }
    return data.clusters
      .filter((c) => (counts.get(c.id) || 0) >= 4)
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
  }, [data, visible]);

  const mixedCount = useMemo(
    () => visible.filter((p) => p.cluster_id == null).length,
    [visible]
  );

  const orbitTarget = useMemo((): [number, number, number] => {
    const pts = framePoints.length ? framePoints : visible;
    if (!neighborhoodView || pts.length === 0) return [0, 0, 0];
    const cx = (pts.reduce((s, p) => s + p.x, 0) / pts.length) * SCALE;
    const cy = (pts.reduce((s, p) => s + p.y, 0) / pts.length) * SCALE;
    const cz = (pts.reduce((s, p) => s + p.z, 0) / pts.length) * SCALE;
    if (![cx, cy, cz].every(Number.isFinite)) return [0, 0, 0];
    return [cx, cy, cz];
  }, [framePoints, visible, neighborhoodView]);

  function toggleHack(id: string) {
    setHackathons((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  function resetView() {
    setQuery("");
    setSelected(null);
    setHovered(null);
    setClusterFilter(null);
    setTrackFilter(null);
    setHackathons(HACKATHONS.map((h) => h.id));
  }

  if (error) {
    return (
      <p className="p-8 text-sm text-red-400">Could not load map data ({error}).</p>
    );
  }
  if (!data) {
    return <p className="p-8 text-sm text-neutral-400">Loading map…</p>;
  }

  const islanded = data.clusters.reduce((s, c) => s + c.size, 0);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#07080c] text-neutral-100">
      <Canvas
        camera={{ position: DEFAULT_CAM, fov: 46 }}
        style={{ width: "100%", height: "100%", display: "block" }}
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
        onPointerMissed={() => {
          setSelected(null);
          setHovered(null);
        }}
      >
        <Recenter points={framePoints} enabled={neighborhoodView} />
        <color attach="background" args={["#07080c"]} />
        <ambientLight intensity={1.1} />
        <pointLight position={[6, 8, 10]} intensity={0.6} />

        {!neighborhoodView &&
          visibleClusters.slice(0, 5).map((c) => (
            <Html
              key={`c-${c.id}`}
              position={[c.x * SCALE, c.y * SCALE + 0.32, c.z * SCALE]}
              center
              sprite
              zIndexRange={[2, 1]}
              style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
            >
              <div
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white/90 shadow-none"
                style={{
                  background: `${CLUSTER_COLOR[c.id % CLUSTER_COLOR.length]}33`,
                  border: `1px solid ${CLUSTER_COLOR[c.id % CLUSTER_COLOR.length]}66`,
                }}
              >
                {c.label}
              </div>
            </Html>
          ))}

        {drawnEdges.map((e) => {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) return null;
          const hot = !!(focusId && (e.source === focusId || e.target === focusId));
          return (
            <Line
              key={`${e.source}-${e.target}`}
              points={[
                [a.x * SCALE, a.y * SCALE, a.z * SCALE],
                [b.x * SCALE, b.y * SCALE, b.z * SCALE],
              ]}
              color={hot ? "#f8fafc" : "#94a3b8"}
              lineWidth={hot ? 2.2 : neighborhoodView ? 1.4 : 1}
              transparent
              opacity={hot ? 0.95 : neighborhoodView ? 0.45 : 0.2}
            />
          );
        })}

        {visible.map((p) => {
          const active = p.project_id === selected;
          const inFocus = !focusId || neighborIds.has(p.project_id);
          const base = visible.length <= 24 ? 0.092 : visible.length <= 80 ? 0.086 : 0.078;
          const r =
            base *
            (active ? 1.4 : hovered === p.project_id ? 1.18 : 1) *
            (0.92 + 0.08 * Math.min(p.n_connections, 5) / 5);
          const col = colorFor(p, colorMode);
          return (
            <group key={p.project_id} position={[p.x * SCALE, p.y * SCALE, p.z * SCALE]}>
              <mesh
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelected(p.project_id);
                }}
                onPointerOver={(ev) => {
                  ev.stopPropagation();
                  setHovered(p.project_id);
                  document.body.style.cursor = "pointer";
                }}
                onPointerOut={() => {
                  setHovered(null);
                  document.body.style.cursor = "auto";
                }}
              >
                <sphereGeometry args={[r, 16, 16]} />
                <meshBasicMaterial
                  color={col}
                  transparent
                  opacity={
                    inFocus
                      ? colorMode === "theme" && p.cluster_id == null
                        ? 0.5
                        : 0.96
                      : 0.1
                  }
                  toneMapped={false}
                />
              </mesh>
              {p.is_winner ? (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[r * 1.45, r * 0.14, 8, 20]} />
                  <meshBasicMaterial color="#fbbf24" toneMapped={false} />
                </mesh>
              ) : null}
            </group>
          );
        })}

        {hoveredPoint && (
          <Html
            position={[
              hoveredPoint.x * SCALE,
              hoveredPoint.y * SCALE + 0.16,
              hoveredPoint.z * SCALE,
            ]}
            center
            sprite
            zIndexRange={[2, 1]}
            style={{ pointerEvents: "none" }}
          >
            <div className="rounded-md border border-white/20 bg-black/85 px-2 py-1 text-[11px] text-white">
              <div className="font-medium">{hoveredPoint.project_name}</div>
              <div className="text-[10px] text-neutral-400">
                {hoveredPoint.cluster_label ||
                  (hoveredPoint.track && hoveredPoint.track !== "NO TRACK"
                    ? hoveredPoint.track
                    : "No tight theme")}
              </div>
            </div>
          </Html>
        )}

        <OrbitControls
          enableDamping
          makeDefault
          minDistance={2.2}
          maxDistance={18}
          target={orbitTarget}
        />
      </Canvas>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 p-2">
        <div className="pointer-events-auto flex h-11 items-center gap-2 overflow-x-auto rounded-xl border border-white/10 bg-[#0b0d12]/95 px-3">
          <h1 className="shrink-0 text-sm font-semibold tracking-tight">Project space</h1>
          <AppNav current="map" />
          {data.source === "elasticsearch" ? (
            <span className="shrink-0 rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              ES
            </span>
          ) : null}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a project…"
            className="h-7 min-w-[9rem] flex-1 rounded-md border border-neutral-700 bg-neutral-900/80 px-2 text-xs outline-none"
          />
          <div className="flex shrink-0 gap-1">
            {HACKATHONS.map((h) => {
              const on = hackathons.includes(h.id);
              return (
                <button
                  key={h.id}
                  title={h.label}
                  onClick={() => toggleHack(h.id)}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                    on ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-500"
                  }`}
                >
                  {h.short}
                </button>
              );
            })}
          </div>
          <div className="flex shrink-0 gap-1">
            {(["theme", "track"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setColorMode(m);
                  if (m === "theme") setTrackFilter(null);
                  else setClusterFilter(null);
                }}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                  colorMode === m ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {m === "theme" ? "Theme" : "Track"}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 gap-1">
            {(["inspect", "all"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setEdgeMode(m)}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                  edgeMode === m ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {m === "inspect" ? "Inspect" : "All lines"}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-400">
            <input
              type="checkbox"
              checked={hideLow}
              onChange={(e) => setHideLow(e.target.checked)}
            />
            Hide thin
          </label>
          <p className="shrink-0 text-[11px] text-neutral-500">{visible.length}</p>
          <button
            onClick={resetView}
            className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300"
          >
            Reset
          </button>
        </div>
      </header>

      {!selectedPoint && (
      <aside className="pointer-events-none absolute bottom-3 left-3 z-20 w-[15.5rem] max-h-[38vh]">
        <div className="pointer-events-auto max-h-[38vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0b0d12]/90 px-3 py-2.5 text-[11px]">
          {colorMode === "theme" ? (
            <>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
                Tight writeup islands
              </p>
              <p className="mb-2 leading-snug text-neutral-500">
                {islanded} of {data.points.filter((p) => p.confidence !== "low").length}{" "}
                projects share a distinctive neighborhood. Gray is not a category.
              </p>
              <button
                onClick={() =>
                  setClusterFilter((cur) => (cur === "mixed" ? null : "mixed"))
                }
                className={`mb-1.5 flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left ${
                  clusterFilter === "mixed" ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <span
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: MIXED_COLOR }}
                />
                <span className="text-neutral-400">
                  No tight theme{" "}
                  <span className="text-neutral-600">({mixedCount})</span>
                </span>
              </button>
              {data.clusters
                .slice()
                .sort((a, b) => b.size - a.size)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      setClusterFilter((cur) => (cur === c.id ? null : c.id))
                    }
                    className={`flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left ${
                      clusterFilter === c.id ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <span
                      className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: CLUSTER_COLOR[c.id % CLUSTER_COLOR.length] }}
                    />
                    <span>
                      {c.label}{" "}
                      <span className="text-neutral-600">({c.size})</span>
                    </span>
                  </button>
                ))}
            </>
          ) : (
            <>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
                Official track
              </p>
              <p className="mb-2 leading-snug text-neutral-500">
                Track is a color only — it does not create matches.
              </p>
              {Object.entries(TRACK_COLOR).map(([name, c]) => (
                <button
                  key={name}
                  onClick={() => setTrackFilter((cur) => (cur === name ? null : name))}
                  className={`flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left ${
                    trackFilter === name ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                  {name}
                </button>
              ))}
            </>
          )}
        </div>
      </aside>
      )}

      {selectedPoint && (
        <aside className="absolute inset-x-3 bottom-3 z-20 max-h-[46vh] overflow-hidden rounded-xl border border-white/10 bg-[#0b0d12]/95 md:inset-x-auto md:right-3 md:top-16 md:w-[22rem] md:max-h-none">
          <Detail
            point={selectedPoint}
            edges={selectedEdges}
            byId={byId}
            onClose={() => setSelected(null)}
            onPick={setSelected}
          />
        </aside>
      )}
    </div>
  );
}

function Detail({
  point,
  edges,
  byId,
  onClose,
  onPick,
}: {
  point: Point;
  edges: Edge[];
  byId: Map<string, Point>;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const schools = (point.schools || []).filter(Boolean).slice(0, 6);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-4 py-3">
        <button className="text-[11px] text-neutral-500" onClick={onClose}>
          Close
        </button>
        <h2 className="mt-1 text-base font-semibold leading-snug">{point.project_name}</h2>
        <p className="mt-1 text-[11px] text-neutral-400">
          {HACKATHONS.find((h) => h.id === point.hackathon_id)?.label || point.hackathon_id}
          {point.track && point.track !== "NO TRACK" ? ` · ${point.track}` : ""}
          {rankLine(point) ? ` · ${rankLine(point)}` : ""}
          {point.team_size ? ` · team of ${point.team_size}` : ""}
        </p>
        {point.cluster_label ? (
          <p className="mt-1 text-[11px] text-sky-300/90">Island: {point.cluster_label}</p>
        ) : (
          <p className="mt-1 text-[11px] text-neutral-500">
            No tight writeup island — nearby dots may only share a vague topic.
          </p>
        )}
        {schools.length > 0 && (
          <p className="mt-1 text-[11px] text-neutral-500">{schools.join(" · ")}</p>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        <p className="leading-relaxed text-neutral-300">
          {point.description || "No description submitted."}
        </p>
        {point.signature_terms.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">
              Distinctive language
            </p>
            <p className="mt-1 text-neutral-300">{point.signature_terms.slice(0, 8).join(" · ")}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            Evidenced matches ({edges.length})
          </p>
          {edges.length === 0 ? (
            <p className="mt-1 leading-relaxed text-neutral-500">
              Nothing else passed the evidence rule. Neighbors in space may share a
              vague topic, but not enough distinctive language to count as a real
              connection.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {edges.map((e) => {
                const otherId = e.source === point.project_id ? e.target : e.source;
                const other = byId.get(otherId);
                return (
                  <li key={`${e.source}-${e.target}`}>
                    <button
                      className="text-left text-sky-300 hover:underline"
                      onClick={() => onPick(otherId)}
                    >
                      {other?.project_name || otherId}
                    </button>
                    <p className="text-[11px] text-neutral-500">
                      because of {e.shared_terms.slice(0, 5).join(", ")}
                      {e.same_track ? "" : " · different tracks"}
                      {typeof e.cosine === "number"
                        ? ` · cosine ${e.cosine.toFixed(2)}`
                        : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
