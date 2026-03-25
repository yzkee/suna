import { Audio } from 'expo-av';
import { useSoundStore, type SoundEvent } from '@/stores/sound-store';

const SOUND_ASSETS: Record<string, Record<string, any>> = {
  kortix: {
    completion: require('@/assets/sounds/kortix/completion.mp3'),
    send: require('@/assets/sounds/kortix/send.mp3'),
  },
};

const soundCache = new Map<string, Audio.Sound>();

async function loadSound(pack: string, event: SoundEvent): Promise<Audio.Sound | null> {
  const key = `${pack}/${event}`;
  const cached = soundCache.get(key);
  if (cached) return cached;

  const asset = SOUND_ASSETS[pack]?.[event];
  if (!asset) return null;

  try {
    const { sound } = await Audio.Sound.createAsync(asset);
    soundCache.set(key, sound);
    return sound;
  } catch {
    return null;
  }
}

export async function playSound(event: SoundEvent) {
  const { preferences } = useSoundStore.getState();
  if (preferences.pack === 'off') return;
  if (preferences.events[event] === false) return;
  if (preferences.volume <= 0) return;

  const sound = await loadSound(preferences.pack, event);
  if (!sound) return;

  try {
    await sound.setVolumeAsync(preferences.volume);
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // Silently ignore playback errors
  }
}

export async function previewSound(event: SoundEvent) {
  const { preferences } = useSoundStore.getState();
  const pack = preferences.pack === 'off' ? 'kortix' : preferences.pack;
  const volume = Math.max(preferences.pack === 'off' ? 0.5 : preferences.volume, 0.2);

  const sound = await loadSound(pack, event);
  if (!sound) return;

  try {
    await sound.setVolumeAsync(volume);
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // Silently ignore playback errors
  }
}
