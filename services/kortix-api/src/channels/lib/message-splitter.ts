/**
 * Markdown-aware message splitter.
 *
 * Splits long text into chunks that respect:
 * - Code block boundaries (```)
 * - Paragraph boundaries
 * - Sentence boundaries
 * - The platform's max message length
 */

export function splitMessage(text: string, maxLength: number): string[] {
  if (!text) {
    return [];
  }

  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = findSplitPoint(remaining, maxLength);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

function findSplitPoint(text: string, maxLength: number): number {
  const segment = text.slice(0, maxLength);

  // Check if we're inside a code block
  const codeBlockCount = (segment.match(/```/g) || []).length;
  const insideCodeBlock = codeBlockCount % 2 !== 0;

  if (insideCodeBlock) {
    // Find the start of the code block and split before it
    const lastCodeBlockStart = segment.lastIndexOf('```');
    if (lastCodeBlockStart > maxLength * 0.3) {
      return lastCodeBlockStart;
    }
  }

  // Try to split at paragraph boundary (double newline)
  const doubleNewline = segment.lastIndexOf('\n\n');
  if (doubleNewline > maxLength * 0.5) {
    return doubleNewline + 2;
  }

  // Try to split at single newline
  const singleNewline = segment.lastIndexOf('\n');
  if (singleNewline > maxLength * 0.5) {
    return singleNewline + 1;
  }

  // Try to split at sentence boundary
  const sentenceEnd = findLastSentenceEnd(segment);
  if (sentenceEnd > maxLength * 0.5) {
    return sentenceEnd;
  }

  // Try to split at word boundary
  const lastSpace = segment.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.5) {
    return lastSpace + 1;
  }

  // Hard split at max length
  return maxLength;
}

function findLastSentenceEnd(text: string): number {
  // Match sentence endings: period/exclamation/question followed by space or end
  const sentencePattern = /[.!?]\s/g;
  let lastMatch = -1;
  let match: RegExpExecArray | null;

  while ((match = sentencePattern.exec(text)) !== null) {
    lastMatch = match.index + match[0].length;
  }

  return lastMatch;
}
