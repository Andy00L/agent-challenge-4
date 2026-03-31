import { useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { PipelineStep } from '../../stores/missionStore';
import { renderMarkdown } from '../../lib/markdown';

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
  const agentCount = steps.length;

  return (
    <div className="absolute right-0 top-0 h-full w-[420px] glass-panel flex flex-col animate-slide-in-right z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700/30">
        <div className="flex items-center gap-2">
          <Badge variant="default" className="bg-green-500">Complete</Badge>
          <h3 className="text-sm font-semibold text-zinc-200">Mission Output</h3>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800/50"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 px-5 py-3">
        <Card className="flex-1"><CardContent className="p-2 text-center">
          <span className="text-[10px] text-zinc-500 uppercase">Agents</span>
          <p className="text-sm font-semibold text-zinc-200">{agentCount}</p>
        </CardContent></Card>
        <Card className="flex-1"><CardContent className="p-2 text-center">
          <span className="text-[10px] text-zinc-500 uppercase">Duration</span>
          <p className="text-sm font-semibold text-zinc-200">{durationMs > 0 ? formatElapsed(durationMs) : '\u2014'}</p>
        </CardContent></Card>
        <Card className="flex-1"><CardContent className="p-2 text-center">
          <span className="text-[10px] text-zinc-500 uppercase">Cost</span>
          <p className="text-sm font-semibold text-zinc-200">{estimatedCost > 0 ? `$${estimatedCost.toFixed(4)}` : '\u2014'}</p>
        </CardContent></Card>
      </div>
      <Separator />

      {/* Body — Markdown rendered */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div
          className="text-sm text-zinc-300 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
        />
      </div>

      {/* Pipeline summary */}
      {steps.length > 0 && (
        <><Separator /><div className="px-5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 overflow-x-auto">
            {steps.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1.5 shrink-0">
                {i > 0 && <span className="text-zinc-700">\u2192</span>}
                <span className="text-zinc-500">{s.name}</span>
              </span>
            ))}
          </div>
        </div></>
      )}

      {/* Actions */}
      <Separator />
      <div className="px-5 py-3 space-y-2">
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
        <Button className="w-full" onClick={onNewMission}>
          Start New Mission
        </Button>
      </div>
    </div>
  );
}
