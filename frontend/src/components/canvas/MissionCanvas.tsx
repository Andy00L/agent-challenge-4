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
import { useMissionStore, type PipelineStep, type PipelineStatus } from '../../stores/missionStore';

const nodeTypes = { missionNode: MissionNode };

function StatusBar({ status, startedAt, completedAt, steps }: {
  status: PipelineStatus;
  startedAt: number | null;
  completedAt: number | null;
  steps: PipelineStep[];
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
  const processingStep = steps.find(s => s.status === 'processing');
  const totalCost = steps
    .filter(s => s.costPerHour && s.status !== 'pending')
    .reduce((sum, s) => sum + (s.costPerHour || 0), 0);

  const statusLabel =
    status === 'planning' ? 'Planning pipeline...' :
    status === 'deploying' ? 'Deploying agents...' :
    status === 'executing' ? (processingStep ? `${processingStep.name} processing...` : 'Executing pipeline...') :
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
        {totalCost > 0 && <span>${totalCost.toFixed(3)}/hr</span>}
        <span className="tabular-nums">{timeStr}</span>
      </div>
    </div>
  );
}

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

function MissionCanvasInner() {
  const { steps, status, mission, finalOutput, startedAt, completedAt } = useMissionStore();
  const [showOutput, setShowOutput] = useState(false);
  const { fitView } = useReactFlow();

  // Auto-show output panel when mission completes
  useEffect(() => {
    if (status === 'complete' && finalOutput) setShowOutput(true);
    if (status === 'idle') setShowOutput(false);
  }, [status, finalOutput]);

  // Build ReactFlow nodes from pipeline steps
  const { rfNodes, rfEdges } = useMemo(() => {
    if (steps.length === 0 && status === 'idle') {
      return { rfNodes: [], rfEdges: [] };
    }

    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];
    const xGap = 300;
    const y = 200;
    let x = 50;

    // Mission node
    allNodes.push({
      id: 'mission',
      type: 'missionNode',
      position: { x, y },
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

    // Step nodes
    steps.forEach((step, i) => {
      x += xGap;
      const nodeId = step.id;
      allNodes.push({
        id: nodeId,
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
        },
      });

      // Edge from previous node
      const sourceId = i === 0 ? 'mission' : steps[i - 1].id;
      const isTargetProcessing = step.status === 'processing';
      const isSourceComplete = i === 0
        ? (status !== 'idle' && status !== 'planning')
        : steps[i - 1].status === 'complete';
      const isError = step.status === 'error';

      allEdges.push({
        id: `e-${sourceId}-${nodeId}`,
        source: sourceId,
        target: nodeId,
        animated: isTargetProcessing,
        style: {
          stroke: isError ? '#ef4444' : isTargetProcessing ? '#3b82f6' : isSourceComplete ? '#22c55e' : '#6366f1',
          strokeWidth: 3,
          opacity: 0.8,
        },
      });
    });

    // Output node (only if steps exist)
    if (steps.length > 0) {
      x += xGap;
      const lastStep = steps[steps.length - 1];
      const outputStatus = status === 'complete' ? 'output' : 'pending';

      allNodes.push({
        id: 'output',
        type: 'missionNode',
        position: { x, y },
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

      allEdges.push({
        id: `e-${lastStep.id}-output`,
        source: lastStep.id,
        target: 'output',
        animated: lastStep.status === 'complete' && status !== 'complete',
        style: {
          stroke: status === 'complete' ? '#22c55e' : lastStep.status === 'complete' ? '#3b82f6' : '#6366f1',
          strokeWidth: 3,
          opacity: 0.8,
        },
      });
    }

    return { rfNodes: allNodes, rfEdges: allEdges };
  }, [steps, status, mission, finalOutput]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync ReactFlow state when pipeline state changes
  useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  // Auto-fit view when node count changes or output panel toggles
  useEffect(() => {
    if (rfNodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.3, duration: 400 }), 200);
      return () => clearTimeout(timer);
    }
  }, [rfNodes.length, showOutput, fitView]);

  return (
    <div className="flex h-full bg-zinc-950">
      <div className="flex-1 flex flex-col min-w-0">
        <StatusBar status={status} startedAt={startedAt} completedAt={completedAt} steps={steps} />
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
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

      {showOutput && finalOutput && (
        <OutputPanel output={finalOutput} onClose={() => setShowOutput(false)} />
      )}
    </div>
  );
}

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
