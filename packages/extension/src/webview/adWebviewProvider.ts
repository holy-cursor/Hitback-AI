import * as vscode from "vscode";
import { Ad } from "../ads/types";

/**
 * Panel webview provider for displaying a compact sponsored ad banner.
 * Lives in the bottom panel (alongside Terminal/Output).
 * Shows a single-line horizontal banner when the agent is active.
 */
export class AdSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "hitback.adSidebar";

  private _view: vscode.WebviewView | undefined;
  private _currentAd: Ad | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    // Handle click messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === "adClick") {
        vscode.commands.executeCommand("hitback.adClick");
      }
    });

    // Show current state
    this._render();
  }

  /** Show an ad banner in the panel. */
  showAd(ad: Ad): void {
    this._currentAd = ad;
    this._render();
    if (this._view) {
      this._view.show?.(true); // true = preserve focus
    }
  }

  /** Return to idle state. */
  hide(): void {
    this._currentAd = null;
    this._render();
  }

  /** Get the currently displayed ad. */
  getAd(): Ad | null {
    return this._currentAd;
  }

  private _render(): void {
    if (!this._view) {
      return;
    }
    this._view.webview.html = this._currentAd
      ? this._adHtml(this._currentAd)
      : this._idleHtml();
  }

  // ── Compact Banner HTML ────────────────────────────────────

  private _adHtml(ad: Ad): string {
    const text = this._esc(ad.text);
    const url = JSON.stringify(ad.url);
    const id = JSON.stringify(ad.id);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}

  body{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--vscode-panel-background, var(--vscode-sideBar-background));
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    min-height: 100vh;
    padding: 0 12px;
  }

  .banner{
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 14px;
    background: linear-gradient(90deg,
      rgba(99,102,241,.08) 0%,
      rgba(139,92,246,.08) 50%,
      rgba(236,72,153,.04) 100%);
    border: 1px solid rgba(139,92,246,.18);
    border-radius: 8px;
    cursor: pointer;
    transition: all .2s ease;
    position: relative;
    overflow: hidden;
    animation: fadeIn .3s ease-out;
  }
  .banner::after{
    content:'';position:absolute;inset:0;
    background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.02) 50%,transparent 60%);
    animation: shimmer 5s ease-in-out infinite;
  }
  @keyframes shimmer{
    0%{transform:translateX(-150%)}
    100%{transform:translateX(150%)}
  }
  @keyframes fadeIn{
    from{opacity:0;transform:translateY(4px)}
    to{opacity:1;transform:translateY(0)}
  }
  .banner:hover{
    border-color:rgba(139,92,246,.4);
    box-shadow:0 2px 12px rgba(139,92,246,.1);
  }

  .dot{
    width:6px;height:6px;border-radius:50%;
    background:#22c55e;flex-shrink:0;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse{
    0%,100%{opacity:1;transform:scale(1)}
    50%{opacity:.4;transform:scale(.8)}
  }

  .badge{
    font-size:9px;font-weight:700;letter-spacing:.6px;
    text-transform:uppercase;
    color:rgba(167,139,250,.9);
    background:rgba(167,139,250,.1);
    padding:2px 7px;border-radius:4px;
    flex-shrink:0;white-space:nowrap;
  }

  .text{
    font-size:12px;font-weight:500;
    color:var(--vscode-foreground);
    flex:1;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;
  }

  .cta{
    font-size:11px;font-weight:600;
    color:rgba(129,140,248,1);
    flex-shrink:0;white-space:nowrap;
    display:flex;align-items:center;gap:4px;
  }
  .arrow{transition:transform .2s ease}
  .banner:hover .arrow{transform:translateX(3px)}
</style>
</head>
<body>
  <div class="banner" onclick="handleClick()">
    <span class="dot"></span>
    <span class="badge">Sponsored</span>
    <span class="text">${text}</span>
    <span class="cta">Visit <span class="arrow">\u2192</span></span>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function handleClick(){
      vscode.postMessage({type:'adClick',url:${url},id:${id}});
    }
  </script>
</body>
</html>`;
  }

  // ── Idle State HTML ───────────────────────────────────────

  private _idleHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--vscode-panel-background, var(--vscode-sideBar-background));
    color: var(--vscode-descriptionForeground);
    display:flex;align-items:center;justify-content:center;
    min-height:100vh;padding:0 12px;
  }
  .idle{display:flex;align-items:center;gap:8px;font-size:11px;opacity:.4}
</style>
</head>
<body>
  <div class="idle">Ads appear here when the AI agent is working</div>
</body>
</html>`;
  }

  private _esc(s: string): string {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;")
            .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
}
