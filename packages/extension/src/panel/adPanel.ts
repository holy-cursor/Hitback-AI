import * as vscode from "vscode";
import { Ad } from "../ads/types";

/**
 * Opens a webview panel tab beside the active editor to display
 * a sponsored ad. The panel auto-closes when the agent stops.
 */
export class AdPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentAd: Ad | null = null;

  /**
   * Show an ad in a split editor panel.
   * If the panel is already open, just update the content.
   */
  show(ad: Ad): void {
    this.currentAd = ad;

    if (this.panel) {
      // Panel already open — update content and force to front
      this.panel.webview.html = this.getHtml(ad);
      this.panel.reveal(vscode.ViewColumn.Beside, false);
      return;
    }

    console.log("[HitBack:Panel] Creating webview panel...");

    this.panel = vscode.window.createWebviewPanel(
      "hitback.adPanel",
      "Sponsored",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtml(ad);

    // Bring panel to front so it is visible beside the editor
    this.panel.reveal(vscode.ViewColumn.Beside, false);
    console.log("[HitBack:Panel] Panel created and revealed");

    // Handle click messages from the webview
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === "click" && this.currentAd) {
        vscode.env.openExternal(vscode.Uri.parse(this.currentAd.url));
        vscode.commands.executeCommand("hitback.adClick");
      }
    });

    // If user manually closes the panel, clean up
    this.panel.onDidDispose(() => {
      console.log("[HitBack:Panel] Panel disposed");
      this.panel = undefined;
      this.currentAd = null;
    });
  }

  /** Close the ad panel. */
  hide(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
      this.currentAd = null;
    }
  }

  /** Get the currently displayed ad. */
  getAd(): Ad | null {
    return this.currentAd;
  }

  /** Whether the sponsored panel tab is open. */
  isOpen(): boolean {
    return this.panel !== undefined;
  }

  private getHtml(ad: Ad): string {
    const text = this.esc(ad.text);
    const url = JSON.stringify(ad.url);
    const imageBlock = ad.imageUrl
      ? `<img class="hero-image" src="${this.esc(ad.imageUrl)}" alt="" />`
      : "";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff;
    color: #111827;
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 20px;
    padding: 32px;
    overflow: hidden;
    position: relative;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .8px;
    text-transform: uppercase;
    color: #6b7280;
    background: #f3f4f6;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
  }

  .hero-image {
    max-width: 100%;
    max-height: 160px;
    width: auto;
    border-radius: 6px;
    object-fit: contain;
    border: 1px solid #e5e7eb;
  }

  .headline {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.35;
    text-align: center;
    max-width: 360px;
    color: #111827;
  }

  .cta-btn {
    margin-top: 4px;
    padding: 8px 20px;
    font-size: 13px;
    font-family: inherit;
    font-weight: 500;
    color: #ffffff;
    background: #111827;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background .15s ease;
  }
  .cta-btn:hover {
    background: #374151;
  }

  .footer {
    position: absolute;
    bottom: 16px;
    font-size: 11px;
    color: #9ca3af;
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    animation: fadeInUp .35s ease-out;
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>

  <div class="content">
    <div class="badge">📢 Sponsored</div>

    ${imageBlock}

    <div class="headline">${text}</div>

    <button class="cta-btn" onclick="handleClick()">Learn more →</button>
  </div>

  <div class="footer">Closes when agent finishes · Powered by HitBack</div>

  <script>
    const vscode = acquireVsCodeApi();
    function handleClick() {
      vscode.postMessage({ command: 'click', url: ${url} });
    }
  </script>
</body>
</html>`;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
