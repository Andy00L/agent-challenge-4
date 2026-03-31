function sanitizeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(text: string): string {
  const safe = sanitizeHtml(text);
  return safe
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-zinc-200 mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-zinc-100 mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-zinc-100 mt-6 mb-3">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-200">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-zinc-300">$1</em>')
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-zinc-800 text-violet-300 text-xs font-mono">$1</code>')
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="p-3 rounded-lg bg-zinc-800/80 border border-zinc-700/50 overflow-x-auto my-3"><code class="text-xs font-mono text-zinc-300">$1</code></pre>')
    .replace(/^[\-\*] (.+)$/gm, '<li class="text-zinc-300 ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="text-zinc-300 ml-4 list-decimal">$1</li>')
    .replace(/^---$/gm, '<hr class="border-zinc-700/50 my-4"/>')
    .replace(/\n\n/g, '</p><p class="mb-3 text-zinc-300 leading-relaxed">')
    .replace(/\n/g, '<br/>');
}
