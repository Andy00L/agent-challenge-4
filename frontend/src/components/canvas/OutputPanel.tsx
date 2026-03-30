import { useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import type { PipelineStep } from '../../stores/missionStore';

interface OutputPanelProps {
  output: string;
  onClose: () => void;
  onNewMission: () => void;
  steps: PipelineStep[];
  startedAt: number | null;
  completedAt: number | null;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return mins > 0 ? `${mins}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function OutputPanel({ output, onClose, onNewMission, steps, startedAt, completedAt }: OutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownload = () => {
    const blob = new Blob([output], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentforge-mission-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const durationMs = startedAt && completedAt ? completedAt - startedAt : 0;
  const durationHrs = durationMs / 3_600_000;
  const totalCostPerHr = steps.reduce((sum, s) => sum + (s.costPerHour || 0), 0);
  const estimatedCost = totalCostPerHr * durationHrs;

  return (
    <div className="w-96 shrink-0 h-full bg-zinc-900/95 backdrop-blur-sm border-l border-zinc-800 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Mission Output
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
          {output}
        </pre>
      </div>

      {/* Stats */}
      {steps.length > 0 && (
        <div className="px-4 py-3 border-t border-zinc-800 space-y-1.5 text-xs text-zinc-500">
          <div className="flex justify-between">
            <span>Pipeline</span>
            <span className="text-zinc-400 truncate ml-4 text-right">{steps.map(s => s.name).join(' \u2192 ')}</span>
          </div>
          <div className="flex justify-between">
            <span>Agents</span>
            <span className="text-zinc-400">{steps.length}</span>
          </div>
          {durationMs > 0 && (
            <div className="flex justify-between">
              <span>Time</span>
              <span className="text-zinc-400">{formatElapsed(durationMs)}</span>
            </div>
          )}
          {estimatedCost > 0 && (
            <div className="flex justify-between">
              <span>Est. cost</span>
              <span className="text-green-400">${estimatedCost.toFixed(4)}</span>
            </div>
          )}
          {steps[0]?.market && (
            <div className="flex justify-between">
              <span>GPU</span>
              <span className="text-zinc-400">{steps[0].market}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t border-zinc-800 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded transition-colors"
          >
            <Download className="w-3 h-3" />
            Download .md
          </button>
        </div>
        <button
          onClick={onNewMission}
          className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded transition-colors"
        >
          Start New Mission
        </button>
      </div>
    </div>
  );
}
