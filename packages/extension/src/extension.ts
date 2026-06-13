import * as path from "path";
import * as vscode from "vscode";
import { CursorAgentDetector } from "./adapters/cursorDetector";
import { AdPanel } from "./panel/adPanel";
import {
  fetchCurrentAd,
  OFFLINE_FALLBACK_AD,
  reportClick,
  reportImpression,
} from "./ads/adClient";
import { randomUUID } from "crypto";

import { AuthService } from "./auth/authService";

import { RateLimiter } from "./ads/rateLimiter";

/**
 * HitBack Extension — AI Wait State Ad Network
 *
 * Detects when Cursor's agent is actively editing (rapid document changes)
 * and opens a sponsored ad panel beside the editor. When the agent stops,
 * the panel auto-closes. Clicking the ad opens the URL and reports the click.
 *
 * Privacy: Never reads document content, file contents, or prompts.
 */

/** Key used to persist the anonymous extension user ID across sessions. */
const USER_ID_KEY = "hitback.extensionUserId";

const IGNORED_DOC_SCHEMES = new Set([
  "output",
  "debug",
  "git",
  "gitfs",
  "vscode-terminal",
  "extension-output",
]);

/**
 * Get or create a persistent anonymous user ID for this extension install.
 * Stored in VS Code globalState so it survives restarts.
 */
function getOrCreateUserId(context: vscode.ExtensionContext): string {
  let userId = context.globalState.get<string>(USER_ID_KEY);
  if (!userId) {
    userId = randomUUID();
    context.globalState.update(USER_ID_KEY, userId);
    console.log(`[HitBack] Generated new user ID: ${userId}`);
  }
  return userId;
}

/** Collect directories to watch even when no workspace folder is open. */
function collectWatchRoots(context: vscode.ExtensionContext): string[] {
  const roots = new Set<string>();

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.add(folder.uri.fsPath);
  }

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === "file") {
      roots.add(path.dirname(doc.uri.fsPath));
    }
  }

  // Extension dev fallback: watch the hitback repo root
  roots.add(path.resolve(context.extensionPath, "..", ".."));

  return [...roots];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("hitback");
  const enabled = config.get<boolean>("enabled", true);
  const watchRoots = collectWatchRoots(context);

  // Initialize AuthService
  const authService = AuthService.getInstance(context);
  context.subscriptions.push(vscode.window.registerUriHandler(authService));
  await authService.initialize();

  // Register Auth Commands
  const loginCommand = vscode.commands.registerCommand("hitback.login", () => authService.login());
  const logoutCommand = vscode.commands.registerCommand("hitback.logout", () => authService.logout());
  context.subscriptions.push(loginCommand, logoutCommand);

  if (!enabled) {
    return;
  }

  const detector = new CursorAgentDetector(watchRoots, IGNORED_DOC_SCHEMES);
  const adPanel = new AdPanel();
  const extensionUserId = getOrCreateUserId(context);
  const rateLimiter = RateLimiter.getInstance(context);

  // --- Agent Start: fetch and show an ad ---
  const startListener = detector.onAgentStart(async () => {
    if (!rateLimiter.canShowAd()) {
      console.log("[HitBack] Rate limit reached. Skipping ad fetch for this burst.");
      return;
    }

    const backendUrl = vscode.workspace
      .getConfiguration("hitback")
      .get<string>("backendUrl", "http://localhost:3001");

    const token = authService.getToken() || undefined;
    const fetchedAd = await fetchCurrentAd(backendUrl, token);
    const ad = fetchedAd ?? OFFLINE_FALLBACK_AD;
    const usedFallback = !fetchedAd;

    if (detector.isActive) {
      adPanel.show(ad);
      rateLimiter.recordImpression();

      console.log(
        `[HitBack] Ad panel opened: "${ad.text}" (id: ${ad.id}${usedFallback ? ", offline fallback" : ""})`
      );

      if (!usedFallback) {
        reportImpression(backendUrl, ad.id, extensionUserId, token);
      }
    }
  });

  const stopListener = detector.onAgentStop(() => {
    adPanel.hide();
    console.log("[HitBack] Agent stopped — ad panel closed");
  });

  const clickCommand = vscode.commands.registerCommand(
    "hitback.adClick",
    async () => {
      const ad = adPanel.getAd();
      if (!ad) {
        return;
      }

      console.log(`[HitBack] Ad clicked: "${ad.text}" → ${ad.url}`);

      const backendUrl = vscode.workspace
        .getConfiguration("hitback")
        .get<string>("backendUrl", "http://localhost:3001");

      const token = authService.getToken() || undefined;
      reportClick(backendUrl, ad.id, extensionUserId, token);
    }
  );

  const testCommand = vscode.commands.registerCommand(
    "hitback.testAd",
    async () => {
      console.log("[HitBack:Test] Manually triggering ad fetch...");
      const backendUrl = vscode.workspace
        .getConfiguration("hitback")
        .get<string>("backendUrl", "http://localhost:3001");

      const token = authService.getToken() || undefined;
      const fetchedAd = await fetchCurrentAd(backendUrl, token);
      const ad = fetchedAd ?? OFFLINE_FALLBACK_AD;
      const usedFallback = !fetchedAd;

      adPanel.show(ad);
      vscode.window.showInformationMessage(
        `[HitBack] Ad: "${ad.text}"${usedFallback ? " (offline fallback)" : ""}`
      );
    }
  );

  context.subscriptions.push(
    clickCommand,
    testCommand,
    stopListener,
    startListener,
    detector
  );

  console.log(`[HitBack] Extension activated — user: ${extensionUserId.slice(0, 8)}…`);
}

export function deactivate(): void {
  console.log("[HitBack] Extension deactivated");
}
