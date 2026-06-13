/** Revenue share credited to developers per impression (60%). Platform keeps 40%. */
export const DEV_REVENUE_SHARE = 0.6;

/** Default CPM in cents ($10.00 per 1,000 impressions). */
export const DEFAULT_CPM_CENTS = 1000;

/**
 * Developer earnings in cents for a single impression at the given CPM rate.
 * @param cpmCents Cents paid per 1,000 impressions (e.g. 1000 = $10.00 CPM).
 */
export function devEarningsPerImpression(cpmCents: number): number {
  return Math.round((cpmCents * DEV_REVENUE_SHARE) / 1000);
}

/** Format CPM cents as a dollar display string (e.g. 500 → "$5.00"). */
export function formatCpmDisplay(cpmCents: number): string {
  return `$${(cpmCents / 100).toFixed(2)}`;
}
