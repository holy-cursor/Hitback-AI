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
      this.panel.reveal(vscode.ViewColumn.One, true);
      return;
    }

    console.log("[HitBack:Panel] Creating webview panel...");

    this.panel = vscode.window.createWebviewPanel(
      "hitback.adPanel",
      "📢 Sponsored",
      {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtml(ad);

    // Force to front
    this.panel.reveal(vscode.ViewColumn.One, true);
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    background: #0a0a0f;
    color: #fff;
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

  /* ── ambient glow ── */
  body::before {
    content: '';
    position: absolute;
    top: 20%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 70%);
    pointer-events: none;
  }

  /* ── pulsing live indicator ── */
  .live {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: rgba(255,255,255,.4);
  }
  .live-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34,197,94,.5);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: .4; transform: scale(.8); }
  }

  /* ── sponsored badge ── */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(167,139,250,.9);
    background: rgba(167,139,250,.1);
    border: 1px solid rgba(167,139,250,.15);
    padding: 4px 12px;
    border-radius: 20px;
  }

  /* ── hero image ── */
  .hero-image {
    max-width: 100%;
    max-height: 160px;
    width: auto;
    border-radius: 12px;
    object-fit: contain;
    box-shadow: 0 8px 24px rgba(0,0,0,.35);
  }

  /* ── headline ── */
  .headline {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.3;
    text-align: center;
    max-width: 360px;
    background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 40%, #a5b4fc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* ── CTA button ── */
  .cta-btn {
    margin-top: 4px;
    padding: 12px 32px;
    font-size: 14px;
    font-weight: 600;
    color: #0a0a0f;
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all .25s cubic-bezier(.4,0,.2,1);
    box-shadow: 0 4px 16px rgba(129,140,248,.3);
    position: relative;
    overflow: hidden;
  }
  .cta-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(129,140,248,.4);
  }
  .cta-btn:active {
    transform: translateY(0);
  }
  .cta-btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,.15) 50%, transparent 60%);
    animation: btn-shimmer 3s ease-in-out infinite;
  }
  @keyframes btn-shimmer {
    0% { transform: translateX(-150%); }
    100% { transform: translateX(150%); }
  }

  /* ── footer ── */
  .footer {
    position: absolute;
    bottom: 16px;
    font-size: 10px;
    letter-spacing: .5px;
    color: rgba(255,255,255,.2);
  }

  /* ── entrance ── */
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    animation: fadeInUp .5s cubic-bezier(.4,0,.2,1);
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>

  <div class="content">
    <div class="live">
      <span class="live-dot"></span>
      Agent working
    </div>

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
