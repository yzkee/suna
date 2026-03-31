/**
 * Kortix System XML — single utility for stripping <kortix_system> tags.
 *
 * Backend plugins wrap internal content (session context, memory, orchestrator
 * state, PTY output, etc.) in <kortix_system type="..." source="..."> tags.
 *
 * This one function strips them before any rendering path:
 *   - UnifiedMarkdown (assistant text)
 *   - SandboxUrlDetector (URL detection)
 *   - Any future render path
 *
 * Call BEFORE markdown parsing. The tags are XML and will break remark/rehype.
 */

const KORTIX_SYSTEM_RE = /<kortix_system[^>]*>[\s\S]*?<\/kortix_system>/gi

export function stripKortixSystemTags(text: string): string {
	if (!text) return ""
	return text.replace(KORTIX_SYSTEM_RE, "").trim()
}
