import * as vscode from 'vscode';

/**
 * Client-Side Rate Limiter
 * 
 * Prevents the extension from fetching ads or showing the panel
 * if the user triggers too many bursts. This protects the backend
 * from spam and saves server costs.
 */
export class RateLimiter {
  private static instance: RateLimiter;
  private context: vscode.ExtensionContext;
  
  // Rate limits
  private readonly MAX_PER_HOUR = 25;
  private readonly STATE_KEY = 'hitback.impressionHistory';

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public static getInstance(context: vscode.ExtensionContext): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter(context);
    }
    return RateLimiter.instance;
  }

  /**
   * Retrieves the history of impression timestamps (in milliseconds).
   * Cleans out timestamps that are older than 1 hour.
   */
  private getCleanHistory(): number[] {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    const history = this.context.globalState.get<number[]>(this.STATE_KEY, []);
    
    // Filter out anything older than 1 hour
    const cleanHistory = history.filter(time => time > oneHourAgo);
    
    // If we cleaned things out, save the state to avoid memory bloat
    if (cleanHistory.length !== history.length) {
      this.context.globalState.update(this.STATE_KEY, cleanHistory);
    }
    
    return cleanHistory;
  }

  /**
   * Checks if we are currently under the rate limit cap.
   */
  public canShowAd(): boolean {
    const history = this.getCleanHistory();
    return history.length < this.MAX_PER_HOUR;
  }

  /**
   * Records a new impression timestamp.
   */
  public recordImpression(): void {
    const history = this.getCleanHistory();
    history.push(Date.now());
    this.context.globalState.update(this.STATE_KEY, history);
    
    console.log(`[HitBack:RateLimiter] Impression recorded. Count this hour: ${history.length}/${this.MAX_PER_HOUR}`);
  }
}
