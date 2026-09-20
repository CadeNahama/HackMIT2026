"use client";

import { useActionState, useState } from "react";
import { addInterview, type SubmitState } from "@/app/actions/interviews";

const field =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white/10";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

/** Segmented control backed by radio inputs — works with plain FormData. */
function Choice({
  name,
  label,
  options,
  defaultValue,
  onChange,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === defaultValue}
              required
              onChange={() => onChange?.(o.value)}
              className="peer sr-only"
            />
            <span className="inline-block rounded-lg border border-neutral-300 px-4 py-1.5 text-sm transition peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-900/30 dark:border-neutral-700 dark:peer-checked:border-white dark:peer-checked:bg-white dark:peer-checked:text-black">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const initial: SubmitState = { ok: false };

export default function InterviewForm() {
  const [submitted, setSubmitted] = useState(false);
  const [formKey, setFormKey] = useState(0);

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center dark:border-green-900 dark:bg-green-950">
        <p className="text-lg font-semibold text-green-900 dark:text-green-100">
          Thanks — response recorded.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setFormKey((k) => k + 1); // remount → fresh, empty form
          }}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
        >
          Submit another
        </button>
      </div>
    );
  }

  return <FormBody key={formKey} onSuccess={() => setSubmitted(true)} />;
}

function FormBody({ onSuccess }: { onSuccess: () => void }) {
  const [aiPct, setAiPct] = useState(50);
  const [aiMistakes, setAiMistakes] = useState<string>("");
  const [state, action, pending] = useActionState(
    async (prev: SubmitState, fd: FormData) => {
      const result = await addInterview(prev, fd);
      if (result.ok) onSuccess();
      return result;
    },
    initial
  );

  return (
    <form action={action} className="space-y-6">
      <Section title="Team">
        <Field label="Team name">
          <input name="team_name" required placeholder="e.g. Byte Me" className={field} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Gallery name" hint="Optional">
            <input name="gallery_name" className={field} />
          </Field>
          <Field label="Your name" hint="Optional">
            <input name="submitted_by" className={field} />
          </Field>
        </div>
      </Section>

      <Section title="AI usage">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium">How much of your code did AI write?</span>
            <span className="tabular-nums text-neutral-500">{aiPct}%</span>
          </div>
          <input
            type="range"
            name="ai_pct"
            min={0}
            max={100}
            step={5}
            value={aiPct}
            onChange={(e) => setAiPct(Number(e.target.value))}
            className="w-full accent-neutral-900 dark:accent-white"
          />
        </div>
        <Choice
          name="ai_made_mistakes"
          label="Did the AI make mistakes that cost you time?"
          options={YES_NO}
          onChange={setAiMistakes}
        />
        {aiMistakes === "yes" && (
          <Choice
            name="ai_mistake_type"
            label="What kind of mistake?"
            options={[
              { value: "technical", label: "Technical (bugs, wrong code)" },
              { value: "high_level", label: "High-level (wrong approach)" },
            ]}
          />
        )}
      </Section>

      <Section title="Project">
        <div className="grid gap-5 sm:grid-cols-2">
          <Choice name="had_idea_before" label="Had the idea before the hackathon?" options={YES_NO} />
          <Choice name="pivoted" label="Pivoted during the event?" options={YES_NO} />
          <Choice name="friends_before" label="Knew your teammates before?" options={YES_NO} />
          <Choice name="used_hardware" label="Used any hardware?" options={YES_NO} />
          <Choice name="continuing_project" label="Continuing the project after?" options={YES_NO} />
        </div>
      </Section>

      <Section title="Vibes">
        <Field label="Hours of sleep">
          <input
            type="number"
            name="sleep_hours"
            min={0}
            max={12}
            step={0.5}
            required
            placeholder="e.g. 3.5"
            className={field}
          />
        </Field>
        <Choice
          name="build_or_learn"
          label="Which describes you better?"
          options={[
            { value: "building_to_learn", label: "Building to learn" },
            { value: "learning_to_build", label: "Learning to build" },
          ]}
        />
        <Choice
          name="demo_preference"
          label="Would you rather demo first or last?"
          options={[
            { value: "first", label: "First" },
            { value: "last", label: "Last" },
          ]}
        />
      </Section>

      {state.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
      >
        {pending ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}
