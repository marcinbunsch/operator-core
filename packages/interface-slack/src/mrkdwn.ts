/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Handles:
 * - **bold** / __bold__ -> *bold*
 * - ~~strikethrough~~ -> ~strikethrough~
 * - [text](url) -> <url|text>
 * - # headers -> *headers*
 * - * item / - item -> • item
 *
 * Note: Does not convert *italic* to _italic_ because it conflicts
 * with header output and list items. Most LLMs use _italic_ anyway.
 */
export const markdownToMrkdwn = (markdown: string): string => {
  return (
    markdown
      // Headers to bold
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
      // Bold: **text** or __text__ → *text*
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/__(.+?)__/g, "*$1*")
      // Strikethrough: ~~text~~ → ~text~
      .replace(/~~(.+?)~~/g, "~$1~")
      // Links: [text](url) → <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // List items: * item or - item → • item
      .replace(/^[*-] /gm, "• ")
  );
};
