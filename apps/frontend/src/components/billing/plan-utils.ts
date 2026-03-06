import { siteConfig } from '@/lib/site-config';

/**
 * Helper function to get plan name - uses tier_key to match cloudPricingItems tier name
 * 
 * @param subscriptionData - Subscription data from API
 * @param isLocal - Whether running in local mode
 * @returns The display name of the plan (e.g., 'Free', 'Pro')
 */
export function getPlanName(subscriptionData: any, isLocal: boolean = false): string {
  if (isLocal) return 'Pro';

  // Handle null/undefined subscription data
  if (!subscriptionData) {
    return 'Free';
  }

  // Handle free tier explicitly
  if (subscriptionData?.tier?.name === 'free' || subscriptionData?.tier_key === 'free') {
    return 'Free';
  }

  // Handle pro tier explicitly
  if (subscriptionData?.tier?.name === 'pro' || subscriptionData?.tier_key === 'pro') {
    return 'Pro';
  }

  // Try to match tier_key to cloudPricingItems to get the frontend tier name
  const tierKey = subscriptionData?.tier_key || subscriptionData?.tier?.name || subscriptionData?.plan_name;
  
  const currentTier = siteConfig.cloudPricingItems.find(
    (p) => p.tierKey === tierKey
  );

  // Return the frontend tier name or fallback to backend display name
  return currentTier?.name || subscriptionData?.display_plan_name || subscriptionData?.tier?.display_name || 'Free';
}

/**
 * Helper function to get plan icon - maps frontend tier names to icon paths
 * 
 * @param planName - The plan name (e.g., 'Free', 'Pro')
 * @param isLocal - Whether running in local mode
 * @returns The path to the plan icon SVG, or null if no icon exists
 */
export function getPlanIcon(planName: string, isLocal: boolean = false): string | null {
  if (isLocal) return '/plan-icons/pro.svg';

  const plan = planName?.toLowerCase();

  // Free tier
  if (plan?.includes('free') || plan?.includes('basic')) {
    return '/plan-icons/basic.svg';
  }

  // Pro tier (also matches legacy Plus/Ultra/Business/Enterprise/Scale/Max)
  if (plan?.includes('pro') || plan?.includes('ultra') || plan?.includes('plus') || plan?.includes('business') || plan?.includes('enterprise') || plan?.includes('scale') || plan?.includes('max')) {
    return '/plan-icons/pro.svg';
  }

  // Default to null for any unrecognized plans
  return null;
}

