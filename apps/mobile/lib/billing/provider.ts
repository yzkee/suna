export type BillingProvider = 'revenuecat' | 'none';

/**
 * Use RevenueCat only when billing is enabled (cloud mode).
 * Self-hosted / local dev: billing is disabled.
 */
export function shouldUseRevenueCat(): boolean {
  const useRC = process.env.EXPO_PUBLIC_USE_REVENUECAT;
  const billingEnabled = process.env.EXPO_PUBLIC_BILLING_ENABLED;
  // Disabled if either flag is explicitly "false" or not set
  if (useRC === 'false' || billingEnabled === 'false') return false;
  return useRC === 'true';
}

// Legacy aliases for backwards compatibility
export const isRevenueCatConfigured = shouldUseRevenueCat;
export const getBillingProvider = (): BillingProvider => 'revenuecat';
export const shouldUseStripe = () => false;
