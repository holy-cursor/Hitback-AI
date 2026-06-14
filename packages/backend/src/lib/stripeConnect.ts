import Stripe from "stripe";

export interface ConnectAccountStatus {
  hasAccount: boolean;
  accountId: string | null;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
  readyForPayouts: boolean;
  requiresAction: boolean;
}

export async function fetchConnectAccountStatus(
  stripe: InstanceType<typeof Stripe>,
  accountId: string | null | undefined
): Promise<ConnectAccountStatus> {
  const empty: ConnectAccountStatus = {
    hasAccount: false,
    accountId: null,
    detailsSubmitted: false,
    payoutsEnabled: false,
    transfersActive: false,
    readyForPayouts: false,
    requiresAction: false,
  };

  if (!accountId) return empty;

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const transfersActive = account.capabilities?.transfers === "active";
    const payoutsEnabled = !!account.payouts_enabled;
    const detailsSubmitted = !!account.details_submitted;
    const requiresAction =
      !detailsSubmitted ||
      (account.requirements?.currently_due?.length ?? 0) > 0 ||
      account.capabilities?.transfers === "inactive";

    return {
      hasAccount: true,
      accountId,
      detailsSubmitted,
      payoutsEnabled,
      transfersActive,
      readyForPayouts: transfersActive && payoutsEnabled && detailsSubmitted,
      requiresAction,
    };
  } catch {
    return empty;
  }
}
