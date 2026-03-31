import { useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { MissionNode } from './MissionNode';
import { OutputPanel } from './OutputPanel';
import { NodeOutputPanel } from './NodeOutputPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMissionStore, type PipelineStep, type PipelineStatus } from '../../stores/missionStore';

const nodeTypes = { missionNode: MissionNode };

// ── DAG helper ───────────────────────────────────────────

function getDeps(step: PipelineStep): string[] {
  if (!step.dependsOn) return [];
  return Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
}

// ── Edge helpers ─────────────────────────────────────────

function getEdgeClassName(sourceStatus?: string, targetStatus?: string): string {
  if (sourceStatus === 'processing' || targetStatus === 'processing') return 'edge-processing';
  if (sourceStatus === 'deploying' || targetStatus === 'deploying') return 'edge-deploying';
  if (sourceStatus === 'complete') return 'edge-complete';
  return '';
}

function getEdgeStrokeColor(sourceStatus?: string, targetStatus?: string): string {
  if (sourceStatus === 'processing' || targetStatus === 'processing') return '#6366f1';
  if (sourceStatus === 'deploying' || targetStatus === 'deploying') return '#f59e0b';
  if (sourceStatus === 'complete') return '#22c55e';
  if (sourceStatus === 'error' || targetStatus === 'error') return '#ef4444';
  return '#3f3f46';
}

function getEdgeWidth(sourceStatus?: string, targetStatus?: string): number {
  if (sourceStatus === 'processing' || targetStatus === 'processing') return 2.5;
  if (sourceStatus === 'complete') return 2;
  return 1.5;
}

// ── StatusBar ────────────────────────────────────────────

function StatusBar({ status, startedAt, completedAt, steps, onNewMission }: {
  status: PipelineStatus;
  startedAt: number | null;
  completedAt: number | null;
  steps: PipelineStep[];
  onNewMission: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!startedAt || status === 'idle') { setElapsed(0); return; }

    const endTime = completedAt || (status === 'complete' || status === 'error' ? Date.now() : null);
    if (endTime) {
      setElapsed(Math.floor((endTime - startedAt) / 1000));
      return;
    }

    const update = () => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      setTick(t => t + 1);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, completedAt, status]);

  const completedCount = steps.filter(s => s.status === 'complete').length;
  const processingSteps = steps.filter(s => s.status === 'processing');
  const activeAgentCount = steps.filter(s =>
    s.status === 'processing' || s.status === 'deploying' || s.status === 'deployed' || s.status === 'ready'
  ).length;

  const totalCostPerHr = steps
    .filter(s => s.costPerHour && s.status !== 'pending')
    .reduce((sum, s) => sum + (s.costPerHour || 0), 0);

  // Live cost calculation
  const activeCost = useMemo(() => {
    if (!startedAt || status === 'idle') return 0;
    const endTime = completedAt || Date.now();
    const elapsedHours = (endTime - startedAt) / (1000 * 60 * 60);
    return totalCostPerHr * elapsedHours;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, completedAt, status, totalCostPerHr, tick]);

  const statusLabel =
    status === 'planning' ? 'Planning pipeline...' :
    status === 'deploying' ? 'Deploying agents...' :
    status === 'executing' ? (
      processingSteps.length > 1
        ? `${processingSteps.length} agents processing in parallel...`
        : processingSteps.length === 1
          ? `${processingSteps[0].name} processing...`
          : 'Executing pipeline...'
    ) :
    status === 'complete' ? 'Mission complete' :
    status === 'error' ? 'Pipeline error' :
    '';

  if (status === 'idle') return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;

  const dotClass =
    status === 'complete' ? 'bg-green-400' :
    status === 'error' ? 'bg-red-400' :
    'bg-blue-400 animate-pulse';

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60 bg-zinc-900/60 text-xs shrink-0 overflow-hidden">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        {/* Status */}
        <Badge variant={status === 'complete' ? 'default' : status === 'error' ? 'destructive' : 'secondary'} className="gap-1.5 whitespace-nowrap shrink-0">
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          {statusLabel}
        </Badge>

        {/* Timer */}
        <span className="text-zinc-500 cost-counter whitespace-nowrap shrink-0">{timeStr}</span>

        {/* Live cost */}
        {totalCostPerHr > 0 && (
          <Badge variant="outline" className="cost-counter whitespace-nowrap shrink-0">
            ${activeCost.toFixed(4)} {status === 'complete' ? 'total' : 'spent'}
          </Badge>
        )}

        {/* Active agents count */}
        {activeAgentCount > 0 && status !== 'complete' && status !== 'error' && (
          <span className="text-zinc-500 whitespace-nowrap shrink-0">
            {activeAgentCount} agent{activeAgentCount > 1 ? 's' : ''} on Nosana
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-zinc-500 shrink-0 ml-3">
        <span className="whitespace-nowrap">{completedCount}/{steps.length} complete</span>
        {status !== 'planning' && (
          <Button variant="outline" size="sm" onClick={async () => {
              try {
                const res = await fetch('/fleet/mission/export');
                if (!res.ok) return;
                const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `agentforge-pipeline-${data.pipeline?.id || Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {}
            }}>
            Export
          </Button>
        )}
        {(status === 'complete' || status === 'error') && (
          <Button variant="ghost" size="sm" onClick={onNewMission}>
            New Mission
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Idle state ───────────────────────────────────────────

function IdleState() {
  return (
    <div className="h-full bg-zinc-950 relative">
      {/* Background dots for aesthetics */}
      <div className="absolute inset-0 opacity-20">
        <svg width="100%" height="100%">
          <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#333" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        <div className="text-center max-w-md">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-500/20 border border-violet-500/20 flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">&#x26A1;</span>
          </div>

          <h2 className="text-lg font-semibold text-zinc-300 mb-2">
            Ready to orchestrate
          </h2>
          <p className="text-sm text-zinc-500 mb-8 leading-relaxed">
            Type a mission in the chat to deploy AI agents across
            Nosana's decentralized GPU network. Watch them work in real-time on this canvas.
          </p>

          {/* Mini pipeline illustration */}
          <div className="flex items-center justify-center gap-3 opacity-40">
            <div className="w-20 h-10 rounded-lg border border-zinc-700 flex items-center justify-center bg-zinc-900/50">
              <span className="text-[10px] text-zinc-500">&#x1F50D; Research</span>
            </div>
            <svg width="24" height="12" className="text-zinc-600"><path d="M0 6h18m-4-4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            <div className="w-20 h-10 rounded-lg border border-zinc-700 flex items-center justify-center bg-zinc-900/50">
              <span className="text-[10px] text-zinc-500">&#x270D;&#xFE0F; Write</span>
            </div>
            <svg width="24" height="12" className="text-zinc-600"><path d="M0 6h18m-4-4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            <div className="w-20 h-10 rounded-lg border border-zinc-700 flex items-center justify-center bg-zinc-900/50">
              <span className="text-[10px] text-zinc-500">&#x1F4E6; Output</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Canvas inner (requires ReactFlowProvider) ────────────

const SPACING_X = 350;
const SPACING_Y = 220;
const BASE_X = 0;
const CENTER_Y = 0;

function MissionCanvasInner() {
  const { steps, status, mission, finalOutput, startedAt, completedAt } = useMissionStore();
  const [showOutput, setShowOutput] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  const handleNewMission = async () => {
    useMissionStore.getState().reset();
    try { await fetch('/fleet/mission/reset', { method: 'POST' }); } catch {}
  };

  // Auto-show output panel when mission completes
  useEffect(() => {
    if (status === 'complete' && finalOutput) setShowOutput(true);
    if (status === 'idle') setShowOutput(false);
  }, [status, finalOutput]);

  // Close node panel when output panel opens
  useEffect(() => {
    if (showOutput) setSelectedNodeId(null);
  }, [showOutput]);

  const selectedStep = selectedNodeId ? steps.find(s => s.id === selectedNodeId) : null;

  // Build ReactFlow nodes + edges from pipeline steps (DAG-aware)
  const { rfNodes, rfEdges } = useMemo(() => {
    if (steps.length === 0 && status === 'idle') {
      return { rfNodes: [], rfEdges: [] };
    }

    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    // ── Mission node ──
    allNodes.push({
      id: 'mission',
      type: 'missionNode',
      position: { x: BASE_X, y: CENTER_Y },
      data: {
        label: 'Mission',
        template: 'mission',
        task: '',
        nodeStatus: 'mission',
        isFirst: true,
        isLast: steps.length === 0,
        missionText: mission,
      },
    });

    // ── Agent step nodes ──
    const maxDepth = Math.max(...steps.map(s => s.depth ?? 0), 0);

    steps.forEach((step, i) => {
      const depth = step.depth ?? i;
      const pIdx = step.parallelIndex ?? 0;
      const pCount = step.parallelCount ?? 1;

      const x = BASE_X + (depth + 1) * SPACING_X;
      const totalHeight = (pCount - 1) * SPACING_Y;
      const y = CENTER_Y - totalHeight / 2 + pIdx * SPACING_Y;

      allNodes.push({
        id: step.id,
        type: 'missionNode',
        position: { x, y },
        data: {
          label: step.name,
          template: step.template,
          task: step.task,
          nodeStatus: step.status,
          outputPreview: step.outputPreview,
          error: step.error,
          market: step.market,
          costPerHour: step.costPerHour,
          isFirst: false,
          isLast: false,
          isSelected: step.id === selectedNodeId,
          hasOutput: !!(step.output || step.error),
          queuedSince: step.queuedSince,
        },
      });

      // ── Edges based on dependsOn ──
      const deps = getDeps(step);
      if (deps.length === 0) {
        const isProcessing = step.status === 'processing' || step.status === 'deploying';
        const isStarted = status !== 'idle' && status !== 'planning';
        const missionStatus = isStarted ? 'complete' : undefined;

        allEdges.push({
          id: `e-mission-${step.id}`,
          source: 'mission',
          target: step.id,
          animated: isProcessing,
          className: getEdgeClassName(missionStatus, step.status),
          style: {
            stroke: getEdgeStrokeColor(missionStatus, step.status),
            strokeWidth: getEdgeWidth(missionStatus, step.status),
            opacity: 0.8,
          },
        });
      } else {
        for (const depId of deps) {
          const parentStep = steps.find(s => s.id === depId);

          allEdges.push({
            id: `e-${depId}-${step.id}`,
            source: depId,
            target: step.id,
            animated: step.status === 'processing' || step.status === 'deploying',
            className: getEdgeClassName(parentStep?.status, step.status),
            style: {
              stroke: getEdgeStrokeColor(parentStep?.status, step.status),
              strokeWidth: getEdgeWidth(parentStep?.status, step.status),
              opacity: 0.8,
            },
          });
        }
      }
    });

    // ── Output node ──
    if (steps.length > 0) {
      const outputX = BASE_X + (maxDepth + 2) * SPACING_X;
      const outputStatus = status === 'complete' ? 'output' : 'pending';

      allNodes.push({
        id: 'output',
        type: 'missionNode',
        position: { x: outputX, y: CENTER_Y },
        data: {
          label: 'Output',
          template: 'output',
          task: '',
          nodeStatus: outputStatus,
          isFirst: false,
          isLast: true,
          finalOutput: finalOutput?.slice(0, 200),
          hasOutput: !!finalOutput,
        },
      });

      const leafSteps = steps.filter(s =>
        !steps.some(other => getDeps(other).includes(s.id))
      );

      for (const leaf of leafSteps) {
        const isFlowing = leaf.status === 'complete' && status !== 'complete';
        allEdges.push({
          id: `e-${leaf.id}-output`,
          source: leaf.id,
          target: 'output',
          animated: isFlowing,
          className: status === 'complete' ? 'edge-complete' : isFlowing ? 'edge-processing' : '',
          style: {
            stroke: status === 'complete' ? '#22c55e'
              : leaf.status === 'complete' ? '#6366f1'
              : '#3f3f46',
            strokeWidth: status === 'complete' ? 2 : isFlowing ? 2.5 : 1.5,
            opacity: 0.8,
          },
        });
      }
    }

    return { rfNodes: allNodes, rfEdges: allEdges };
  }, [steps, status, mission, finalOutput, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  useEffect(() => {
    if (rfNodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 200);
      return () => clearTimeout(timer);
    }
  }, [rfNodes.length, showOutput, selectedStep, fitView]);

  return (
    <div className="relative flex h-full bg-zinc-950">
      <div className="flex-1 flex flex-col min-w-0">
        <StatusBar
          status={status}
          startedAt={startedAt}
          completedAt={completedAt}
          steps={steps}
          onNewMission={handleNewMission}
        />
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_e, node) => {
              // Clicking the Output node toggles the final OutputPanel
              if (node.id === 'output' && finalOutput) {
                setShowOutput(prev => !prev);
                setSelectedNodeId(null);
                return;
              }
              // Clicking a step node opens its individual output
              const step = steps.find(s => s.id === node.id);
              if (step?.output || step?.error) {
                setShowOutput(false);
                setSelectedNodeId(prev => prev === node.id ? null : node.id);
              }
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.3}
            maxZoom={1.5}
          >
            <Background variant={BackgroundVariant.Dots} color="#333" gap={20} />
            <Controls position="bottom-left" />
          </ReactFlow>

          {/* Overlay panels — positioned absolute so they don't push the canvas */}
          {selectedStep && !showOutput && (
            <NodeOutputPanel step={selectedStep} onClose={() => setSelectedNodeId(null)} />
          )}

          {showOutput && finalOutput && (
            <OutputPanel
              output={finalOutput}
              onClose={() => setShowOutput(false)}
              onNewMission={handleNewMission}
              steps={steps}
              startedAt={startedAt}
              completedAt={completedAt}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Exported wrapper ─────────────────────────────────────

export function MissionCanvas() {
  const status = useMissionStore(s => s.status);

  if (status === 'idle') {
    return <IdleState />;
  }

  return (
    <ReactFlowProvider>
      <MissionCanvasInner />
    </ReactFlowProvider>
  );
}
