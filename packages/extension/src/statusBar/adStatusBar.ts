import * as vscode from "vscode";
import { Ad } from "../ads/types";

/**
 * Manages the sponsored ad status bar item.
 * Renders on the right side with a megaphone icon.
 */
export class AdStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  /** The currently displayed ad (if any). */
  private currentAd: Ad | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000 // High priority = appears prominently
    );
  }

  /**
   * Show a sponsored ad in the status bar.
   */
  showAd(ad: Ad): void {
    this.currentAd = ad;
    this.item.text = `$(megaphone) ${ad.text}`;
    this.item.tooltip = "Sponsored · Click to visit";
    this.item.command = "hitback.adClick";
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    this.item.show();
  }

  /**
   * Hide the ad from the status bar.
   */
  hide(): void {
    this.currentAd = null;
    this.item.hide();
  }

  /**
   * Get the currently displayed ad.
   */
  getAd(): Ad | null {
    return this.currentAd;
  }

  dispose(): void {
    this.item.dispose();
  }
}
