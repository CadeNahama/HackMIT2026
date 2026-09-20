import path from "node:path";

export function backendDir() {
  return process.env.BACKEND_DIR || path.resolve(process.cwd(), "../backend");
}

export function backendPython() {
  return process.env.BACKEND_PYTHON || path.join(backendDir(), ".venv", "bin", "python");
}

export function refreshStatusPath() {
  return path.join(backendDir(), "data/refresh_status.json");
}
