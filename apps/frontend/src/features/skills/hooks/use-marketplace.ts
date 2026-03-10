/**
 * Hook to fetch marketplace components (skills, agents, tools, plugins) from the OCX registry.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchComponentBundle,
  fetchRegistryComponents,
  type RegistryComponent,
  type RegistryComponentBundle,
} from '../api/marketplace-api';

const MARKETPLACE_KEYS = {
  all: ['marketplace', 'components'] as const,
  detail: (componentName: string) => ['marketplace', 'component', componentName] as const,
};

export function useMarketplaceSkills() {
  return useQuery({
    queryKey: MARKETPLACE_KEYS.all,
    queryFn: fetchRegistryComponents,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useIsSkillInstalled(skillName: string): boolean {
  const { data: installedSkills } = useQuery({
    queryKey: ['marketplace', 'installed-skills'],
    queryFn: async () => {
      // This would need to call the backend to list installed skills
      // For now, return empty - we'll update this later
      return [] as string[];
    },
    staleTime: 0,
  });
  
  return (installedSkills || []).includes(skillName);
}

export function useMarketplaceComponent(componentName: string | null) {
  return useQuery<RegistryComponentBundle>({
    queryKey: MARKETPLACE_KEYS.detail(componentName ?? ''),
    queryFn: () => fetchComponentBundle(componentName ?? ''),
    enabled: Boolean(componentName),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}

export { type RegistryComponent, type RegistryComponentBundle } from '../api/marketplace-api';
