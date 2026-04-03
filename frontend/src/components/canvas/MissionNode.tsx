import { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from '../../stores/missionStore';

interface MissionNodeData {
  label: string;
  template: string;
  task: string;
  nodeStatus: NodeStatus | 'mission' | 'output';
  outputPreview?: string;
  error?: string;
  market?: string;
  costPerHour?: number;
  isFirst: boolean;
  isLast: boolean;
  missionText?: string;
  finalOutput?: string;
  isSelected?: boolean;
  hasOutput?: boolean;
  queuedSince?: number;
  outputType?: 'text' | 'image' | 'video' | 'audio';
  outputUrls?: string[];
  imageCount?: number;
  totalImages?: number;
}

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
  custom: '\u{2699}\u{FE0F}',
  mission: '\u{1F3AF}',
  output: '\u{1F4E6}',
};

// Status pill badge styles — bg/text/border color per status
const STATUS_PILL: Record<string, string> = {
  pending:    'bg-zinc-100 text-zinc-500 border-zinc-200',
  deploying:  'bg-amber-50 text-amber-600 border-amber-200',
  deployed:   'bg-blue-50 text-blue-600 border-blue-200',
  ready:      'bg-blue-50 text-blue-600 border-blue-200',
  queued:     'bg-amber-50 text-amber-600 border-amber-200',
  processing: 'bg-blue-50 text-blue-600 border-blue-200',
  complete:   'bg-green-50 text-green-600 border-green-200',
  error:      'bg-red-50 text-red-600 border-red-200',
  skipped:    'bg-zinc-100 text-zinc-400 border-zinc-200',
  stopped:    'bg-zinc-100 text-zinc-400 border-zinc-200',
  mission:    'bg-zinc-100 text-zinc-600 border-zinc-200',
  output:     'bg-zinc-100 text-zinc-600 border-zinc-200',
};

// Card glow shadow by status
const STATUS_GLOW: Record<string, string> = {
  deploying:  'shadow-glow-yellow',
  queued:     'shadow-glow-yellow',
  processing: 'shadow-glow-blue',
  complete:   'shadow-glow-green',
  error:      'shadow-glow-red',
};

// Left accent border color
const ACCENT_BORDER: Record<string, string> = {
  pending:    'border-l-gray-300',
  deploying:  'border-l-amber-400',
  deployed:   'border-l-blue-400',
  ready:      'border-l-blue-400',
  queued:     'border-l-amber-400',
  processing: 'border-l-blue-500',
  complete:   'border-l-green-500',
  error:      'border-l-red-500',
  skipped:    'border-l-gray-300',
  stopped:    'border-l-gray-300',
  mission:    'border-l-foreground',
  output:     'border-l-foreground',
};

const DOT_COLORS: Record<string, string> = {
  pending:    'bg-gray-300',
  deploying:  'bg-amber-400 animate-pulse',
  deployed:   'bg-blue-400',
  ready:      'bg-blue-400',
  queued:     'bg-amber-400 animate-pulse',
  processing: 'bg-blue-500 animate-pulse',
  complete:   'bg-green-500',
  error:      'bg-red-500',
  skipped:    'bg-gray-300',
  stopped:    'bg-gray-400',
  mission:    'bg-foreground',
  output:     'bg-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  deploying: 'Deploying',
  deployed: 'Booting',
  ready: 'Ready',
  processing: 'Processing',
  complete: 'Complete',
  error: 'Error',
  skipped: 'Skipped',
  stopped: 'Stopped',
  mission: 'Mission',
  output: 'Output',
};

const ANIM_CLASS: Record<string, string> = {
  deploying:  'animate-node-pulse',
  queued:     'animate-node-pulse',
  processing: 'animate-node-glow',
  complete:   'node-complete-pop',
  skipped:    'opacity-60',
  stopped:    'opacity-60',
};

function MissionNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MissionNodeData;
  const st = d.nodeStatus;
  const dot = DOT_COLORS[st] || DOT_COLORS.pending;
  const pill = STATUS_PILL[st] || STATUS_PILL.pending;
  const glow = STATUS_GLOW[st] || '';
  const accent = ACCENT_BORDER[st] || ACCENT_BORDER.pending;
  const anim = ANIM_CLASS[st] || '';

  // Heartbeat pulse when imageCount increases (VideoAssembler receiving images)
  const [heartbeat, setHeartbeat] = useState(false);
  const prevImageCount = useRef(0);
  useEffect(() => {
    if (d.imageCount && d.imageCount > prevImageCount.current) {
      prevImageCount.current = d.imageCount;
      setHeartbeat(true);
      const t = setTimeout(() => setHeartbeat(false), 600);
      return () => clearTimeout(t);
    }
  }, [d.imageCount]);

  return (
    <div
      className={[
        'min-w-[220px] max-w-[260px] rounded-2xl bg-white border border-[var(--border)] border-l-[3px]',
        accent,
        glow,
        anim,
        'shadow-sm transition-all duration-500',
        d.hasOutput ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : '',
        d.isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md' : '',
        heartbeat ? 'node-heartbeat' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="p-4 relative">
        {/* Status dot */}
        <div className={`absolute top-4 right-4 w-2 h-2 rounded-full ${dot}`} />

        {/* Handles */}
        {!d.isFirst && (
          <Handle
            type="target"
            position={Position.Left}
            style={{ width: 10, height: 10, background: '#D1CBC3', border: '2px solid white' }}
          />
        )}
        {!d.isLast && (
          <Handle
            type="source"
            position={Position.Right}
            style={{ width: 10, height: 10, background: '#D1CBC3', border: '2px solid white' }}
          />
        )}

        {/* Icon + name */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{TEMPLATE_ICONS[d.template] || TEMPLATE_ICONS.custom}</span>
          <span className="text-sm font-semibold text-foreground truncate">{d.label}</span>
        </div>

        {/* Status pill badge */}
        <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full border mb-2 ${pill}`}>
          {st === 'deploying' && d.queuedSince ? 'Queued for GPU' : (STATUS_LABELS[st] || st)}
        </span>

        {/* Mission text (for mission node) */}
        {st === 'mission' && d.missionText && (
          <p className="text-xs text-muted-foreground line-clamp-3 mt-1">{d.missionText}</p>
        )}

        {/* Task (for agent nodes) */}
        {st !== 'mission' && st !== 'output' && d.task && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{d.task}</p>
        )}

        {/* Market + cost */}
        {d.market && (st === 'deployed' || st === 'ready' || st === 'processing' || st === 'complete') && (
          <div className="text-[10px] text-muted-foreground font-mono mb-1">
            {d.market} {d.costPerHour != null && `\u00B7 $${d.costPerHour.toFixed(3)}/hr`}
          </div>
        )}

        {/* Image progress bar (VideoAssembler) */}
        {d.imageCount != null && d.totalImages != null && d.totalImages > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all duration-500"
                style={{ width: `${(d.imageCount / d.totalImages) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{d.imageCount}/{d.totalImages}</span>
          </div>
        )}

        {/* Output preview */}
        {st === 'complete' && d.outputType === 'image' && d.outputUrls?.[0] && (
          <div className="mt-2 pt-2 border-t border-zinc-100">
            <img src={d.outputUrls[0]} alt="Generated" className="w-full h-20 object-cover rounded-lg border border-zinc-100"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        )}
        {st === 'complete' && d.outputType === 'video' && (
          <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center gap-1.5 text-[10px] text-blue-600">
            <span>{'\uD83C\uDFAC'}</span> Video generated
          </div>
        )}
        {st === 'complete' && d.outputType === 'audio' && (
          <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center gap-1.5 text-[10px] text-blue-600">
            <span>{'\uD83D\uDD0A'}</span> Audio generated
          </div>
        )}
        {st === 'complete' && (!d.outputType || d.outputType === 'text') && d.outputPreview && (
          <div className="mt-2 pt-2 border-t border-zinc-100">
            <div className="bg-zinc-50 rounded-lg p-2">
              <p className="text-[11px] text-muted-foreground line-clamp-3 whitespace-pre-line">{d.outputPreview}</p>
            </div>
          </div>
        )}
        {st === 'skipped' && (
          <div className="mt-2 pt-2 border-t border-zinc-100">
            <p className="text-xs text-gray-400 italic">Skipped</p>
          </div>
        )}

        {/* Final output (for output node) */}
        {st === 'output' && d.finalOutput && (
          <div className="mt-1">
            <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-line">{d.finalOutput}</p>
          </div>
        )}

        {/* Error */}
        {st === 'error' && d.error && (
          <div className="mt-2 pt-2 border-t border-red-100">
            <p className="text-xs text-red-600 line-clamp-2">{d.error}</p>
          </div>
        )}

        {/* Click hint */}
        {d.hasOutput && !d.isSelected && (
          <div className="mt-2 pt-2 border-t border-zinc-100 text-center">
            <span className="text-[10px] font-medium text-blue-600">Click to view output &#x2192;</span>
          </div>
        )}
      </div>
    </div>
  );
}

export const MissionNode = memo(MissionNodeComponent);
