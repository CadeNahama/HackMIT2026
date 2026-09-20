import Link from "next/link";
import { getInterviews } from "@/app/actions/interviews";
import type { Interview } from "@/lib/types";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "id",
  "submitted_at",
  "team_name",
  "gallery_name",
  "submitted_by",
  "ai_pct",
  "ai_made_mistakes",
  "ai_mistake_type",
  "had_idea_before",
  "pivoted",
  "friends_before",
  "sleep_hours",
  "continuing_project",
  "build_or_learn",
  "demo_preference",
  "used_hardware",
] as const satisfies readonly (keyof Interview)[];

function fmt(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export default async function DataPage() {
  let rows: Interview[] = [];
  let error: string | null = null;

  try {
    rows = await getInterviews();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 font-sans">
      <header className="mb-6 flex items-end justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Responses{" "}
          <span className="text-base font-normal text-neutral-500">({rows.length})</span>
        </h1>
        <Link href="/" className="text-sm text-neutral-500 underline-offset-4 hover:underline">
          ← Back to form
        </Link>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Could not reach Supabase: {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-neutral-500">No responses yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100 dark:bg-neutral-900">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  {COLUMNS.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-2">
                      {fmt(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
