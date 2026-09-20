import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { backendDir, backendPython, refreshStatusPath } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefreshStatus = {
  state?: string;
  mode?: string;
  step?: string;
  pid?: number;
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
  log?: string[];
  summary?: Record<string, unknown>;
  elastic_error?: string;
};

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readStatus(): Promise<RefreshStatus> {
  try {
    return JSON.parse(await readFile(refreshStatusPath(), "utf8")) as RefreshStatus;
  } catch {
    return { state: "idle" };
  }
}

function allowed(req: Request) {
  const secret = process.env.REFRESH_SECRET;
  if (secret) return req.headers.get("x-refresh-secret") === secret;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

export async function GET() {
  return json(await readStatus());
}

export async function POST(req: Request) {
  if (!allowed(req)) {
    return json(
      { error: "Refresh is disabled in production unless REFRESH_SECRET is set." },
      403
    );
  }

  const current = await readStatus();
  if (current.state === "running") {
    return json({ started: false, already: true, ...current }, 409);
  }

  const python = backendPython();
  const cwd = backendDir();
  if (!existsSync(python)) {
    return json(
      {
        error: `Backend Python not found at ${python}. Create backend/.venv first.`,
      },
      500
    );
  }

  const child = spawn(python, ["-u", "refresh.py"], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return json({
    started: true,
    pid: child.pid,
    python,
    cwd,
  });
}
