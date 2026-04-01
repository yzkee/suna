import type { ChannelType } from '@/hooks/channels';

export const DEFAULT_CHANNEL_AGENT = 'kortix';

export function buildDefaultChannelInstructions(channelType: ChannelType, channelName?: string) {
  const label = channelName?.trim() || channelType;
  return [
    `You are an AI agent responding via ${label}.`,
    'Keep responses concise and chat-appropriate.',
    'Use short paragraphs and short bullet points when helpful.',
    'Do not explain internal system behavior unless the user asks.',
    'If the user asks for actions, be direct and practical.',
  ].join(' ');
}
