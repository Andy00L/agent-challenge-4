import { useState } from 'react';
import type { ReactNode } from 'react';
import { X, Copy, Check, Download, FileText, ChevronRight } from 'lucide-react';
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

function DisclosureSection({ title, children, defaultOpen = false }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="pb-3 fade-in-up">
          {children}
        </div>
      )}
    </div>
  );
}

export function OutputPanel({ output, onClose, onNewMission, steps, warnings, startedAt, completedAt }: OutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
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

  // Collect all media
  const media = detectMediaInOutput(output);
  const stepAudioUrls = steps.filter(s => s.outputType === 'audio' && s.outputUrls?.length).flatMap(s => s.outputUrls!);
  const stepVideoUrls = steps.filter(s => s.outputType === 'video' && s.outputUrls?.length).flatMap(s => s.outputUrls!);
  const allVideoUrls = [...new Set([...media.videoUrls, ...stepVideoUrls])];
  const allAudioUrls = [...new Set([...media.audioUrls, ...stepAudioUrls])];
  const allImageUrls = [...new Set(media.imageUrls)];

  return (
    <div className="absolute right-0 top-0 h-full w-[380px] bg-background/95 backdrop-blur-sm border-l border-border/50 flex flex-col animate-slide-in-right z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 border border-green-500/20">
            Complete
          </span>
          <span className="text-sm font-semibold text-foreground">Mission Output</span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Warnings */}
        {warnings && warnings.length > 0 && (
          <div className="mb-3 bg-yellow-50 rounded-lg px-3 py-2">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-yellow-700 text-xs">
                <span>{'\u26A0\uFE0F'}</span>
                <span>{w.step ? <><strong>{w.step}:</strong> {w.message}</> : w.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Hero video */}
        {allVideoUrls.map((url, i) => (
          <div key={`v-${i}`} className="rounded-lg overflow-hidden border border-border/50 mb-3">
            <video src={url} controls autoPlay className="w-full"
              onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; }} />
          </div>
        ))}

        {/* Hero images (shown inline if no video) */}
        {allVideoUrls.length === 0 && allImageUrls.map((url, i) => (
          <img key={`i-${i}`} src={url} alt={`Generated ${i + 1}`}
            className="w-full rounded-lg border border-border/50 mb-3 cursor-pointer"
            onClick={() => window.open(url, '_blank')}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ))}

        {/* Audio players */}
        {allAudioUrls.map((url, i) => (
          <audio key={`a-${i}`} src={url} controls className="w-full mb-3"
            onError={(e) => { (e.target as HTMLAudioElement).style.display = 'none'; }} />
        ))}

        {/* Compact stats line */}
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground py-2">
          <span className="font-mono tabular-nums">{agentCount} agents</span>
          <span className="text-border">{'\u00B7'}</span>
          <span className="font-mono tabular-nums">{durationMs > 0 ? formatElapsed(durationMs) : '\u2014'}</span>
          <span className="text-border">{'\u00B7'}</span>
          <span className="font-mono tabular-nums">{estimatedCost > 0 ? `$${estimatedCost.toFixed(4)}` : '\u2014'}</span>
        </div>

        {/* Compact action buttons */}
        <div className="flex flex-wrap items-center gap-2 py-2">
          {allVideoUrls.map((url, i) => (
            <a key={`dl-v-${i}`} href={url} download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Video
            </a>
          ))}
          {allAudioUrls.map((url, i) => (
            <a key={`dl-a-${i}`} href={url} download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Audio
            </a>
          ))}
          <button onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition-colors ml-auto">
            <FileText className="w-3.5 h-3.5" /> .md
          </button>
        </div>

        {/* Collapsible pipeline details */}
        {steps.length > 0 && (
          <DisclosureSection title={`Pipeline (${agentCount} agents)`}>
            <div className="text-xs text-muted-foreground space-y-1.5">
              {steps.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.status === 'complete' ? 'bg-green-500' :
                    s.status === 'error' ? 'bg-red-500' :
                    'bg-gray-300'
                  }`} />
                  <span className="text-foreground/80 truncate">{s.name}</span>
                  {s.market && <span className="text-muted-foreground/50 text-[10px] ml-auto shrink-0">{s.market}</span>}
                </div>
              ))}
            </div>
          </DisclosureSection>
        )}

        {/* Scene images (collapsible, shown when video exists alongside images) */}
        {allVideoUrls.length > 0 && allImageUrls.length > 0 && (
          <DisclosureSection title={`Scene Images (${allImageUrls.length})`}>
            <div className="grid grid-cols-3 gap-1.5">
              {allImageUrls.map((url, i) => (
                <img key={i} src={url} alt={`Scene ${i + 1}`}
                  className="rounded border border-border/30 cursor-pointer hover:border-border transition-colors"
                  onClick={() => window.open(url, '_blank')}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ))}
            </div>
          </DisclosureSection>
        )}

        {/* Full text output */}
        <DisclosureSection title="Full Output" defaultOpen={allVideoUrls.length === 0 && allImageUrls.length === 0}>
          <TruncatedMarkdown text={output} />
        </DisclosureSection>

        {/* New mission link */}
        <div className="pt-3 text-center">
          <button onClick={onNewMission} className="text-xs text-primary hover:underline">
            Start new mission
          </button>
        </div>
      </div>
    </div>
  );
}
