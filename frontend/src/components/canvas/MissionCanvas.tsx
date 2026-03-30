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
import { useMissionStore, type PipelineStep, type PipelineStatus } from '../../stores/missionStore';

const nodeTypes = { missionNode: MissionNode };

// ── DAG helper ───────────────────────────────────────────

function getDeps(step: PipelineStep): string[] {
  if (!step.dependsOn) return [];
  return Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
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

  useEffect(() => {
    if (!startedAt || status === 'idle') { setElapsed(0); return; }

    const endTime = completedAt || (status === 'complete' || status === 'error' ? Date.now() : null);
    if (endTime) {
      setElapsed(Math.floor((endTime - startedAt) / 1000));
      return;
    }

    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, completedAt, status]);

  const completedCount = steps.filter(s => s.status === 'complete').length;
  const processingSteps = steps.filter(s => s.status === 'processing');
  const totalCostPerHr = steps
    .filter(s => s.costPerHour && s.status !== 'pending')
    .reduce((sum, s) => sum + (s.costPerHour || 0), 0);

  const durationHrs = startedAt && completedAt ? (completedAt - startedAt) / 3_600_000 : 0;
  const totalCostEstimate = totalCostPerHr * durationHrs;

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
    <div className="flex items-center justify-between px-4 h-10 bg-zinc-900/80 backdrop-blur-sm border-b border-zinc-800 text-xs shrink-0">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-zinc-300">{statusLabel}</span>
      </div>
      <div className="flex items-center gap-4 text-zinc-500">
        <span>{completedCount}/{steps.length} complete</span>
        {status === 'complete' && totalCostEstimate > 0 && (
          <span className="text-green-400">${totalCostEstimate.toFixed(4)}</span>
        )}
        {status !== 'complete' && status !== 'error' && totalCostPerHr > 0 && (
          <span>${totalCostPerHr.toFixed(3)}/hr</span>
        )}
        <span className="tabular-nums">{timeStr}</span>
        {(status === 'complete' || status === 'error') && (
          <button
            onClick={onNewMission}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded transition-colors"
          >
            New Mission
          </button>
        )}
      </div>
    </div>
  );
}

// ── Idle state ───────────────────────────────────────────

function IdleState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="text-5xl">&#x26A1;</div>
      <h2 className="text-lg font-semibold text-zinc-300">Ready for a mission</h2>
      <p className="text-sm text-zinc-600 max-w-sm">
        Type something like &quot;Research AI trends and write a blog post&quot; in the chat
      </p>
    </div>
  );
}

// ── Canvas inner (requires ReactFlowProvider) ────────────

const SPACING_X = 300;
const SPACING_Y = 200;
const BASE_X = 80;
const CENTER_Y = 300;

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
        },
      });

      // ── Edges based on dependsOn ──
      const deps = getDeps(step);
      if (deps.length === 0) {
        const isProcessing = step.status === 'processing' || step.status === 'deploying';
        const isStarted = status !== 'idle' && status !== 'planning';
        allEdges.push({
          id: `e-mission-${step.id}`,
          source: 'mission',
          target: step.id,
          animated: isProcessing,
          className: isProcessing ? 'processing' : isStarted ? 'completed' : '',
          style: {
            stroke: step.status === 'error' ? '#ef4444'
              : isProcessing ? '#3b82f6'
              : isStarted ? '#22c55e'
              : '#6366f1',
            strokeWidth: 3,
            opacity: 0.8,
          },
        });
      } else {
        for (const depId of deps) {
          const parentStep = steps.find(s => s.id === depId);
          const isParentComplete = parentStep?.status === 'complete';
          const isError = step.status === 'error';
          const isProcessing = step.status === 'processing';

          allEdges.push({
            id: `e-${depId}-${step.id}`,
            source: depId,
            target: step.id,
            animated: isProcessing,
            className: isProcessing ? 'processing' : isParentComplete ? 'completed' : '',
            style: {
              stroke: isError ? '#ef4444'
                : isProcessing ? '#3b82f6'
                : isParentComplete ? '#22c55e'
                : '#6366f1',
              strokeWidth: 3,
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
          className: status === 'complete' ? 'completed' : isFlowing ? 'processing' : '',
          style: {
            stroke: status === 'complete' ? '#22c55e'
              : leaf.status === 'complete' ? '#3b82f6'
              : '#6366f1',
            strokeWidth: 3,
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
      const timer = setTimeout(() => fitView({ padding: 0.3, duration: 400 }), 200);
      return () => clearTimeout(timer);
    }
  }, [rfNodes.length, showOutput, selectedStep, fitView]);

  return (
    <div className="flex h-full bg-zinc-950">
      <div className="flex-1 flex flex-col min-w-0">
        <StatusBar
          status={status}
          startedAt={startedAt}
          completedAt={completedAt}
          steps={steps}
          onNewMission={handleNewMission}
        />
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_e, node) => {
              if (showOutput) return;
              const step = steps.find(s => s.id === node.id);
              if (step?.output || step?.error) {
                setSelectedNodeId(prev => prev === node.id ? null : node.id);
              }
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            fitViewOptions={{ padding: 0.3 }}
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
        </div>
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
          startedAt={startedAt}
          completedAt={completedAt}
        />
      )}
    </div>
  );
}

// ── Exported wrapper ─────────────────────────────────────

export function MissionCanvas() {
  const status = useMissionStore(s => s.status);

  if (status === 'idle') {
    return (
      <div className="h-full bg-zinc-950">
        <IdleState />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <MissionCanvasInner />
    </ReactFlowProvider>
  );
}
