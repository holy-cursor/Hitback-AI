/** Rolling window for per-campaign impression share pacing. */
export const PACING_WINDOW_MS = 60 * 60 * 1000;

/** Max share of window impressions any single campaign may hold before pacing out. */
export const PACING_MAX_SHARE = 0.7;

export interface CpmWeighted {
  id: string;
  cpm_cents: number;
}

/**
 * Pick one item with probability proportional to cpm_cents.
 * Sum CPMs, draw in [0, sum), walk cumulatively.
 */
export function pickWeightedByCpm<T extends CpmWeighted>(items: T[]): T | null {
  if (items.length === 0) {
    return null;
  }
  if (items.length === 1) {
    return items[0];
  }

  const totalWeight = items.reduce((sum, item) => sum + item.cpm_cents, 0);
  if (totalWeight <= 0) {
    return items[0];
  }

  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= item.cpm_cents;
    if (roll <= 0) {
      return item;
    }
  }

  return items[items.length - 1];
}

/**
 * Remove campaigns that already hold >= maxShare of recent impressions.
 * If every campaign is over the cap, return the original pool (unavoidable with one dominant bidder).
 */
export function applyPacingCap<T extends { id: string }>(
  campaigns: T[],
  impressionCounts: Map<string, number>,
  maxShare: number = PACING_MAX_SHARE
): T[] {
  if (campaigns.length <= 1) {
    return campaigns;
  }

  const total = campaigns.reduce(
    (sum, campaign) => sum + (impressionCounts.get(campaign.id) || 0),
    0
  );
  if (total === 0) {
    return campaigns;
  }

  const eligible = campaigns.filter((campaign) => {
    const share = (impressionCounts.get(campaign.id) || 0) / total;
    return share < maxShare;
  });

  return eligible.length > 0 ? eligible : campaigns;
}
