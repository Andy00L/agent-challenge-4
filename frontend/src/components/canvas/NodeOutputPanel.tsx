import { useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { PipelineStep } from '../../stores/missionStore';
import { detectMediaInOutput } from '../../lib/mediaDetector';
import { TruncatedMarkdown } from './TruncatedMarkdown';

const TEMPLATE_ICONS: Record<string, string> = {
  researcher: '\u{1F50D}',
  writer: '\u{270D}\u{FE0F}',
  analyst: '\u{1F4CA}',
  monitor: '\u{1F4E1}',
  publisher: '\u{1F4E2}',
  'scene-writer': '\u{1F3AC}',
  'image-generator': '\u{1F3A8}',
  'video-generator': '\u{1F3AC}',
  'narrator': '\u{1F50A}',
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
    <div className="absolute right-0 top-0 h-full w-[380px] bg-background/95 backdrop-blur-sm border-l border-border/50 flex flex-col animate-slide-in-right z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="text-sm font-bold text-foreground">{step.name}</div>
            <Badge variant={step.status === 'complete' ? 'default' : step.status === 'error' ? 'destructive' : 'secondary'} className="mt-0.5">
              {step.status === 'skipped' ? 'Skipped' : step.status}
            </Badge>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Task */}
      <div className="px-4 py-2.5 border-b border-border/30 bg-muted/50">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Task</div>
        <div className="text-xs text-foreground/80">{step.task}</div>
      </div>

      {/* Market info */}
      {step.market && (
        <div className="px-4 py-2 border-b border-border/30 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium">{step.market}</span>
          {step.costPerHour != null && (
            <span className="font-mono">${step.costPerHour.toFixed(3)}/hr</span>
          )}
        </div>
      )}

      {/* Output -- Markdown rendered */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {step.error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 shadow-xs">
            {step.error}
          </div>
        )}
        {step.output ? (
          <>
            {/* Render media if present */}
            {step.outputUrls?.map((url, i) => {
              if (step.outputType === 'image') return <img key={i} src={url} alt={`Generated ${i + 1}`} className="w-full rounded-lg border border-[var(--border)] my-3" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
              if (step.outputType === 'video') return <video key={i} src={url} controls className="w-full rounded-lg border border-[var(--border)] my-3" onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; }} />;
              if (step.outputType === 'audio') return <audio key={i} src={url} controls className="w-full my-3" onError={(e) => { (e.target as HTMLAudioElement).style.display = 'none'; }} />;
              return null;
            })}
            {/* Also detect media URLs in text output */}
            {(!step.outputType || step.outputType === 'text') && (() => {
              const media = detectMediaInOutput(step.output);
              return (
                <>
                  {media.imageUrls.map((url, i) => <img key={`det-${i}`} src={url} alt={`Generated ${i + 1}`} className="w-full rounded-lg border border-[var(--border)] my-3" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />)}
                  {media.videoUrls.map((url, i) => <video key={`det-v-${i}`} src={url} controls className="w-full rounded-lg border border-[var(--border)] my-3" onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none'; }} />)}
                  {media.audioUrls.map((url, i) => <audio key={`det-a-${i}`} src={url} controls className="w-full my-3" onError={(e) => { (e.target as HTMLAudioElement).style.display = 'none'; }} />)}
                </>
              );
            })()}
            <TruncatedMarkdown text={step.output} />
          </>
        ) : !step.error ? (
          <p className="text-sm text-muted-foreground">No output yet.</p>
        ) : null}
      </div>

      {/* Footer */}
      <Separator />
      <div className="px-4 py-3 space-y-2">
        {step.outputUrls && step.outputUrls.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {step.outputUrls.map((url, i) => (
              <a key={`dl-${i}`} href={url} download className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs text-foreground/70 hover:bg-muted transition-colors">
                <Download className="w-3 h-3" />
                {step.outputType === 'video' ? 'Video' : step.outputType === 'audio' ? 'Audio' : step.outputType === 'image' ? 'Image' : 'File'}
              </a>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={handleCopy}>
            {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={handleDownload}>
            <Download className="w-3 h-3" />
            Download .md
          </Button>
        </div>
      </div>
    </div>
  );
}
