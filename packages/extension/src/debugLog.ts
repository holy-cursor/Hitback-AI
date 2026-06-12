import * as fs from "fs";
import * as path from "path";

const INGEST_URL =
  "http://127.0.0.1:7320/ingest/405fa7ef-03c1-4996-bf1a-5e2eeace3c2c";
const SESSION_ID = "2150e3";

let logPath: string | undefined;

/** Call once from activate() so logs land in workspace debug-2150e3.log */
export function initDebugLog(extensionPath: string): void {
  logPath = path.join(extensionPath, "..", "..", "debug-2150e3.log");
}

export function agentLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = "pre-fix"
): void {
  const entry = {
    sessionId: SESSION_ID,
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };

  fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": SESSION_ID,
    },
    body: JSON.stringify(entry),
  }).catch(() => {});

  if (logPath) {
    try {
      fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
    } catch {
      // ignore
    }
  }
}
