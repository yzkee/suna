/**
 * Runtime types for the channels sub-service.
 * DB types come from @kortix/db — these are used by the engine and adapters.
 */

export type ChannelType =
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'whatsapp'
  | 'teams'
  | 'voice'
  | 'email'
  | 'sms';

export type SessionStrategy = 'single' | 'per-thread' | 'per-user' | 'per-message';

export type ChatType = 'dm' | 'group' | 'channel';

export type MessageDirection = 'inbound' | 'outbound';

export interface Attachment {
  type: 'image' | 'file' | 'audio' | 'video' | 'sticker';
  url?: string;
  mimeType?: string;
  name?: string;
  size?: number;
}

export interface NormalizedMessage {
  /** Unique ID from the external platform */
  externalId: string;
  /** Channel type this message came from */
  channelType: ChannelType;
  /** The channel config ID this message belongs to */
  channelConfigId: string;
  /** DM, group, or channel */
  chatType: ChatType;
  /** Text content */
  content: string;
  /** File/media attachments */
  attachments: Attachment[];
  /** Info about the sender */
  platformUser: {
    id: string;
    name: string;
    avatar?: string;
  };
  /** Thread or conversation ID (platform-specific) */
  threadId?: string;
  /** Group/channel ID (for group messages) */
  groupId?: string;
  /** Whether the bot was explicitly mentioned */
  isMention?: boolean;
  /** Raw platform payload for debugging */
  raw?: unknown;
}

export interface AgentResponse {
  /** The full text response from the agent */
  content: string;
  /** Session ID used for this interaction */
  sessionId: string;
  /** Whether the response was truncated */
  truncated?: boolean;
}

export interface ChannelCapabilities {
  /** Max text length per message */
  textChunkLimit: number;
  /** Whether the platform supports markdown/rich text */
  supportsRichText: boolean;
  /** Whether messages can be edited after sending */
  supportsEditing: boolean;
  /** Whether the platform supports typing indicators */
  supportsTypingIndicator: boolean;
  /** Whether the platform supports file attachments */
  supportsAttachments: boolean;
  /** 'webhook' or 'websocket' or 'polling' */
  connectionType: 'webhook' | 'websocket' | 'polling';
}

export interface SandboxTarget {
  sandboxId: string;
  baseUrl: string;
  authToken: string | null;
  provider: string;
  externalId: string | null;
}
