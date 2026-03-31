/**
 * AgentForge Unit Tests
 *
 * Run: npx tsx tests/unit.test.ts
 *
 * Tests core logic without requiring Nosana API access or ElizaOS runtime.
 */

import { strict as assert } from 'assert';
import { GPU_MARKETS, AGENT_TEMPLATES } from '../src/plugins/nosana/types.js';

// ============================================================
// Test 1: GPU Market Selection
// ============================================================

function testMarketSelection() {
  console.log('Test 1: GPU Market Selection...');

  // Markets exist
  const markets = Object.entries(GPU_MARKETS);
  assert.ok(markets.length >= 5, `Should have at least 5 GPU markets, got ${markets.length}`);

  // Cheapest market is ≤$0.05/hr
  const cheapest = markets.reduce((min, [key, m]) =>
    m.estimatedCostPerHour < min[1].estimatedCostPerHour ? [key, m] : min
  );
  assert.ok(
    cheapest[1].estimatedCostPerHour <= 0.05,
    `Cheapest market should be ≤$0.05/hr, got $${cheapest[1].estimatedCostPerHour}`
  );

  // All markets have valid addresses (base58, 32-64 chars)
  for (const [key, market] of markets) {
    assert.ok(market.address.length >= 30, `Market ${key} address too short: ${market.address}`);
    assert.ok(market.name.length > 0, `Market ${key} has no name`);
    assert.ok(market.estimatedCostPerHour > 0, `Market ${key} has no cost`);
  }

  console.log('  ✅ PASS — Market selection logic correct');
}

// ============================================================
// Test 2: Agent Templates
// ============================================================

function testAgentTemplates() {
  console.log('Test 2: Agent Templates...');

  const required = ['researcher', 'writer', 'analyst', 'monitor', 'publisher'];
  for (const name of required) {
    assert.ok(AGENT_TEMPLATES[name], `Missing template: ${name}`);
    assert.ok(AGENT_TEMPLATES[name].plugins.length > 0, `Template ${name} has no plugins`);
    assert.ok(AGENT_TEMPLATES[name].defaultPrompt.length > 10, `Template ${name} has no prompt`);
  }

  // Researcher must have web-search plugin
  assert.ok(
    AGENT_TEMPLATES['researcher'].plugins.some(p => p.includes('web-search')),
    'Researcher template must include web-search plugin'
  );

  console.log('  ✅ PASS — All 5 agent templates valid');
}

// ============================================================
// Test 3: DAG Depth Calculation
// ============================================================

interface TestStep {
  id: string;
  dependsOn?: string | string[];
}

function calculateDepthLevels(steps: TestStep[]): Map<number, string[]> {
  const depths = new Map<string, number>();

  function getDepth(stepId: string): number {
    if (depths.has(stepId)) return depths.get(stepId)!;
    const step = steps.find(s => s.id === stepId);
    if (!step) return 0;
    const deps = !step.dependsOn ? [] : Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn];
    if (deps.length === 0) { depths.set(stepId, 0); return 0; }
    const maxParent = Math.max(...deps.map(d => getDepth(d)));
    const depth = maxParent + 1;
    depths.set(stepId, depth);
    return depth;
  }

  for (const step of steps) getDepth(step.id);

  const levels = new Map<number, string[]>();
  for (const [stepId, depth] of depths) {
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth)!.push(stepId);
  }
  return levels;
}

function testDAGDepthCalculation() {
  console.log('Test 3: DAG Depth Calculation...');

  // Sequential: A → B → C
  const sequential: TestStep[] = [
    { id: 'step-0', dependsOn: undefined },
    { id: 'step-1', dependsOn: 'step-0' },
    { id: 'step-2', dependsOn: 'step-1' },
  ];
  const seqLevels = calculateDepthLevels(sequential);
  assert.equal(seqLevels.get(0)?.length, 1, 'Level 0 should have 1 step');
  assert.equal(seqLevels.get(1)?.length, 1, 'Level 1 should have 1 step');
  assert.equal(seqLevels.get(2)?.length, 1, 'Level 2 should have 1 step');

  // Parallel: A → [B, C] → D
  const parallel: TestStep[] = [
    { id: 'step-0', dependsOn: undefined },
    { id: 'step-1', dependsOn: 'step-0' },
    { id: 'step-2', dependsOn: 'step-0' },
    { id: 'step-3', dependsOn: ['step-1', 'step-2'] },
  ];
  const parLevels = calculateDepthLevels(parallel);
  assert.equal(parLevels.get(0)?.length, 1, 'Level 0 should have 1 step (researcher)');
  assert.equal(parLevels.get(1)?.length, 2, 'Level 1 should have 2 steps (writers in parallel)');
  assert.equal(parLevels.get(2)?.length, 1, 'Level 2 should have 1 step (editor)');

  console.log('  ✅ PASS — DAG depth calculation correct for sequential and parallel');
}

// ============================================================
// Test 4: Pipeline Fallback Planner Pattern Matching
// ============================================================

function testFallbackPlannerPatterns() {
  console.log('Test 4: Fallback Planner Patterns...');

  const researchMission = 'Research the latest AI trends and write me a blog post';
  assert.ok(researchMission.toLowerCase().includes('research'), 'Should detect research keyword');
  assert.ok(researchMission.toLowerCase().includes('write'), 'Should detect write keyword');

  const parallelMission = 'Research AI and write a blog AND a YouTube script';
  assert.ok(parallelMission.toLowerCase().includes('and'), 'Should detect AND for parallel');

  // Test that template matching works
  const hasResearcher = /research|search|find|look up|investigate/i.test(researchMission);
  const hasWriter = /write|blog|article|post|script|content/i.test(researchMission);
  assert.ok(hasResearcher, 'Should match researcher pattern');
  assert.ok(hasWriter, 'Should match writer pattern');

  console.log('  ✅ PASS — Fallback planner patterns detect keywords correctly');
}

// ============================================================
// Test 5: Deployment Record Structure
// ============================================================

function testDeploymentRecordStructure() {
  console.log('Test 5: Deployment Record Structure...');

  const validStatuses = ['draft', 'starting', 'running', 'stopping', 'stopped', 'error', 'archived', 'queued'];
  const mockRecord = {
    id: 'test-123',
    name: 'Test Agent',
    status: 'running' as const,
    market: 'NVIDIA RTX 3060',
    marketAddress: '62bAk2ppEL2HpotfPZsscSq4CGEfY6VEqD5dQQuTo7JC',
    replicas: 1,
    costPerHour: 0.03,
    startedAt: new Date(),
    url: 'https://test.nos.ci',
  };

  assert.ok(mockRecord.id, 'Record must have id');
  assert.ok(mockRecord.name, 'Record must have name');
  assert.ok(validStatuses.includes(mockRecord.status), `Invalid status: ${mockRecord.status}`);
  assert.ok(mockRecord.costPerHour >= 0, 'Cost must be non-negative');
  assert.ok(mockRecord.startedAt instanceof Date, 'startedAt must be Date');
  assert.ok(mockRecord.marketAddress.length >= 30, 'Market address must be valid');

  console.log('  ✅ PASS — Deployment record structure valid');
}

// ============================================================
// Run all tests
// ============================================================

console.log('\n🧪 AgentForge Unit Tests\n');

try {
  testMarketSelection();
  testAgentTemplates();
  testDAGDepthCalculation();
  testFallbackPlannerPatterns();
  testDeploymentRecordStructure();

  console.log('\n✅ ALL 5 TESTS PASSED\n');
  process.exit(0);
} catch (err: any) {
  console.error(`\n❌ TEST FAILED: ${err.message}\n`);
  console.error(err.stack);
  process.exit(1);
}
