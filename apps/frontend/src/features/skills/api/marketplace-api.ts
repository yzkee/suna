/**
 * Marketplace API — fetches all components from the OCX registry.
 *
 * Registry URL: https://master.kortix-registry.pages.dev
 * - GET /index.json → list of ALL components (skills, agents, tools, etc.)
 * - GET /components/{name}.json → component details
 * - GET /components/{name}/{type}/{name}/SKILL.md → skill content
 */

const REGISTRY_URL = 'https://master.kortix-registry.pages.dev';

export type ComponentType = 'ocx:skill' | 'ocx:agent' | 'ocx:tool' | 'ocx:plugin' | string;

export interface RegistryComponent {
  name: string;
  version: string;
  type: ComponentType;
  description: string;
}

export interface RegistryComponentVersion extends RegistryComponent {
  files: string[];
  dist?: {
    tarball?: string;
  };
  repository?: {
    type?: string;
    url?: string;
  };
}

export interface RegistryComponentDetails {
  name: string;
  description: string;
  repository?: string;
  'dist-tags'?: {
    latest?: string;
  };
  versions: Record<string, RegistryComponentVersion>;
}

export interface RegistryComponentFile {
  path: string;
  content: string;
}

export interface RegistryComponentBundle {
  manifest: RegistryComponentDetails;
  version: RegistryComponentVersion;
  files: RegistryComponentFile[];
}

export interface RegistryIndex {
  name: string;
  version: string;
  namespace: string;
  author: string;
  description: string;
  components: RegistryComponent[];
}

/**
 * Fetch the registry index to get ALL available components.
 */
export async function fetchRegistryComponents(): Promise<RegistryComponent[]> {
  const response = await fetch(`${REGISTRY_URL}/index.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry: ${response.statusText}`);
  }
  
  const data: RegistryIndex = await response.json();
  return data.components;
}

/**
 * Fetch all skills only (for backwards compatibility).
 */
export async function fetchRegistrySkills(): Promise<RegistryComponent[]> {
  const components = await fetchRegistryComponents();
  return components.filter(c => c.type === 'ocx:skill');
}

/**
 * Get the full component details.
 */
export async function fetchComponentDetails(componentName: string): Promise<RegistryComponent | null> {
  const response = await fetch(`${REGISTRY_URL}/components/${componentName}.json`);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch component: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data;
}

export async function fetchComponentBundle(componentName: string): Promise<RegistryComponentBundle> {
  const response = await fetch(`${REGISTRY_URL}/components/${componentName}.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch component details: ${response.statusText}`);
  }

  const manifest: RegistryComponentDetails = await response.json();
  const latestVersion = manifest['dist-tags']?.latest;
  if (!latestVersion) {
    throw new Error('Component does not declare a latest version');
  }

  const version = manifest.versions[latestVersion];
  if (!version) {
    throw new Error(`Missing version payload for ${latestVersion}`);
  }

  const files = await Promise.all(
    (version.files ?? []).map(async (path) => {
      const fileResponse = await fetch(`${REGISTRY_URL}/components/${componentName}/${path}`);
      if (!fileResponse.ok) {
        return {
          path,
          content: `Unable to load file (${fileResponse.status})`,
        } satisfies RegistryComponentFile;
      }

      return {
        path,
        content: await fileResponse.text(),
      } satisfies RegistryComponentFile;
    }),
  );

  return {
    manifest,
    version,
    files,
  };
}
