import { useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { PipelineStep, MissionWarning } from '../../stores/missionStore';
import { detectMediaInOutput } from '../../lib/mediaDetector';
import { TruncatedMarkdown } from './TruncatedMarkdown';

interface OutputPanelProps {
  output: string;
  onClose: () => void;
  onNewMission: () => void;
  steps: PipelineStep[];
  warnings?: MissionWarning[];
  startedAt: number | null;
  completedAt: number | null;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return mins > 0 ? `${mins}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function OutputPanel({ output, onClose, onNewMission, steps, warnings, startedAt, completedAt }: OutputPanelProps) {
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

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-yellow-700 text-xs">
              <span>{'\u26A0\uFE0F'}</span>
              <span>{w.step ? <><strong>{w.step}:</strong> {w.message}</> : w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body -- Markdown rendered + media */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {(() => {
          const media = detectMediaInOutput(output);
          // Also collect audio from step outputUrls (narrator audio won't appear in the text)
          const stepAudioUrls = steps
            .filter(s => s.outputType === 'audio' && s.outputUrls?.length)
            .flatMap(s => s.outputUrls!);
          const allAudioUrls = [...new Set([...media.audioUrls, ...stepAudioUrls])];
          return (
            <>
              {media.videoUrls.map((url, i) => (
                <video key={`v-${i}`} src={url} controls className="w-full rounded-lg border border-[var(--border)] my-3"
                  onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; }} />
              ))}
              {media.imageUrls.map((url, i) => (
                <img key={`i-${i}`} src={url} alt={`Generated ${i + 1}`} className="w-full rounded-lg border border-[var(--border)] my-3"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ))}
              {allAudioUrls.map((url, i) => (
                <audio key={`a-${i}`} src={url} controls className="w-full my-3"
                  onError={(e) => { (e.target as HTMLAudioElement).style.display = 'none'; }} />
              ))}
            </>
          );
        })()}
        <TruncatedMarkdown text={output} />
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
        {(() => {
          const media = detectMediaInOutput(output);
          const stepAudioUrls = steps.filter(s => s.outputType === 'audio' && s.outputUrls?.length).flatMap(s => s.outputUrls!);
          const stepVideoUrls = steps.filter(s => s.outputType === 'video' && s.outputUrls?.length).flatMap(s => s.outputUrls!);
          const allVideoUrls = [...new Set([...media.videoUrls, ...stepVideoUrls])];
          const allAudioUrls = [...new Set([...media.audioUrls, ...stepAudioUrls])];
          return (
            <div className="grid grid-cols-2 gap-2">
              {allVideoUrls.map((url, i) => (
                <a key={`dl-v-${i}`} href={url} download className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs text-foreground/70 hover:bg-muted transition-colors">
                  <Download className="w-3 h-3" /> Video
                </a>
              ))}
              {allAudioUrls.map((url, i) => (
                <a key={`dl-a-${i}`} href={url} download className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs text-foreground/70 hover:bg-muted transition-colors">
                  <Download className="w-3 h-3" /> Audio
                </a>
              ))}
              <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={handleCopy}>
                {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy Text'}
              </Button>
              <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={handleDownload}>
                <Download className="w-3 h-3" />
                Script .md
              </Button>
            </div>
          );
        })()}
        <Button className="w-full shadow-sm hover:shadow-md hover:-translate-y-px active:translate-y-0 transition-all duration-200" onClick={onNewMission}>
          Start New Mission
        </Button>
      </div>
    </div>
  );
}
