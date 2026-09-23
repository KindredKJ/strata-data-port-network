import assert from "node:assert/strict";
import test from "node:test";

import {
  COGNITIVE_PORT_TYPES,
  CognitiveGraph,
  CognitivePortFabric,
  DCMLCompiler,
  createCogniton,
  createProcessPortAttachment,
  executeActivationPlan,
} from "../src/cognitive-body.mjs";

import {
  PROCESS_INTELLIGENCE_REQUEST_TYPES,
  ProcessIntelligenceBoundaryAdapter,
} from "../src/process-intelligence.mjs";

test("canonical cognitive body deterministic seed proof", async () => {
  const first = createCogniton({
    kind: "INTENT",
    value: {
      intent_class: "TEST.DO_WORK",
      text: "perform deterministic test work",
    },
    provenance: {
      source: "focused-test",
    },
  });

  const second = createCogniton({
    kind: "INTENT",
    value: {
      intent_class: "TEST.DO_WORK",
      text: "perform deterministic test work",
    },
    provenance: {
      source: "focused-test",
    },
  });

  assert.equal(
    first.cogniton_id,
    second.cogniton_id,
    "Equivalent Cognitons must be deterministically addressable",
  );

  assert.equal(
    first.state_root,
    second.state_root,
    "Equivalent Cogniton state must have the same root",
  );

  const graphA = new CognitiveGraph();
  graphA.add(first);
  graphA.activate(first.cogniton_id);

  const graphB = new CognitiveGraph();
  graphB.add(second);
  graphB.activate(second.cogniton_id);

  const graphSnapshotA = graphA.snapshot();
  const graphSnapshotB = graphB.snapshot();

  assert.equal(
    graphSnapshotA.state_root,
    graphSnapshotB.state_root,
    "Equivalent cognitive graphs must converge to the same root",
  );

  const processCalls = [];
  const preparedCalls = [];

  const fakeProcessBoundary = {
    request(requestType, payload = {}) {
      preparedCalls.push({
        requestType,
        payload,
      });

      return {
        contract_version: "fixture.process-boundary.v1",
        request_type: requestType,
        payload,
        external_effects_authorized: false,
        authority_escalation_authorized: false,
      };
    },

    mapPort() {
      return "PROCESS";
    },

    discoverProcessSkills() {
      return [];
    },

    discoverProsynthesizedCapability() {
      return null;
    },

    requestCandidate() {
      return null;
    },

    executeCapability(payload) {
      processCalls.push(payload);

      return {
        accepted: true,
        verified: false,
        process_result: {
          value: 42,
        },
      };
    },

    requestRecomposition() {
      return null;
    },
  };

  const attachment =
    createProcessPortAttachment(fakeProcessBoundary);

  assert.equal(
    typeof attachment.request,
    "function",
  );

  assert.equal(
    typeof attachment.dispatch,
    "function",
  );

  assert.deepEqual(
    attachment.request_types,
    [...PROCESS_INTELLIGENCE_REQUEST_TYPES].sort(),
    "Process Port request types must exactly match Process Intelligence",
  );

  const fabric = new CognitivePortFabric();

  fabric.registerPort(
    {
      port_id: "intent.default",
      port_type: COGNITIVE_PORT_TYPES.INTENT,
      role: "NORMALIZE_INTENT",
      priority: 100,
      intent_classes: ["*"],
    },
    async ({ state }) => ({
      ...state,
      intent_normalized: true,
    }),
  );

  fabric.registerPort(
    {
      port_id: "cogniton.default",
      port_type: COGNITIVE_PORT_TYPES.COGNITON,
      role: "HYDRATE_ACTIVE_COGNITONS",
      priority: 100,
      intent_classes: ["*"],
    },
    async ({ state }) => ({
      ...state,
      cognitive_graph_root:
        graphSnapshotA.state_root,
    }),
  );

  fabric.registerPort(
    {
      port_id: "process.kindred",
      port_type: COGNITIVE_PORT_TYPES.PROCESS,
      role: "EXECUTE_COMPUTATIONAL_WORK",
      priority: 100,
      intent_classes: ["TEST.DO_WORK"],
      verification_required: true,
    },
    async ({ state }) => {
      const execution = await attachment.dispatch(
        "EXECUTE_CAPABILITY",
        {
          intent_class: "TEST.DO_WORK",
          input: state,
        },
      );

      return {
        ...state,
        process_request: execution.request,
        process_result: execution.result,
      };
    },
  );

  fabric.registerPort(
    {
      port_id: "verification.default",
      port_type: COGNITIVE_PORT_TYPES.VERIFICATION,
      role: "VERIFY_OUTCOME",
      priority: 100,
      intent_classes: ["*"],
    },
    async ({ state }) => {
      const processResult =
        state.process_result?.process_result?.value;

      const verified = processResult === 42;

      return {
        ...state,
        verified,
        proof: {
          method: "deterministic-equality",
          expected: 42,
          observed: processResult,
        },
      };
    },
  );

  const compiler = new DCMLCompiler();

  const planA = compiler.compile({
    intent_class: "TEST.DO_WORK",
    graph: graphSnapshotA,
    fabric: fabric.snapshot(),
    authority_scope: "TEST_ONLY",
    verification_required: true,
  });

  const planB = compiler.compile({
    intent_class: "TEST.DO_WORK",
    graph: graphSnapshotB,
    fabric: fabric.snapshot(),
    authority_scope: "TEST_ONLY",
    verification_required: true,
  });

  assert.equal(
    planA.state_root,
    planB.state_root,
    "Equivalent inputs must compile to the same DCML activation root",
  );

  assert.deepEqual(
    planA.active_port_ids,
    [
      "intent.default",
      "cogniton.default",
      "process.kindred",
      "verification.default",
    ],
  );

  const outcome = await executeActivationPlan({
    plan: planA,
    fabric,
    payload: {
      request_id: "fixture-request-1",
    },
  });

  assert.equal(processCalls.length, 1);
  assert.equal(preparedCalls.length, 1);
  assert.equal(
    preparedCalls[0].requestType,
    "EXECUTE_CAPABILITY",
  );

  assert.equal(
    outcome.process_request.request_type,
    "EXECUTE_CAPABILITY",
  );

  assert.equal(
    outcome.process_request.external_effects_authorized,
    false,
  );

  assert.equal(
    outcome.process_request.authority_escalation_authorized,
    false,
  );

  assert.equal(outcome.verified, true);
  assert.equal(
    outcome.proof.method,
    "deterministic-equality",
  );

  const requiredRealBoundaryMethods = [
    "request",
    "mapPort",
    "discoverProcessSkills",
    "discoverProsynthesizedCapability",
    "requestCandidate",
    "executeCapability",
    "requestRecomposition",
  ];

  for (const method of requiredRealBoundaryMethods) {
    assert.equal(
      typeof ProcessIntelligenceBoundaryAdapter.prototype[
        method
      ],
      "function",
      `Existing Process Intelligence adapter must expose ${method}`,
    );
  }
});

