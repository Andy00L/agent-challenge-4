import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
}

const TEMPLATE_ICONS: Record<string, string> = {
  researcher: '\u{1F50D}',
  writer: '\u{270D}\u{FE0F}',
  analyst: '\u{1F4CA}',
  monitor: '\u{1F4E1}',
  publisher: '\u{1F4E2}',
  custom: '\u{2699}\u{FE0F}',
  mission: '\u{1F3AF}',
  output: '\u{1F4E6}',
};

const STATUS_STYLES: Record<string, { border: string; bg: string; anim: string }> = {
  pending:    { border: 'border-zinc-700/60',   bg: 'bg-zinc-900/80',     anim: '' },
  deploying:  { border: 'border-amber-600/60',  bg: 'bg-amber-950/20',    anim: 'animate-node-pulse' },
  deployed:   { border: 'border-blue-800/60',   bg: 'bg-blue-950/20',     anim: '' },
  ready:      { border: 'border-blue-600/60',   bg: 'bg-blue-950/25',     anim: '' },
  queued:     { border: 'border-amber-600/60',  bg: 'bg-amber-950/20',    anim: 'animate-node-pulse' },
  processing: { border: 'border-blue-500/60',   bg: 'bg-blue-950/30',     anim: 'animate-node-glow' },
  complete:   { border: 'border-green-600/60',  bg: 'bg-green-950/20',    anim: 'node-complete-pop' },
  error:      { border: 'border-red-600/60',    bg: 'bg-red-950/20',      anim: '' },
  stopped:    { border: 'border-zinc-600/40',   bg: 'bg-zinc-900/40',     anim: 'opacity-60' },
  mission:    { border: 'border-violet-600/60', bg: 'bg-violet-950/20',   anim: '' },
  output:     { border: 'border-indigo-600/60', bg: 'bg-indigo-950/20',   anim: '' },
};

const DOT_COLORS: Record<string, string> = {
  pending:    'bg-zinc-500',
  deploying:  'bg-amber-400 animate-pulse ring-2 ring-amber-400/30',
  deployed:   'bg-blue-400',
  ready:      'bg-blue-400 ring-2 ring-blue-400/20',
  queued:     'bg-amber-400 animate-pulse ring-2 ring-amber-400/30',
  processing: 'bg-blue-500 animate-ping ring-2 ring-blue-500/30',
  complete:   'bg-green-400 ring-2 ring-green-400/20',
  error:      'bg-red-400 ring-2 ring-red-400/20',
  stopped:    'bg-zinc-500',
  mission:    'bg-violet-400',
  output:     'bg-indigo-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  deploying: 'Deploying...',
  deployed: 'Booting...',
  ready: 'Ready',
  processing: 'Processing...',
  complete: 'Complete',
  error: 'Error',
  stopped: 'Stopped',
  mission: 'Mission',
  output: 'Output',
};

function MissionNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MissionNodeData;
  const st = d.nodeStatus;
  const style = STATUS_STYLES[st] || STATUS_STYLES.pending;
  const dot = DOT_COLORS[st] || DOT_COLORS.pending;

  return (
    <Card
      className={`min-w-[200px] max-w-[220px] ${style.border} ${style.bg} ${style.anim} shadow-lg transition-all ${d.hasOutput ? 'cursor-pointer hover:brightness-110' : ''} ${d.isSelected ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-zinc-950' : ''}`}
    ><CardContent className="p-4 relative">
      {/* Status dot */}
      <div className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${dot}`} />

      {/* Handles */}
      {!d.isFirst && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ width: 10, height: 10, background: '#7c3aed', border: '2px solid #09090b' }}
        />
      )}
      {!d.isLast && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ width: 10, height: 10, background: '#7c3aed', border: '2px solid #09090b' }}
        />
      )}

      {/* Icon + name */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{TEMPLATE_ICONS[d.template] || TEMPLATE_ICONS.custom}</span>
        <span className="text-sm font-semibold text-zinc-100 truncate">{d.label}</span>
      </div>

      {/* Status */}
      <Badge variant="secondary" className="text-[10px] mb-2">
        {st === 'deploying' && d.queuedSince ? 'Queued for GPU...' : (STATUS_LABELS[st] || st)}
      </Badge>

      {/* Mission text (for mission node) */}
      {st === 'mission' && d.missionText && (
        <p className="text-xs text-zinc-400 line-clamp-3">{d.missionText}</p>
      )}

      {/* Task (for agent nodes) */}
      {st !== 'mission' && st !== 'output' && d.task && (
        <p className="text-xs text-zinc-500 line-clamp-2 mb-2">{d.task}</p>
      )}

      {/* Market + cost */}
      {d.market && (st === 'deployed' || st === 'ready' || st === 'processing' || st === 'complete') && (
        <div className="text-[10px] text-zinc-600 mb-1">
          {d.market} {d.costPerHour != null && `\u00B7 $${d.costPerHour.toFixed(3)}/hr`}
        </div>
      )}

      {/* Output preview */}
      {st === 'complete' && d.outputPreview && (
        <div className="mt-2 pt-2 border-t border-zinc-700/30">
          <p className="text-xs text-zinc-400 line-clamp-3">{d.outputPreview}</p>
        </div>
      )}

      {/* Final output (for output node) */}
      {st === 'output' && d.finalOutput && (
        <div className="mt-1">
          <p className="text-xs text-zinc-400 line-clamp-4">{d.finalOutput}</p>
        </div>
      )}

      {/* Error */}
      {st === 'error' && d.error && (
        <div className="mt-2 pt-2 border-t border-red-900/50">
          <p className="text-xs text-red-400 line-clamp-2">{d.error}</p>
        </div>
      )}

      {/* Click hint for completed nodes */}
      {d.hasOutput && !d.isSelected && (
        <div className="mt-2 pt-2 border-t border-zinc-700/30 text-center">
          <span className="text-[10px] text-violet-400/70 hover:text-violet-400">Click to view output &#x2192;</span>
        </div>
      )}
    </CardContent></Card>
  );
}

export const MissionNode = memo(MissionNodeComponent);
