export const INSTANCE_CONFIG = {
  defaultRegion: 'hil',
  defaultServerType: null as string | null,
  regions: [
    { id: 'hil', label: 'United States', shorthand: 'US', icon: '\u{1F1FA}\u{1F1F8}', lat: 45.5231, lng: -122.6765, phi: 2.1, theta: 0.25 },
    { id: 'hel1', label: 'Europe', shorthand: 'EU', icon: '\u{1F1EA}\u{1F1FA}', lat: 60.1699, lng: 24.9384, phi: 5.85, theta: 0.35 },
  ],
  regionPickerEnabled: true,
} as const;

export type RegionId = typeof INSTANCE_CONFIG.regions[number]['id'];
export type RegionInfo = typeof INSTANCE_CONFIG.regions[number];
