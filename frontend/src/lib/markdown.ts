function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip dangerous HTML patterns that could survive markdown rendering.
 * Defense-in-depth: the input is already entity-escaped, but these catch
 * edge cases from regex-based markdown transforms.
 */
function stripDangerousPatterns(html: string): string {
  return html
    // Remove on* event handlers (quoted, unquoted, backtick-quoted)
    .replace(/\bon\w+\s*=\s*["'`][^"'`]*["'`]/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, '')
    // Remove javascript: protocol
    .replace(/javascript\s*:/gi, '')
    // Remove vbscript: protocol
    .replace(/vbscript\s*:/gi, '')
    // Remove data: URIs that could execute (text/html, etc.)
    .replace(/data\s*:\s*text\/html/gi, '')
    // Remove <script> and <iframe> tags (defense-in-depth)
    .replace(/<\s*\/?\s*script[^>]*>/gi, '')
    .replace(/<\s*\/?\s*iframe[^>]*>/gi, '')
    // Remove style attributes (prevent CSS injection)
    .replace(/\bstyle\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bstyle\s*=\s*[^\s>]*/gi, '');
}

export function renderMarkdown(text: string): string {
  const safe = sanitizeHtml(text);
  const rendered = safe
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-foreground mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-foreground mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-foreground mt-6 mb-3">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-secondary text-foreground/80 text-xs font-mono border border-border">$1</code>')
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="p-3 rounded-lg bg-secondary border border-border overflow-x-auto my-3"><code class="text-xs font-mono text-foreground/80">$1</code></pre>')
    .replace(/^[\-\*] (.+)$/gm, '<li class="text-foreground/80 ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="text-foreground/80 ml-4 list-decimal">$1</li>')
    .replace(/^---$/gm, '<hr class="border-border my-4"/>')
    .replace(/\n\n/g, '</p><p class="mb-3 text-foreground/80 leading-relaxed">')
    .replace(/\n/g, '<br/>');
  return stripDangerousPatterns(rendered);
}
