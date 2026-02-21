// Subscription tier structure - tier keys only, no price IDs
export interface SubscriptionTierData {
  tierKey: string;  // Backend tier key like 'free', 'tier_2_20', etc.
  name: string;     // Display name like 'Basic', 'Plus', 'Pro'
}

// Subscription tiers structure - ONLY tier keys, price IDs come from backend
export interface SubscriptionTiers {
  FREE_TIER: SubscriptionTierData;
  TIER_2_20: SubscriptionTierData;
  TIER_6_50: SubscriptionTierData;
  TIER_12_100: SubscriptionTierData;
  TIER_25_200: SubscriptionTierData;
  TIER_50_400: SubscriptionTierData;
  TIER_125_800: SubscriptionTierData;
  TIER_200_1000: SubscriptionTierData;
}

// Configuration object
interface Config {
  SUBSCRIPTION_TIERS: SubscriptionTiers;
  /** Whether billing/payments are enabled (Stripe, credit tracking, etc.) */
  BILLING_ENABLED: boolean;
}

// Tier keys - single source, no environment-specific price IDs
const TIERS: SubscriptionTiers = {
  FREE_TIER: {
    tierKey: 'free',
    name: 'Basic/$0',
  },
  TIER_2_20: {
    tierKey: 'tier_2_20',
    name: 'Plus/$20',
  },
  TIER_6_50: {
    tierKey: 'tier_6_50',
    name: 'Pro/$50',
  },
  TIER_12_100: {
    tierKey: 'tier_12_100',
    name: 'Business/$100',
  },
  TIER_25_200: {
    tierKey: 'tier_25_200',
    name: 'Ultra/$200',
  },
  TIER_50_400: {
    tierKey: 'tier_50_400',
    name: 'Enterprise/$400',
  },
  TIER_125_800: {
    tierKey: 'tier_125_800',
    name: 'Scale/$800',
  },
  TIER_200_1000: {
    tierKey: 'tier_200_1000',
    name: 'Max/$1000',
  },
} as const;

export const config: Config = {
  SUBSCRIPTION_TIERS: TIERS,
  BILLING_ENABLED: process.env.NEXT_PUBLIC_BILLING_ENABLED === 'true',
};

/**
 * Whether billing (Stripe, credit tracking, download restrictions) is enabled.
 * Self-hosted deployments set NEXT_PUBLIC_BILLING_ENABLED=false (or omit it)
 * to disable all billing UI and restrictions. Defaults to false.
 */
export const isBillingEnabled = (): boolean => {
  return config.BILLING_ENABLED;
};

/**
 * Whether this is a self-hosted deployment.
 * Derived from billing: if billing is disabled, it's self-hosted.
 * Self-hosted mode uses email+password auth (no magic links, no OAuth).
 * The first user to sign up becomes the owner.
 */
export const isSelfHosted = (): boolean => {
  return !config.BILLING_ENABLED;
};

