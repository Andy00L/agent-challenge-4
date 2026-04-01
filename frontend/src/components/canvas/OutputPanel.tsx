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
    <div className="absolute right-0 top-0 h-full w-[420px] bg-white border-l shadow-xl flex flex-col animate-slide-in-right z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b">
        <div className="flex items-center gap-2.5">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Complete</Badge>
          <h3 className="text-lg font-bold text-foreground">Mission Output</h3>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4">
        <Card className="bg-muted"><CardContent className="p-4 text-center">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Agents</span>
          <p className="text-xl font-bold text-foreground mt-1">{agentCount}</p>
        </CardContent></Card>
        <Card className="bg-muted"><CardContent className="p-4 text-center">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Duration</span>
          <p className="text-xl font-bold text-foreground mt-1">{durationMs > 0 ? formatElapsed(durationMs) : '\u2014'}</p>
        </CardContent></Card>
        <Card className="bg-muted"><CardContent className="p-4 text-center">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Cost</span>
          <p className="text-xl font-bold text-foreground mt-1">{estimatedCost > 0 ? `$${estimatedCost.toFixed(4)}` : '\u2014'}</p>
        </CardContent></Card>
      </div>
      <Separator />

      {/* Body -- Markdown rendered */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div
          className="text-sm text-foreground/80 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
        />
      </div>

      {/* Pipeline summary */}
      {steps.length > 0 && (
        <><Separator /><div className="px-6 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground overflow-x-auto">
            {steps.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1.5 shrink-0">
                {i > 0 && <span className="text-border">\u2192</span>}
                <span className="text-muted-foreground">{s.name}</span>
              </span>
            ))}
          </div>
        </div></>
      )}

      {/* Actions */}
      <Separator />
      <div className="px-6 py-4 space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={handleCopy}>
            {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={handleDownload}>
            <Download className="w-3 h-3" />
            Download .md
          </Button>
        </div>
        <Button className="w-full shadow-sm hover:shadow-md hover:-translate-y-px active:translate-y-0 transition-all duration-200" onClick={onNewMission}>
          Start New Mission
        </Button>
      </div>
    </div>
  );
}
