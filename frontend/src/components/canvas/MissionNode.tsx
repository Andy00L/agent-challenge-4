import { memo } from 'react';
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
  pending:    { border: 'border-zinc-700',  bg: 'bg-zinc-900',       anim: '' },
  deploying:  { border: 'border-amber-600', bg: 'bg-amber-950/30',   anim: 'animate-node-pulse' },
  deployed:   { border: 'border-blue-800',  bg: 'bg-blue-950/20',    anim: '' },
  ready:      { border: 'border-blue-600',  bg: 'bg-blue-950/30',    anim: '' },
  processing: { border: 'border-blue-500',  bg: 'bg-blue-950/40',    anim: 'animate-node-glow' },
  complete:   { border: 'border-green-600', bg: 'bg-green-950/30',   anim: '' },
  error:      { border: 'border-red-600',   bg: 'bg-red-950/30',     anim: '' },
  stopped:    { border: 'border-zinc-600',  bg: 'bg-zinc-900/50',    anim: '' },
  mission:    { border: 'border-purple-600', bg: 'bg-purple-950/30', anim: '' },
  output:     { border: 'border-indigo-600', bg: 'bg-indigo-950/30', anim: '' },
};

const DOT_COLORS: Record<string, string> = {
  pending:    'bg-zinc-500',
  deploying:  'bg-amber-400 animate-pulse',
  deployed:   'bg-blue-400',
  ready:      'bg-blue-400',
  processing: 'bg-blue-500 animate-ping',
  complete:   'bg-green-400',
  error:      'bg-red-400',
  stopped:    'bg-zinc-500',
  mission:    'bg-purple-400',
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
    <div
      className={`relative min-w-[220px] max-w-[260px] rounded-xl border ${style.border} ${style.bg} ${style.anim} p-4 shadow-lg`}
    >
      {/* Status dot */}
      <div className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ${dot}`} />

      {/* Handles */}
      {!d.isFirst && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-zinc-900"
        />
      )}
      {!d.isLast && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-zinc-900"
        />
      )}

      {/* Icon + name */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{TEMPLATE_ICONS[d.template] || TEMPLATE_ICONS.custom}</span>
        <span className="text-sm font-semibold text-zinc-100 truncate">{d.label}</span>
      </div>

      {/* Status */}
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
        {STATUS_LABELS[st] || st}
      </div>

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
          {d.market} {d.costPerHour != null && `· $${d.costPerHour.toFixed(3)}/hr`}
        </div>
      )}

      {/* Output preview */}
      {st === 'complete' && d.outputPreview && (
        <div className="mt-2 pt-2 border-t border-zinc-800">
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
    </div>
  );
}

export const MissionNode = memo(MissionNodeComponent);
