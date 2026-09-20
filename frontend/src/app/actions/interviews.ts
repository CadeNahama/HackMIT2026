"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import {
  AI_MISTAKE_TYPES,
  BUILD_OR_LEARN,
  DEMO_PREFERENCES,
  type Interview,
  type NewInterview,
} from "@/lib/types";

function oneOf<T extends readonly string[]>(list: T, v: string): T[number] | null {
  return (list as readonly string[]).includes(v) ? (v as T[number]) : null;
}

// 1. READ — every row
export async function getInterviews(): Promise<Interview[]> {
  const { data, error } = await supabase
    .from("interviews")
    .select("*")
    .order("submitted_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export type SubmitState = { ok: boolean; error?: string };

// 2. INSERT
export async function addInterview(
  _prev: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const opt = (k: string) => str(k) || null;
  const bool = (k: string) => str(k) === "yes";

  const team_name = str("team_name");
  const ai_pct = Number(str("ai_pct"));
  const sleep_hours = Number(str("sleep_hours"));
  const ai_made_mistakes = bool("ai_made_mistakes");
  const ai_mistake_type = ai_made_mistakes
    ? oneOf(AI_MISTAKE_TYPES, str("ai_mistake_type"))
    : null;
  const build_or_learn = oneOf(BUILD_OR_LEARN, str("build_or_learn"));
  const demo_preference = oneOf(DEMO_PREFERENCES, str("demo_preference"));

  // Mirror the table's CHECK constraints so users get a friendly message
  // instead of a raw Postgres error.
  if (!team_name) return { ok: false, error: "Team name is required." };
  if (!Number.isInteger(ai_pct) || ai_pct < 0 || ai_pct > 100)
    return { ok: false, error: "AI % must be between 0 and 100." };
  if (!Number.isFinite(sleep_hours) || sleep_hours < 0 || sleep_hours > 12)
    return { ok: false, error: "Sleep hours must be between 0 and 12." };
  if (ai_made_mistakes && !ai_mistake_type)
    return { ok: false, error: "Please say what kind of mistake the AI made." };
  if (!build_or_learn || !demo_preference)
    return { ok: false, error: "Please answer every question." };

  const row: NewInterview = {
    team_name,
    gallery_name: opt("gallery_name"),
    submitted_by: opt("submitted_by"),
    ai_pct,
    ai_made_mistakes,
    ai_mistake_type,
    had_idea_before: bool("had_idea_before"),
    pivoted: bool("pivoted"),
    friends_before: bool("friends_before"),
    sleep_hours: Math.round(sleep_hours * 10) / 10, // NUMERIC(3,1)
    continuing_project: bool("continuing_project"),
    build_or_learn,
    demo_preference,
    used_hardware: bool("used_hardware"),
  };

  const { error } = await supabase.from("interviews").insert(row);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/data");
  return { ok: true };
}
