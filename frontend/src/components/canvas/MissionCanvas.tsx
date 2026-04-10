import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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

import { RotateCcw, StopCircle } from 'lucide-react';
import { MissionNode } from './MissionNode';
import { OutputPanel } from './OutputPanel';
import { NodeOutputPanel } from './NodeOutputPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMissionStore, type PipelineStep, type PipelineStatus } from '../../stores/missionStore';
import { fleetFetch } from '../../lib/fleetFetch';

const nodeTypes = { missionNode: MissionNode };

// -- DAG helper ---
function getDeps(step: PipelineStep): string[] {
  if (!step.dependsOn) return [];
  return Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
}

// -- Edge helpers ---
function getEdgeClassName(sourceStatus?: string, targetStatus?: string): string {
  if (sourceStatus === 'processing' || targetStatus === 'processing') return 'edge-processing';
  if (sourceStatus === 'deploying' || targetStatus === 'deploying') return 'edge-deploying';
  if (sourceStatus === 'complete') return 'edge-complete';
  return '';
}

function getEdgeStrokeColor(sourceStatus?: string, targetStatus?: string): string {
  if (sourceStatus === 'processing' || targetStatus === 'processing') return '#3B82F6';
  if (sourceStatus === 'deploying' || targetStatus === 'deploying') return '#f59e0b';
  if (sourceStatus === 'complete') return '#22c55e';
  if (sourceStatus === 'error' || targetStatus === 'error') return '#ef4444';
  if (sourceStatus === 'skipped' || targetStatus === 'skipped') return '#D1CBC3';
  return '#D1CBC3';
}

function getEdgeWidth(sourceStatus?: string, targetStatus?: string): number {
  if (sourceStatus === 'processing' || targetStatus === 'processing') return 2.5;
  if (sourceStatus === 'complete') return 2;
  return 1.5;
}

// -- StatusBar ---
function StatusBar({ status, startedAt, completedAt, steps, onNewMission, hasManualMoves, onResetLayout, isHistorical }: {
  status: PipelineStatus;
  startedAt: number | null;
  completedAt: number | null;
  steps: PipelineStep[];
  onNewMission: () => void;
  hasManualMoves?: boolean;
  isHistorical?: boolean;
  onResetLayout?: () => void;
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
    status === 'complete' ? 'bg-green-500' :
    status === 'error' ? 'bg-red-500' :
    'bg-blue-500 animate-pulse';

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b bg-white/90 backdrop-blur-sm shadow-xs text-xs shrink-0 overflow-hidden">
      <div className="flex items-center gap-4 min-w-0 overflow-hidden">
        {/* Status */}
        <Badge variant={status === 'complete' ? 'default' : status === 'error' ? 'destructive' : 'secondary'} className="gap-1.5 whitespace-nowrap shrink-0 font-semibold">
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          {statusLabel}
        </Badge>

        {/* Historical badge */}
        {isHistorical && (
          <Badge variant="outline" className="whitespace-nowrap shrink-0 text-muted-foreground">
            Past mission
          </Badge>
        )}

        {/* Timer */}
        <span className="text-muted-foreground cost-counter whitespace-nowrap shrink-0 px-2 py-0.5 bg-muted rounded-full text-[11px]">{timeStr}</span>

        {/* Live cost */}
        {totalCostPerHr > 0 && (
          <span className="cost-counter whitespace-nowrap shrink-0 px-2 py-0.5 bg-muted rounded-full text-[11px] text-muted-foreground">
            ${activeCost.toFixed(4)}
          </span>
        )}

        {/* Active agents count */}
        {activeAgentCount > 0 && status !== 'complete' && status !== 'error' && (
          <span className="whitespace-nowrap shrink-0 px-2 py-0.5 bg-muted rounded-full text-[11px] text-muted-foreground">
            {activeAgentCount} agent{activeAgentCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-4">
        <span className="whitespace-nowrap font-medium">{completedCount}/{steps.length} complete</span>
        {hasManualMoves && onResetLayout && (
          <button
            onClick={onResetLayout}
            className="flex items-center gap-1.5 border border-[var(--border-default)] rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Layout
          </button>
        )}
        {status !== 'planning' && (
          <Button variant="outline" size="sm" className="hover:shadow-xs transition-all duration-150" onClick={async () => {
              try {
                const res = await fleetFetch('/fleet/mission/export');
                if (!res.ok) return;
                const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `agentforge-pipeline-${data.pipeline?.id || Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                console.warn('[MissionCanvas] Export failed:', e);
              }
            }}>
            Export
          </Button>
        )}
        {!isHistorical && status !== 'complete' && status !== 'error' && (
          <Button variant="outline" size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:shadow-xs active:scale-[0.98] transition-all duration-150"
            onClick={async () => {
              try {
                await fleetFetch('/fleet/mission/abort', { method: 'POST' });
              } catch (e) {
                console.warn('[MissionCanvas] Abort failed:', e);
              }
            }}>
            <StopCircle className="w-3 h-3" />
            Abort
          </Button>
        )}
        {(status === 'complete' || status === 'error') && (
          <Button size="sm" className="shadow-sm hover:shadow-md hover:-translate-y-px active:translate-y-0 transition-all duration-200" onClick={onNewMission}>
            New Mission
          </Button>
        )}
      </div>
    </div>
  );
}

// -- Idle state ---
function IdleState() {
  return (
    <div className="h-full bg-muted/40 relative">
      {/* Background dots for aesthetics */}
      <div className="absolute inset-0 opacity-60">
        <svg width="100%" height="100%">
          <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1.5" fill="#D1CBC3" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        <div className="text-center max-w-md">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-muted border flex items-center justify-center mx-auto mb-6 shadow-sm">
            <span className="text-3xl">&#x26A1;</span>
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2 tracking-tight">
            Ready to orchestrate
          </h2>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            Type a mission in the chat to deploy AI agents across
            Nosana's decentralized GPU network. Watch them work in real-time on this canvas.
          </p>

          {/* Mini pipeline illustration */}
          <div className="flex items-center justify-center gap-3 opacity-50">
            <div className="w-20 h-10 rounded-lg border flex items-center justify-center bg-white shadow-xs">
              <span className="text-[10px] text-muted-foreground">&#x1F50D; Research</span>
            </div>
            <svg width="24" height="12" className="text-border"><path d="M0 6h18m-4-4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            <div className="w-20 h-10 rounded-lg border flex items-center justify-center bg-white shadow-xs">
              <span className="text-[10px] text-muted-foreground">&#x270D;&#xFE0F; Write</span>
            </div>
            <svg width="24" height="12" className="text-border"><path d="M0 6h18m-4-4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            <div className="w-20 h-10 rounded-lg border flex items-center justify-center bg-white shadow-xs">
              <span className="text-[10px] text-muted-foreground">&#x1F4E6; Output</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Canvas inner (requires ReactFlowProvider) ---

const SPACING_X = 350;
const SPACING_Y = 220;
const BASE_X = 0;
const CENTER_Y = 0;

function MissionCanvasInner() {
  const { steps, status, mission, finalOutput, startedAt, completedAt, pipelineId, isHistorical, warnings } = useMissionStore();
  const [showOutput, setShowOutput] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hasManualMoves, setHasManualMoves] = useState(false);
  const { fitView } = useReactFlow();
  const manuallyMoved = useRef<Set<string>>(new Set());
  const prevPipelineIdRef = useRef<string | null>(null);

  const handleNewMission = async () => {
    useMissionStore.getState().reset();
    try { await fleetFetch('/fleet/mission/reset', { method: 'POST' }); } catch (e) { console.warn('[MissionCanvas] Reset failed:', e); }
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

  // Reset manually moved nodes when a new mission starts
  useEffect(() => {
    if (pipelineId && pipelineId !== prevPipelineIdRef.current) {
      manuallyMoved.current.clear();
      setHasManualMoves(false);
    }
    prevPipelineIdRef.current = pipelineId;
  }, [pipelineId]);

  const selectedStep = selectedNodeId ? steps.find(s => s.id === selectedNodeId) : null;

  // Build ReactFlow nodes + edges from pipeline steps (DAG-aware)
  const { rfNodes, rfEdges } = useMemo(() => {
    if (steps.length === 0 && status === 'idle') {
      return { rfNodes: [], rfEdges: [] };
    }

    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    // -- Mission node --
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

    // -- Agent step nodes --
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
          outputType: step.outputType,
          outputUrls: step.outputUrls,
          imageCount: (step as any).imageCount,
          totalImages: (step as any).totalImages,
        },
      });

      // -- Edges based on dependsOn --
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

    // -- Output node --
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
              : leaf.status === 'complete' ? '#3B82F6'
              : '#D1CBC3',
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

  // Track user drag — mark node as manually moved when drag ends
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      for (const c of changes) {
        if (c.type === 'position' && (c as any).dragging === false && (c as any).position) {
          manuallyMoved.current.add(c.id);
          setHasManualMoves(true);
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange]
  );

  // Reset layout: clear manual positions and re-apply auto-layout
  const handleResetLayout = useCallback(() => {
    manuallyMoved.current.clear();
    setHasManualMoves(false);
    setNodes(rfNodes);
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50);
  }, [rfNodes, setNodes, fitView]);

  // Sync computed layout → ReactFlow state, preserving manually dragged positions
  useEffect(() => {
    setNodes(currentNodes => {
      const currentPos = new Map(currentNodes.map(n => [n.id, n.position]));
      return rfNodes.map(n => {
        const pos = currentPos.get(n.id);
        if (manuallyMoved.current.has(n.id) && pos) {
          return { ...n, position: pos };
        }
        return n;
      });
    });
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  useEffect(() => {
    if (rfNodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 200);
      return () => clearTimeout(timer);
    }
  }, [rfNodes.length, showOutput, selectedStep, fitView]);

  return (
    <div className="relative flex h-full bg-background">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <StatusBar
          status={status}
          startedAt={startedAt}
          completedAt={completedAt}
          steps={steps}
          onNewMission={handleNewMission}
          hasManualMoves={hasManualMoves}
          onResetLayout={handleResetLayout}
          isHistorical={isHistorical}
        />
        {warnings.length > 0 && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex flex-col gap-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-yellow-700 text-xs">
                <span>{'\u26A0\uFE0F'}</span>
                <span>{w.step ? <><strong>{w.step}:</strong> {w.message}</> : w.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 relative min-h-0">
          <div className="absolute inset-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_e, node) => {
              if (node.id === 'output' && finalOutput) {
                setShowOutput(prev => !prev);
                setSelectedNodeId(null);
                return;
              }
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
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.3}
            maxZoom={1.5}
          >
            <Background
              variant={BackgroundVariant.Dots}
              color={status === 'complete' ? '#7aad7a' : status === 'executing' || status === 'deploying' ? '#a09a9a' : '#b0b0a8'}
              gap={22}
              size={1.5}
            />
            <Controls position="bottom-left" />
          </ReactFlow>
          </div>

          {selectedStep && !showOutput && (
            <NodeOutputPanel step={selectedStep} onClose={() => setSelectedNodeId(null)} />
          )}

          {showOutput && finalOutput && (
            <OutputPanel
              output={finalOutput}
              onClose={() => setShowOutput(false)}
              onNewMission={handleNewMission}
              steps={steps}
              warnings={warnings}
              startedAt={startedAt}
              completedAt={completedAt}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// -- Exported wrapper ---

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
