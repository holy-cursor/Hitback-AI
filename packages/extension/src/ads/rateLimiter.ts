import * as vscode from "vscode";
import { MAX_ADS_PER_HOUR } from "../config";

const STATE_KEY = "hitback.impressionHistory";

/**
 * Client-side rate limiter — caps ad impressions per rolling hour.
 */
export class RateLimiter {
  private static instance: RateLimiter;

  private constructor(private readonly context: vscode.ExtensionContext) {}

  public static getInstance(context: vscode.ExtensionContext): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter(context);
    }
    return RateLimiter.instance;
  }

  private getCleanHistory(): number[] {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const history = this.context.globalState.get<number[]>(STATE_KEY, []);
    const cleanHistory = history.filter((time) => time > oneHourAgo);

    if (cleanHistory.length !== history.length) {
      void this.context.globalState.update(STATE_KEY, cleanHistory);
    }

    return cleanHistory;
  }

  public canShowAd(): boolean {
    return this.getCleanHistory().length < MAX_ADS_PER_HOUR;
  }

  public getImpressionCount(): number {
    return this.getCleanHistory().length;
  }

  public getLimit(): number {
    return MAX_ADS_PER_HOUR;
  }

  public async reset(): Promise<void> {
    await this.context.globalState.update(STATE_KEY, []);
  }

  public recordImpression(): void {
    const history = this.getCleanHistory();
    history.push(Date.now());
    void this.context.globalState.update(STATE_KEY, history);

    console.log(
      `[HitBack:RateLimiter] Impression recorded. Count this hour: ${history.length}/${MAX_ADS_PER_HOUR}`
    );
  }
}
