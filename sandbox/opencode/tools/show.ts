import { tool } from "@opencode-ai/plugin";
import { existsSync } from "fs";
import { resolve } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

/** Content types the show tool can present. */
const TYPES = [
  "file",
  "image",
  "url",
  "text",
  "error",
  "video",
  "audio",
  "code",
  "markdown",
  "pdf",
  "html",
] as const;
type ShowType = (typeof TYPES)[number];

/** Display variants that control how the frontend renders the output. */
const VARIANTS = [
  "compact",   // Minimal inline card — small footprint in the conversation
  "full",      // Full available space — ideal for URL previews, HTML, PDFs
  "gallery",   // Visual-first — centers content with proper aspect ratio
  "detail",    // Rich layout — prominent title, description, content sections
] as const;
type ShowVariant = (typeof VARIANTS)[number];

/** Aspect ratio presets for visual content. */
const ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:2",
  "21:9",
] as const;
type ShowAspectRatio = (typeof ASPECT_RATIOS)[number];

/** Visual theme for the output card. */
const THEMES = [
  "default",
  "success",
  "warning",
  "info",
  "danger",
] as const;
type ShowTheme = (typeof THEMES)[number];

interface ShowEntry {
  id: string;
  timestamp: string;
  type: ShowType;
  title?: string;
  description?: string;
  path?: string;
  url?: string;
  content?: string;
  variant?: ShowVariant;
  aspect_ratio?: ShowAspectRatio;
  theme?: ShowTheme;
  language?: string;
  metadata?: Record<string, unknown>;
}

function generateId(): string {
  return `show_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Infer a sensible default variant based on content type. */
function defaultVariant(type: ShowType): ShowVariant {
  switch (type) {
    case "url":
    case "html":
    case "pdf":
      return "full";
    case "image":
    case "video":
      return "gallery";
    case "code":
    case "markdown":
    case "text":
      return "detail";
    case "audio":
    case "file":
      return "compact";
    case "error":
      return "compact";
    default:
      return "detail";
  }
}

// ── Tool definition ────────────────────────────────────────────────────────

export default tool({
  description:
    "Show outputs and attachments to the human user. This is THE primary way to communicate " +
    "final deliverables to the user — images, files, documents, URLs, previews, text summaries, " +
    "code snippets, videos, audio, and errors all render in the user's UI via this tool. " +
    "ALWAYS call this after generating ANY deliverable so the human can see and interact with it. " +
    "Without calling this tool, the user cannot see your output.\n\n" +
    "Types: file, image, url, text, error, video, audio, code, markdown, pdf, html.\n" +
    "Variants (display hints): compact, full, gallery, detail — controls layout. " +
    "Defaults are smart per type but can be overridden.\n" +
    "aspect_ratio: auto, 1:1, 16:9, 9:16, 4:3, 3:2, 21:9 — for visual content.\n" +
    "theme: default, success, warning, info, danger — visual accent.\n" +
    "language: for type='code', the language for syntax highlighting (e.g. 'python', 'typescript').",
  args: {
    action: tool.schema
      .string()
      .describe("Action: 'show' to present an item to the user."),

    type: tool.schema
      .string()
      .optional()
      .describe(
        "Type of item. Required for 'show'. " +
          "Options: 'file' (any file on disk), 'image' (image file), 'url' (web link or localhost preview), " +
          "'text' (inline text), 'error' (error message), 'video' (video file), 'audio' (audio file), " +
          "'code' (syntax-highlighted code block), 'markdown' (rendered markdown), " +
          "'pdf' (PDF document), 'html' (raw HTML rendered in sandboxed iframe).",
      ),

    title: tool.schema
      .string()
      .optional()
      .describe("Short heading. E.g. 'Generated Logo', 'API Response', 'Build Output'."),

    description: tool.schema
      .string()
      .optional()
      .describe(
        "Longer description shown below the title. E.g. 'A 1024x1024 logo in your brand colors'.",
      ),

    path: tool.schema
      .string()
      .optional()
      .describe(
        "Absolute file path. Required when type is 'file', 'image', 'video', 'audio', or 'pdf'. " +
          "E.g. '/workspace/output/logo.png'.",
      ),

    url: tool.schema
      .string()
      .optional()
      .describe(
        "URL to show. Required when type is 'url'. Use for localhost previews (e.g. 'http://localhost:3000') " +
          "or external links.",
      ),

    content: tool.schema
      .string()
      .optional()
      .describe(
        "Inline content. Required when type is 'text', 'error', 'code', 'markdown', or 'html'. " +
          "For 'code', this is the code string. For 'markdown', full markdown text. " +
          "For 'html', the HTML to render in a sandboxed iframe.",
      ),

    variant: tool.schema
      .string()
      .optional()
      .describe(
        "Display variant controlling the layout. Options: " +
          "'compact' (minimal inline card), 'full' (fills available space — great for previews), " +
          "'gallery' (visual-first, centered with aspect ratio — great for images/video), " +
          "'detail' (rich layout with prominent title, description, content). " +
          "Smart defaults per type if omitted.",
      ),

    aspect_ratio: tool.schema
      .string()
      .optional()
      .describe(
        "Aspect ratio for visual content. Options: 'auto' (default), '1:1', '16:9', '9:16', '4:3', '3:2', '21:9'. " +
          "Most useful with type='image' or type='video' + variant='gallery'.",
      ),

    theme: tool.schema
      .string()
      .optional()
      .describe(
        "Visual accent theme. Options: 'default', 'success' (green), 'warning' (amber), " +
          "'info' (blue), 'danger' (red). Affects the border/badge colors.",
      ),

    language: tool.schema
      .string()
      .optional()
      .describe(
        "Programming language for syntax highlighting. Only used when type='code'. " +
          "E.g. 'python', 'typescript', 'rust', 'json', 'bash'.",
      ),

    metadata: tool.schema
      .string()
      .optional()
      .describe(
        "Optional JSON string of extra metadata. E.g. '{\"width\":1024,\"format\":\"png\",\"duration\":\"3:42\"}'.",
      ),
  },

  async execute(args, _context) {
    const action = args.action;

    if (action !== "show") {
      return `Error: Invalid action '${action}'. Use 'show'.`;
    }

    // ── Validate type ──
    const type = args.type as ShowType | undefined;
    if (!type || !TYPES.includes(type as ShowType)) {
      return `Error: 'type' is required for 'show' action. Use one of: ${TYPES.join(", ")}.`;
    }

    // ── Validate required fields by type ──
    const PATH_TYPES: ShowType[] = ["file", "image", "video", "audio", "pdf"];
    const CONTENT_TYPES: ShowType[] = ["text", "error", "code", "markdown", "html"];

    if (PATH_TYPES.includes(type) && !args.path) {
      return `Error: 'path' is required when type is '${type}'.`;
    }
    if (type === "url" && !args.url) {
      return `Error: 'url' is required when type is 'url'.`;
    }
    if (CONTENT_TYPES.includes(type) && !args.content) {
      return `Error: 'content' is required when type is '${type}'.`;
    }

    // ── Validate file exists ──
    if (PATH_TYPES.includes(type) && args.path) {
      const absPath = resolve(args.path);
      if (!existsSync(absPath)) {
        return `Error: File not found: ${absPath}`;
      }
    }

    // ── Validate variant ──
    const variant = (args.variant as ShowVariant) || undefined;
    if (variant && !VARIANTS.includes(variant)) {
      return `Error: Invalid variant '${variant}'. Use one of: ${VARIANTS.join(", ")}.`;
    }

    // ── Validate aspect_ratio ──
    const aspectRatio = (args.aspect_ratio as ShowAspectRatio) || undefined;
    if (aspectRatio && !ASPECT_RATIOS.includes(aspectRatio)) {
      return `Error: Invalid aspect_ratio '${aspectRatio}'. Use one of: ${ASPECT_RATIOS.join(", ")}.`;
    }

    // ── Validate theme ──
    const theme = (args.theme as ShowTheme) || undefined;
    if (theme && !THEMES.includes(theme)) {
      return `Error: Invalid theme '${theme}'. Use one of: ${THEMES.join(", ")}.`;
    }

    // ── Parse metadata ──
    let metadata: Record<string, unknown> | undefined;
    if (args.metadata) {
      try {
        metadata = JSON.parse(args.metadata);
      } catch {
        return `Error: Invalid JSON in 'metadata' parameter.`;
      }
    }

    // ── Build entry ──
    const resolvedVariant = variant || defaultVariant(type);

    const entry: ShowEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      type,
      variant: resolvedVariant,
      ...(args.title && { title: args.title }),
      ...(args.description && { description: args.description }),
      ...(args.path && { path: resolve(args.path) }),
      ...(args.url && { url: args.url }),
      ...(args.content && { content: args.content }),
      ...(aspectRatio && { aspect_ratio: aspectRatio }),
      ...(theme && theme !== "default" && { theme }),
      ...(args.language && { language: args.language }),
      ...(metadata && { metadata }),
    };

    return JSON.stringify(
      {
        success: true,
        action: "show",
        entry,
        message: `Item '${args.title || type}' presented to user.`,
      },
      null,
      2,
    );
  },
});
