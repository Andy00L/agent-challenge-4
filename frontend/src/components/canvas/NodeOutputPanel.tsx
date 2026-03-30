import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { PipelineStep } from '../../stores/missionStore';

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

  const icon = TEMPLATE_ICONS[step.template] || '\u{1F916}';
  const statusColor =
    step.status === 'complete' ? 'text-green-400' :
    step.status === 'error' ? 'text-red-400' : 'text-zinc-500';

  return (
    <div className="w-96 shrink-0 h-full bg-zinc-900/95 backdrop-blur-sm border-l border-zinc-800 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="text-sm font-semibold text-white">{step.name}</div>
            <div className={`text-[11px] uppercase tracking-wider ${statusColor}`}>
              {step.status}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Task */}
      <div className="px-4 py-2 border-b border-zinc-800/50">
        <div className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Task</div>
        <div className="text-xs text-zinc-400">{step.task}</div>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {step.error && (
          <div className="mb-3 p-2 bg-red-950/30 border border-red-800/50 rounded text-xs text-red-400">
            {step.error}
          </div>
        )}
        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
          {step.output || 'No output yet.'}
        </pre>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy Output'}
        </button>
        {step.market && (
          <div className="text-[11px] text-zinc-600 mt-2 text-center">
            {step.market} {step.costPerHour != null && `\u00B7 $${step.costPerHour.toFixed(3)}/hr`}
          </div>
        )}
      </div>
    </div>
  );
}
