import { useState } from 'react';
import { renderMarkdown } from '../../lib/markdown';

const MAX_RENDER_CHARS = 8000;

interface TruncatedMarkdownProps {
  text: string;
  className?: string;
}

export function TruncatedMarkdown({ text, className = '' }: TruncatedMarkdownProps) {
  const [showFull, setShowFull] = useState(false);
  const isTruncated = text.length > MAX_RENDER_CHARS;
  const displayText = (!isTruncated || showFull) ? text : text.slice(0, MAX_RENDER_CHARS);

  return (
    <>
      <div
        className={`text-sm text-foreground/80 leading-relaxed ${className}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }}
      />
      {isTruncated && (
        <button
          onClick={() => setShowFull(!showFull)}
          className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg
                     bg-muted text-muted-foreground border
                     hover:bg-muted/80 transition-colors"
        >
          {showFull ? 'Collapse' : `Show full output (${Math.round(text.length / 1024)}KB)`}
        </button>
      )}
    </>
  );
}
