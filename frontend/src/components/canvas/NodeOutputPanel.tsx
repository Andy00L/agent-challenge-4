import { useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { PipelineStep } from '../../stores/missionStore';
import { renderMarkdown } from '../../lib/markdown';

const TEMPLATE_ICONS: Record<string, string> = {
  researcher: '\u{1F50D}',
  writer: '\u{270D}\u{FE0F}',
  analyst: '\u{1F4CA}',
  monitor: '\u{1F4E1}',
  publisher: '\u{1F4E2}',
};

interface Props {
  step: PipelineStep;
  onClose: () => void;
}

export function NodeOutputPanel({ step, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(step.output || step.error || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownload = () => {
    const content = step.output || step.error || '';
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentforge-${step.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const icon = TEMPLATE_ICONS[step.template] || '\u{1F916}';

  return (
    <div className="absolute right-0 top-0 h-full w-[380px] glass-panel flex flex-col animate-slide-in-right z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/30">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="text-sm font-semibold text-zinc-200">{step.name}</div>
            <Badge variant={step.status === 'complete' ? 'default' : step.status === 'error' ? 'destructive' : 'secondary'}>
              {step.status}
            </Badge>
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800/50">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Task */}
      <div className="px-4 py-2 border-b border-zinc-700/30 bg-zinc-900/30">
        <div className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Task</div>
        <div className="text-xs text-zinc-400">{step.task}</div>
      </div>

      {/* Market info */}
      {step.market && (
        <div className="px-4 py-2 border-b border-zinc-700/30 flex items-center gap-3 text-[11px] text-zinc-500">
          <span>{step.market}</span>
          {step.costPerHour != null && (
            <span className="text-zinc-600">${step.costPerHour.toFixed(3)}/hr</span>
          )}
        </div>
      )}

      {/* Output — Markdown rendered */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {step.error && (
          <div className="mb-3 p-2 bg-red-950/30 border border-red-800/50 rounded-lg text-xs text-red-400">
            {step.error}
          </div>
        )}
        {step.output ? (
          <div
            className="text-sm text-zinc-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(step.output) }}
          />
        ) : !step.error ? (
          <p className="text-sm text-zinc-500">No output yet.</p>
        ) : null}
      </div>

      {/* Footer */}
      <Separator />
      <div className="px-4 py-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={handleCopy}>
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="default" size="sm" className="flex-1" onClick={handleDownload}>
            <Download className="w-3 h-3" />
            Download .md
          </Button>
        </div>
      </div>
    </div>
  );
}
