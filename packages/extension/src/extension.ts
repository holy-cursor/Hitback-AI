import * as path from "path";
import * as vscode from "vscode";
import { CursorAgentDetector } from "./adapters/cursorDetector";
import { AdPanel } from "./panel/adPanel";
import {
  fetchCurrentAd,
  reportClick,
  reportImpression,
} from "./ads/adClient";
import { randomUUID } from "crypto";

import { AuthService } from "./auth/authService";

import { RateLimiter } from "./ads/rateLimiter";
import { DEFAULT_BACKEND_URL, PANEL_COOLDOWN_MS } from "./config";

function getBackendUrl(): string {
  return DEFAULT_BACKEND_URL;
}

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

  // Dev only — never watch ~/.cursor in production installs
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    roots.add(path.resolve(context.extensionPath, "..", ".."));
  }

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
  const loginCommand = vscode.commands.registerCommand("hitback.login", () =>
    authService.promptSignIn()
  );
  const logoutCommand = vscode.commands.registerCommand("hitback.logout", () => authService.logout());
  context.subscriptions.push(loginCommand, logoutCommand);

  if (!enabled) {
    return;
  }

  const output = vscode.window.createOutputChannel("HitBack");
  const log = (message: string): void => {
    output.appendLine(message);
    console.log(message);
  };

  const detector = new CursorAgentDetector(watchRoots, IGNORED_DOC_SCHEMES);
  const adPanel = new AdPanel();
  const extensionUserId = getOrCreateUserId(context);
  const rateLimiter = RateLimiter.getInstance(context);

  let showInFlight = false;
  let lastRetryAt = 0;
  let lastAdShownAt = 0;
  let lastAuthPromptAt = 0;

  const AUTH_PROMPT_COOLDOWN_MS = 60_000;

  function isAuthError(error?: string): boolean {
    if (!error) {
      return false;
    }
    const lower = error.toLowerCase();
    return error.includes("HTTP 401") || lower.includes("sign in required");
  }

  async function handleAuthFailure(source: string, error?: string): Promise<void> {
    log(`[HitBack] Sign-in required (${source}): ${error ?? "session expired"}`);
    await authService.clearSession();

    const now = Date.now();
    if (now - lastAuthPromptAt < AUTH_PROMPT_COOLDOWN_MS) {
      return;
    }
    lastAuthPromptAt = now;
    void authService.promptSignIn();
  }

  function getCooldownRemainingMs(): number {
    if (lastAdShownAt === 0) {
      return 0;
    }
    return Math.max(0, PANEL_COOLDOWN_MS - (Date.now() - lastAdShownAt));
  }

  function promptLoginIfNeeded(): void {
    void authService.promptSignIn();
  }

  async function showAdFromBurst(reason: string): Promise<void> {
    if (showInFlight) {
      return;
    }

    if (!authService.isAuthenticated()) {
      log(`[HitBack] Sign-in required. Skipping: ${reason}`);
      return;
    }

    const cooldownRemaining = getCooldownRemainingMs();
    if (cooldownRemaining > 0) {
      log(
        `[HitBack] Cooldown active (${Math.ceil(cooldownRemaining / 1000)}s left). Skipping: ${reason}`
      );
      return;
    }

    if (!rateLimiter.canShowAd()) {
      log(
        `[HitBack] Rate limit reached (${rateLimiter.getImpressionCount()}/${rateLimiter.getLimit()} this hour). Skipping: ${reason}`
      );
      return;
    }
    if (adPanel.isOpen()) {
      return;
    }

    showInFlight = true;
    try {
      const backendUrl = getBackendUrl();
      const token = authService.getToken() || undefined;
      const { ad: fetchedAd, error } = await fetchCurrentAd(
        backendUrl,
        extensionUserId,
        token
      );

      if (!fetchedAd) {
        log(`[HitBack] Ad fetch failed (${reason}): ${error ?? "unknown error"}`);
        log(`[HitBack] Backend URL: ${backendUrl}`);
        if (isAuthError(error)) {
          await handleAuthFailure(reason, error);
        }
        return;
      }

      adPanel.show(fetchedAd);

      log(
        `[HitBack] Ad panel opened (${reason}): "${fetchedAd.text}" (id: ${fetchedAd.id})`
      );

      const impResult = await reportImpression(
        backendUrl,
        fetchedAd.impressionToken!,
        token
      );

      if (!impResult.ok) {
        log(`[HitBack] Impression report failed: ${impResult.error ?? "unknown error"}`);
        if (isAuthError(impResult.error)) {
          await handleAuthFailure("impression", impResult.error);
        }
        adPanel.hide();
        return;
      }

      rateLimiter.recordImpression();
      lastAdShownAt = Date.now();
      log(
        `[HitBack] Impression recorded. Cooldown started (${PANEL_COOLDOWN_MS / 1000}s until next ad)`
      );
    } finally {
      showInFlight = false;
    }
  }

  // --- Agent Start: fetch and show an ad ---
  const startListener = detector.onAgentStart(() => {
    void showAdFromBurst("agent-start");
  });

  const stopListener = detector.onAgentStop(() => {
    adPanel.hide();
    log("[HitBack] Agent stopped — ad panel closed");
  });

  // Retry if agent is active but the panel never opened (rate limit race, missed burst, etc.)
  const docEditRetry = vscode.workspace.onDidChangeTextDocument((e) => {
    if (IGNORED_DOC_SCHEMES.has(e.document.uri.scheme)) {
      return;
    }
    if (!detector.isActive || adPanel.isOpen()) {
      return;
    }

    const now = Date.now();
    if (now - lastRetryAt < 3000) {
      return;
    }
    lastRetryAt = now;
    log("[HitBack] Agent active, panel closed — retrying ad show after doc edit");
    void showAdFromBurst("doc-edit-retry");
  });

  const clickCommand = vscode.commands.registerCommand(
    "hitback.adClick",
    async () => {
      const token = authService.getToken() || undefined;
      const ad = adPanel.getAd();
      if (!ad?.clickToken) {
        return;
      }

      log(`[HitBack] Ad clicked: "${ad.text}" → ${ad.url}`);

      const backendUrl = getBackendUrl();
      const clickResult = await reportClick(backendUrl, ad.clickToken, token);
      if (!clickResult.ok) {
        log(`[HitBack] Click report failed: ${clickResult.error ?? "unknown error"}`);
      }
    }
  );

  const testCommand = vscode.commands.registerCommand(
    "hitback.testAd",
    async () => {
      if (!authService.isAuthenticated()) {
        promptLoginIfNeeded();
        return;
      }

      log("[HitBack:Test] Manually triggering ad fetch...");
      output.show(true);

      const backendUrl = getBackendUrl();
      const token = authService.getToken() || undefined;
      const { ad: fetchedAd, error } = await fetchCurrentAd(
        backendUrl,
        extensionUserId,
        token
      );

      if (!fetchedAd) {
        log(`[HitBack:Test] Ad fetch failed: ${error ?? "unknown error"}`);
        log(`[HitBack:Test] Backend URL: ${backendUrl}`);
        if (isAuthError(error)) {
          await handleAuthFailure("test-ad", error);
          return;
        }
        void vscode.window.showErrorMessage(
          `HitBack: could not fetch ad — ${error ?? "check Output → HitBack"}`
        );
        return;
      }

      adPanel.show(fetchedAd);
      log(`[HitBack:Test] Panel shown — "${fetchedAd.text}"`);
      log(
        `[HitBack:Test] Agent ads this hour: ${rateLimiter.getImpressionCount()}/${rateLimiter.getLimit()} (Test Ad does not count)`
      );
      void vscode.window.showInformationMessage(
        `HitBack: ad panel opened beside your editor — tab "Sponsored"`
      );
    }
  );

  const resetLimitCommand = vscode.commands.registerCommand(
    "hitback.resetRateLimit",
    async () => {
      await rateLimiter.reset();
      log("[HitBack] Rate limit counter reset.");
      void vscode.window.showInformationMessage("HitBack: rate limit reset — agent ads can show again.");
    }
  );

  context.subscriptions.push(
    output,
    clickCommand,
    testCommand,
    resetLimitCommand,
    stopListener,
    startListener,
    docEditRetry,
    detector
  );

  if (authService.isAuthenticated()) {
    log(`[HitBack] Extension activated — signed in, user: ${extensionUserId.slice(0, 8)}…`);
  } else {
    log("[HitBack] Extension activated — sign in required before ads show");
    promptLoginIfNeeded();
  }
}

export function deactivate(): void {
  console.log("[HitBack] Extension deactivated");
}
