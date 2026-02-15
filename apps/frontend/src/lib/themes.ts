export interface KortixTheme {
  id: string;
  name: string;
  /** Hex color for the accent dot in the theme picker */
  accentColor: string;
  description: string;
}

export const DEFAULT_THEME_ID = 'graphite';

export const THEMES: KortixTheme[] = [
  {
    id: 'graphite',
    name: 'Default',
    accentColor: '#6B7280',
    description: 'Clean, minimal, no distractions',
  },
  {
    id: 'ember',
    name: 'Ember',
    accentColor: '#E8572A',
    description: 'Warm and fiery tones',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    accentColor: '#34D399',
    description: 'Northern lights, organic greens',
  },
  {
    id: 'nebula',
    name: 'Nebula',
    accentColor: '#A78BFA',
    description: 'Cosmic purples, deep space',
  },
  {
    id: 'meridian',
    name: 'Meridian',
    accentColor: '#14B8A6',
    description: 'Ocean teal, refreshing currents',
  },
  {
    id: 'solstice',
    name: 'Solstice',
    accentColor: '#F59E0B',
    description: 'Golden amber sunshine',
  },
  {
    id: 'coral-reef',
    name: 'Coral Reef',
    accentColor: '#F87171',
    description: 'Vibrant tropical coral',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    accentColor: '#6366F1',
    description: 'Deep indigo night sky',
  },
  {
    id: 'tundra',
    name: 'Tundra',
    accentColor: '#64748B',
    description: 'Cool muted slate',
  },
  {
    id: 'sakura',
    name: 'Sakura',
    accentColor: '#EC4899',
    description: 'Cherry blossom pink',
  },
  {
    id: 'verdant',
    name: 'Verdant',
    accentColor: '#10B981',
    description: 'Lush emerald forest',
  },
  {
    id: 'copper',
    name: 'Copper',
    accentColor: '#D97706',
    description: 'Warm metallic earth',
  },
  {
    id: 'arctic',
    name: 'Arctic',
    accentColor: '#06B6D4',
    description: 'Icy cyan, crisp and cool',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    accentColor: '#7C3AED',
    description: 'Deep luxurious violet',
  },
  {
    id: 'sandstorm',
    name: 'Sandstorm',
    accentColor: '#CA8A04',
    description: 'Desert warmth and gold',
  },
  {
    id: 'neon-mint',
    name: 'Neon Mint',
    accentColor: '#2DD4BF',
    description: 'Fresh electric mint',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    accentColor: '#DC2626',
    description: 'Bold and powerful red',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    accentColor: '#F43F5E',
    description: 'Sunset rose tones',
  },
  {
    id: 'fossil',
    name: 'Fossil',
    accentColor: '#78716C',
    description: 'Earthy stone warmth',
  },
  {
    id: 'pride',
    name: 'Pride',
    accentColor: '#E040A0',
    description: 'Rainbow pride celebration',
  },
];

export function getThemeById(id: string): KortixTheme | undefined {
  return THEMES.find((t) => t.id === id);
}

/** Returns the CSS class name for a theme, or undefined for the default theme */
export function getThemeClassName(id: string): string | undefined {
  if (id === DEFAULT_THEME_ID) return undefined;
  return `theme-${id}`;
}

/** Returns all non-default theme class names (for cleanup) */
export function getAllThemeClassNames(): string[] {
  return THEMES.filter((t) => t.id !== DEFAULT_THEME_ID).map(
    (t) => `theme-${t.id}`
  );
}
