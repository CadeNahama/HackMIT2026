// Allowed values enforced by CHECK constraints on the table.
export const AI_MISTAKE_TYPES = ["technical", "high_level"] as const;
export const BUILD_OR_LEARN = ["building_to_learn", "learning_to_build"] as const;
export const DEMO_PREFERENCES = ["first", "last"] as const;

export type AiMistakeType = (typeof AI_MISTAKE_TYPES)[number];
export type BuildOrLearn = (typeof BUILD_OR_LEARN)[number];
export type DemoPreference = (typeof DEMO_PREFERENCES)[number];

// Mirrors the public.interviews table.
export type Interview = {
  id: number;
  submitted_at: string;
  team_name: string;
  gallery_name: string | null;
  submitted_by: string | null;
  ai_pct: number;
  ai_made_mistakes: boolean;
  ai_mistake_type: AiMistakeType | null;
  had_idea_before: boolean;
  pivoted: boolean;
  friends_before: boolean;
  sleep_hours: number;
  continuing_project: boolean;
  build_or_learn: BuildOrLearn;
  demo_preference: DemoPreference;
  used_hardware: boolean;
};

export type NewInterview = Omit<Interview, "id" | "submitted_at">;
