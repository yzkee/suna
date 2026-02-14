/**
 * Adapter registry.
 *
 * Returns a Map of channel type → adapter instance.
 * New adapters are added here as they're implemented.
 */

import type { ChannelAdapter } from './base';
import type { ChannelType } from '../types';
import { TelegramAdapter } from './telegram/adapter';
import { SlackAdapter } from './slack/adapter';

export function createAdapters(): Map<ChannelType, ChannelAdapter> {
  const adapters = new Map<ChannelType, ChannelAdapter>();

  adapters.set('telegram', new TelegramAdapter());
  adapters.set('slack', new SlackAdapter());
  // adapters.set('discord', new DiscordAdapter());

  return adapters;
}
