import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveRequiredReshootBindings,
  resolveReshootSaveBinding,
} from "../examples/reshoot/ui/comfynodeui-reshoot/bindings.js";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runtimeWorkflow(source) {
  const workflow = structuredClone(source);
  const host = workflow.nodes.find((node) => node.properties?.app_view_renderer === "reshoot@1");
  const subgraph = workflow.definitions.subgraphs.find((item) => item.id === host.type);
  const links = new Map(workflow.links.map((link) => [link[0], {
    origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4],
  }]));
  const graph = {
    nodes: workflow.nodes,
    links,
    getLink(id) { return links.get(id); },
    getNodeById(id) { return this.nodes.find((node) => node.id === id); },
  };
  for (const node of graph.nodes) node.graph = graph;
  for (const node of subgraph.nodes) node.graph = subgraph;
  host.graph = graph;
  host.subgraph = subgraph;
  return { workflow, host, subgraph, graph, links };
}

export async function testReshootBindings(root = defaultRoot) {
  const source = JSON.parse(await readFile(
    path.join(root, "examples/reshoot/reshoot-app-view.json"), "utf8",
  ));

  const normal = runtimeWorkflow(source);
  const bindings = resolveRequiredReshootBindings(normal.host);
  assert.equal(bindings.source.properties.reshoot_role, "source-video");
  assert.equal(bindings.prepare.properties.reshoot_role, "prepare");
  assert.equal(bindings.camera.properties.reshoot_role, "camera");
  assert.equal(bindings.prompt.properties.reshoot_role, "prompt");
  assert.equal(bindings.seed.properties.reshoot_role, "seed");
  assert.equal(bindings.seed.widgets_values?.[1], "fixed",
    "Re-shoot preparation must not randomize the generation seed");
  assert.equal(bindings.seed.widgets_values_named?.control_after_generate, "fixed");

  for (const node of normal.subgraph.nodes) node.title = `Renamed ${node.id}`;
  assert.equal(resolveRequiredReshootBindings(normal.host).camera, bindings.camera,
    "Display-title changes must not retarget a role binding");
  normal.subgraph.links.reverse();
  assert.equal(resolveRequiredReshootBindings(normal.host).prompt, bindings.prompt,
    "Unrelated link ordering must not retarget a role binding");

  const missing = runtimeWorkflow(source);
  delete missing.subgraph.nodes.find((node) => node.properties?.reshoot_role === "camera").properties.reshoot_role;
  assert.throws(() => resolveRequiredReshootBindings(missing.host), /“camera”.*found none/);

  const duplicate = runtimeWorkflow(source);
  const duplicateCamera = {
    id: "duplicate-camera", type: "CrossViewWarp",
    properties: { reshoot_role: "camera" }, graph: duplicate.subgraph,
  };
  duplicate.subgraph.nodes.push(duplicateCamera);
  assert.throws(() => resolveRequiredReshootBindings(duplicate.host), /“camera”.*found 2/);

  const wrongType = runtimeWorkflow(source);
  wrongType.subgraph.nodes.find((node) => node.properties?.reshoot_role === "seed").type = "OtherNoise";
  assert.throws(() => resolveRequiredReshootBindings(wrongType.host), /“seed”.*must be RandomNoise/);

  const first = runtimeWorkflow(source);
  const second = runtimeWorkflow(source);
  assert.notEqual(resolveRequiredReshootBindings(first.host).camera,
    resolveRequiredReshootBindings(second.host).camera,
    "Two hosts must resolve their own inner nodes");

  const sharedDefinition = runtimeWorkflow(source);
  sharedDefinition.graph.nodes.push({
    id: "second-host",
    type: sharedDefinition.host.type,
    subgraph: sharedDefinition.subgraph,
    properties: { app_view_renderer: "reshoot@1" },
    graph: sharedDefinition.graph,
  });
  assert.throws(() => resolveRequiredReshootBindings(sharedDefinition.host),
    /2 App hosts use the same subgraph definition/,
    "Shared inner nodes must fail visibly instead of sharing UI state");

  assert.equal(resolveReshootSaveBinding(first.host, "generated-save", "Generated").location,
    "inside this subgraph");
  assert.equal(resolveReshootSaveBinding(first.host, "original-audio-save", "Original audio").location,
    "connected to output “Original audio”");
  first.host.outputs.reverse();
  assert.equal(resolveReshootSaveBinding(first.host, "original-audio-save", "Original audio").node
    .properties.reshoot_role, "original-audio-save",
    "Output-slot reordering must not retarget a named output binding");

  const moved = runtimeWorkflow(source);
  const generated = moved.subgraph.nodes.find(
    (node) => node.properties?.reshoot_role === "generated-save",
  );
  moved.subgraph.nodes = moved.subgraph.nodes.filter((node) => node !== generated);
  generated.graph = moved.graph;
  moved.graph.nodes.push(generated);
  moved.links.set(900, { origin_id: moved.host.id, origin_slot: 0, target_id: generated.id, target_slot: 0 });
  moved.host.outputs.find((output) => output.name === "Generated").links = [900];
  assert.equal(resolveReshootSaveBinding(moved.host, "generated-save", "Generated").node, generated,
    "A save moved outside remains bound through its named host output");

  const ambiguousSave = runtimeWorkflow(source);
  const copy = {
    id: "duplicate-generated-save", type: "SaveVideo",
    properties: { reshoot_role: "generated-save" }, graph: ambiguousSave.subgraph,
  };
  ambiguousSave.subgraph.nodes.push(copy);
  assert.match(resolveReshootSaveBinding(ambiguousSave.host, "generated-save", "Generated").error,
    /found 2/);

  const missingSave = runtimeWorkflow(source);
  delete missingSave.subgraph.nodes.find(
    (node) => node.properties?.reshoot_role === "warp-save",
  ).properties.reshoot_role;
  assert.match(resolveReshootSaveBinding(missingSave.host, "warp-save", "Warp guide").error,
    /found none/);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await testReshootBindings();
  console.log("Re-shoot bindings reject missing, duplicate and wrong-type roles; survive title and unrelated link changes; stay scoped per host; and reject shared definitions.");
}

