"use client";

import RefreshLive from "@/components/RefreshLive";

export type NavId = "map" | "forecast" | "match";

const LINKS: { id: NavId; href: string; label: string }[] = [
  { id: "map", href: "/", label: "Map" },
  { id: "forecast", href: "/forecast", label: "2026 forecast" },
  { id: "match", href: "/match", label: "Try a writeup" },
];

export default function AppNav({ current }: { current: NavId }) {
  return (
    <nav className="flex shrink-0 items-center gap-1.5">
      {LINKS.map((l) => (
        <a
          key={l.id}
          href={l.href}
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${
            current === l.id
              ? "bg-neutral-100 text-neutral-900"
              : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {l.label}
        </a>
      ))}
      <RefreshLive />
    </nav>
  );
}
