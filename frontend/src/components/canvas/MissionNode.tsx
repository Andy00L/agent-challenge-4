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

const STATUS_STYLES: Record<string, { accent: string; bg: string; anim: string }> = {
  pending:    { accent: 'border-l-[3px] border-l-gray-300',       bg: 'bg-white',    anim: '' },
  deploying:  { accent: 'border-l-[3px] border-l-amber-400',      bg: 'bg-white',    anim: 'animate-node-pulse' },
  deployed:   { accent: 'border-l-[3px] border-l-blue-400',       bg: 'bg-white',    anim: '' },
  ready:      { accent: 'border-l-[3px] border-l-blue-400',       bg: 'bg-white',    anim: '' },
  queued:     { accent: 'border-l-[3px] border-l-amber-400',      bg: 'bg-white',    anim: 'animate-node-pulse' },
  processing: { accent: 'border-l-[3px] border-l-blue-500',       bg: 'bg-white',    anim: 'animate-node-glow' },
  complete:   { accent: 'border-l-[3px] border-l-green-500',      bg: 'bg-white',    anim: 'node-complete-pop' },
  error:      { accent: 'border-l-[3px] border-l-red-500',        bg: 'bg-white',    anim: '' },
  stopped:    { accent: 'border-l-[3px] border-l-gray-300',       bg: 'bg-white',    anim: 'opacity-60' },
  mission:    { accent: 'border-l-[3px] border-l-foreground',     bg: 'bg-white',    anim: '' },
  output:     { accent: 'border-l-[3px] border-l-foreground',     bg: 'bg-white',    anim: '' },
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
  stopped:    'bg-gray-400',
  mission:    'bg-foreground',
  output:     'bg-foreground',
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
      className={`min-w-[180px] max-w-[220px] ${style.accent} ${style.bg} ${style.anim} shadow-sm transition-all duration-250 ${d.hasOutput ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''} ${d.isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md' : ''}`}
    ><CardContent className="p-4 relative">
      {/* Status dot */}
      <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${dot}`} />

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

      {/* Status */}
      <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-semibold mb-2">
        {st === 'deploying' && d.queuedSince ? 'Queued for GPU...' : (STATUS_LABELS[st] || st)}
      </Badge>

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

      {/* Output preview */}
      {st === 'complete' && d.outputPreview && (
        <div className="mt-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground line-clamp-3 italic">{d.outputPreview}</p>
        </div>
      )}

      {/* Final output (for output node) */}
      {st === 'output' && d.finalOutput && (
        <div className="mt-1">
          <p className="text-xs text-muted-foreground line-clamp-4">{d.finalOutput}</p>
        </div>
      )}

      {/* Error */}
      {st === 'error' && d.error && (
        <div className="mt-2 pt-2 border-t border-red-200">
          <p className="text-xs text-red-600 line-clamp-2">{d.error}</p>
        </div>
      )}

      {/* Click hint for completed nodes */}
      {d.hasOutput && !d.isSelected && (
        <div className="mt-2 pt-2 border-t text-center">
          <span className="text-[10px] font-medium text-blue-600 hover:underline">Click to view output &#x2192;</span>
        </div>
      )}
    </CardContent></Card>
  );
}

export const MissionNode = memo(MissionNodeComponent);
