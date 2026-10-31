// Requires the Re-shoot example installed in a running ComfyUI and Playwright.
// Optional: COMFY_URL, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE, APP_VIEW_NODE2,
// APP_VIEW_SOURCE_VIDEO, APP_VIEW_SOURCE_VIDEO_ALT, and APP_VIEW_RESULT_*.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const workflow = JSON.parse(await readFile(
  new URL("../examples/reshoot/reshoot-app-view.json", import.meta.url), "utf8",
));
const sourceFixture = process.env.APP_VIEW_SOURCE_VIDEO;
const sourceAlternate = process.env.APP_VIEW_SOURCE_VIDEO_ALT ?? sourceFixture;

function parts(candidate) {
  const host = candidate.nodes.find((node) => node.properties?.app_view_renderer === "reshoot@1");
  const definition = candidate.definitions.subgraphs.find((item) => item.id === host.type);
  return { host, definition };
}

function caseWorkflow(change) {
  const candidate = structuredClone(workflow);
  change?.(candidate, parts(candidate));
  return candidate;
}

function sourceWorkflow(filename) {
  return caseWorkflow((candidate, { host, definition }) => {
    host.properties.app_view_mode = "app";
    host.properties.app_view_layout = "expanded";
    host.properties.app_view_section = "camera";
    const source = definition.nodes.find(
      (node) => node.properties?.reshoot_role === "source-video",
    );
    source.widgets_values_named.file = filename;
    source.widgets_values[0] = filename;
  });
}

function addHost(candidate, host, type = host.type) {
  const copy = structuredClone(host);
  copy.id = Math.max(candidate.last_node_id ?? 0, ...candidate.nodes
    .filter((node) => typeof node.id === "number").map((node) => node.id)) + 1;
  copy.type = type;
  copy.pos = [host.pos[0] + host.size[0] + 180, host.pos[1]];
  for (const input of copy.inputs ?? []) input.link = null;
  for (const output of copy.outputs ?? []) output.links = [];
  candidate.last_node_id = copy.id;
  candidate.nodes.push(copy);
  return copy;
}

function addExternalOriginalSave(candidate, host) {
  const template = candidate.nodes.find(
    (node) => node.properties?.reshoot_role === "original-audio-save",
  );
  const save = structuredClone(template);
  save.id = Math.max(candidate.last_node_id ?? 0, ...candidate.nodes
    .filter((node) => typeof node.id === "number").map((node) => node.id)) + 1;
  save.pos = [host.pos[0] + host.size[0] + 180, host.pos[1]];
  for (const input of save.inputs ?? []) input.link = null;
  for (const output of save.outputs ?? []) output.links = [];
  const linkId = Math.max(candidate.last_link_id ?? 0, ...candidate.links.map((link) => link[0])) + 1;
  const outputSlot = host.outputs.findIndex((output) => output.name === "Original audio");
  save.inputs[0].link = linkId;
  host.outputs[outputSlot].links = [linkId];
  candidate.nodes.push(save);
  candidate.links.push([linkId, host.id, outputSlot, save.id, 0, "VIDEO"]);
  candidate.last_node_id = save.id;
  candidate.last_link_id = linkId;
}

const sourceCases = sourceFixture ? [
  ["missing source recovery", sourceWorkflow("__missing_reshoot_source__.mp4"),
    { errors: 0, hosts: 1, missingSource: "__missing_reshoot_source__.mp4",
      recoverTo: sourceFixture }],
  ["source video", sourceWorkflow(sourceFixture),
    { errors: 0, hosts: 1, sourceFile: sourceFixture,
      switchTo: sourceAlternate, controls: true }],
  ...(sourceAlternate && sourceAlternate !== sourceFixture ? [[
    "alternate source video", sourceWorkflow(sourceAlternate),
    { errors: 0, hosts: 1, sourceFile: sourceAlternate },
  ]] : []),
] : [];

const cases = [
  ["normal", caseWorkflow(), { errors: 0, hosts: 1 }],
  ...sourceCases,
  ["renamed", caseWorkflow((candidate, { definition }) => {
    for (const node of definition.nodes) node.title = `Renamed ${node.id}`;
  }), { errors: 0, hosts: 1 }],
  ["missing role", caseWorkflow((candidate, { definition }) => {
    delete definition.nodes.find((node) => node.properties?.reshoot_role === "camera")
      .properties.reshoot_role;
  }), { errors: 1, hosts: 1, message: /“camera”.*found none/ }],
  ["duplicate role", caseWorkflow((candidate, { definition }) => {
    const node = structuredClone(definition.nodes.find(
      (entry) => entry.properties?.reshoot_role === "camera",
    ));
    node.id = "duplicate-camera";
    node.pos = [node.pos[0] + 450, node.pos[1]];
    for (const input of node.inputs ?? []) input.link = null;
    for (const output of node.outputs ?? []) output.links = [];
    definition.nodes.push(node);
  }), { errors: 1, hosts: 1, message: /“camera”.*found 2/ }],
  ["duplicate output role", caseWorkflow((candidate, { definition }) => {
    const node = structuredClone(definition.nodes.find(
      (entry) => entry.properties?.reshoot_role === "generated-save",
    ));
    node.id = "duplicate-generated-save";
    node.pos = [node.pos[0] + 450, node.pos[1]];
    for (const input of node.inputs ?? []) input.link = null;
    for (const output of node.outputs ?? []) output.links = [];
    definition.nodes.push(node);
  }), { errors: 0, hosts: 1, resultMessage: /“generated-save”.*found 2/,
    bindingMessage: /“generated-save”.*found 2/ }],
  ["missing output role", caseWorkflow((candidate, { definition }) => {
    delete definition.nodes.find((entry) => entry.properties?.reshoot_role === "warp-save")
      .properties.reshoot_role;
  }), { errors: 0, hosts: 1, bindingMessage: /“warp-save”.*found none/ }],
  ["shared definition", caseWorkflow((candidate, { host }) => {
    addHost(candidate, host);
  }), { errors: 2, hosts: 2, message: /2 App hosts use the same subgraph definition/, shared: true, promotedWrappers: 0 }],
  ["separate definitions", caseWorkflow((candidate, { host, definition }) => {
    const secondDefinition = structuredClone(definition);
    secondDefinition.id = `${definition.id}-binding-test`;
    secondDefinition.name = `${definition.name} binding test`;
    candidate.definitions.subgraphs.push(secondDefinition);
    const secondHost = addHost(candidate, host, secondDefinition.id);
    addExternalOriginalSave(candidate, secondHost);
  }), { errors: 0, hosts: 2, shared: false, bindingErrors: 0 }],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE,
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack || error.message || String(error)));
let settings;

async function installQueueSpy() {
  await page.evaluate(async () => {
    const { app } = await import("/scripts/app.js");
    if (!app.__reshootOriginalQueuePrompt) {
      app.__reshootOriginalQueuePrompt = app.queuePrompt.bind(app);
      app.queuePrompt = async (number, batchCount = 1, options = {}) => {
        const normalized = Array.isArray(options) ? { queueNodeIds: options } : options;
        if (normalized?.queueNodeIds?.length) {
          app.__reshootQueueCalls.push({
            number, batchCount, queueNodeIds: [...normalized.queueNodeIds],
          });
          return true;
        }
        return app.__reshootOriginalQueuePrompt(number, batchCount, options);
      };
    }
    app.__reshootQueueCalls = [];
  });
}

async function ready() {
  await page.waitForFunction(() => document.documentElement.dataset.comfyAppViewExtension === "loaded"
    && globalThis.LiteGraph?.registered_node_types?.CrossViewWarp);
  await page.waitForFunction(async () => {
    const { app } = await import("/scripts/app.js");
    return app.isGraphReady && !app.configuringGraph;
  });
  await page.waitForLoadState("networkidle");
}

async function load(candidate, loadSource = false) {
  await page.evaluate(async (data) => {
    const { app } = await import("/scripts/app.js");
    window.bindingTestApp = app;
    app.__reshootQueueCalls = [];
    await app.loadGraphData(data, true, true);
  }, candidate);
  await page.waitForFunction(() => {
    const hosts = window.bindingTestApp.graph.nodes.filter(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    return hosts.length > 0 && hosts.every((host) => host.__comfyAppView);
  });
  await page.waitForTimeout(350);
  if (loadSource) {
    await page.evaluate(() => {
      const host = window.bindingTestApp.graph.nodes.find(
        (node) => node.properties?.app_view_renderer === "reshoot@1",
      );
      host.__comfyAppView.view.panels.find((panel) => panel.id === "camera")
        .element.querySelector('[data-view="source"]').click();
    });
    await page.waitForFunction(() => {
      const host = window.bindingTestApp.graph.nodes.find(
        (node) => node.properties?.app_view_renderer === "reshoot@1",
      );
      const video = host.__comfyAppView.view.panels.find((panel) => panel.id === "camera")
        .element.querySelector("video");
      return video.readyState >= 1 || video.error;
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(300);
  }
  return page.evaluate(() => {
    const hosts = window.bindingTestApp.graph.nodes.filter(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const subgraphs = [...new Set(hosts.map((host) => host.subgraph))];
    const sourceVideo = hosts[0].__comfyAppView.view.panels
      ?.find((panel) => panel.id === "camera")?.element.querySelector("video");
    const cameraPanel = hosts[0].__comfyAppView.view.panels
      ?.find((panel) => panel.id === "camera")?.element;
    const sourceSelect = hosts[0].__comfyAppView.view.root
      .querySelector(".reshoot-app__source select");
    const sourceNode = hosts[0].subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "source-video",
    );
    const cameraNode = hosts[0].subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "camera",
    );
    const seedNode = hosts[0].subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "seed",
    );
    return {
      hosts: hosts.length,
      errors: hosts.filter((host) => host.__comfyAppView.view.root
        .classList.contains("comfy-app-view-error")).map((host) => host.__comfyAppView.view.root.textContent),
      resultMessages: hosts.map((host) => host.__comfyAppView.view.panels
        ?.find((panel) => panel.id === "results")?.element.querySelector('[role="status"]')?.textContent ?? ""),
      bindingMessages: hosts.map((host) => host.__comfyAppView.view.panels
        ?.find((panel) => panel.id === "results")?.element.querySelector('[role="alert"]')?.textContent ?? ""),
      shared: hosts.length > 1 ? hosts[0].subgraph === hosts[1].subgraph : null,
      sharedCamera: hosts.length > 1 ? hosts[0].subgraph.nodes.find(
        (node) => node.properties?.reshoot_role === "camera",
      ) === hosts[1].subgraph.nodes.find(
        (node) => node.properties?.reshoot_role === "camera",
      ) : null,
      promotedWrappers: subgraphs.flatMap((subgraph) => subgraph.nodes)
        .flatMap((node) => node.widgets ?? [])
        .filter((widget) => typeof widget.callback === "function" &&
          Object.getOwnPropertySymbols(widget.callback).some(
            (symbol) => symbol.description === "reshoot-promoted-callback-previous",
          )).length,
      source: sourceVideo ? {
        src: sourceVideo.currentSrc,
        readyState: sourceVideo.readyState,
        duration: sourceVideo.duration,
        error: sourceVideo.error?.message ?? "",
        hidden: sourceVideo.hidden,
        selected: sourceSelect?.value ?? "",
        options: [...(sourceSelect?.options ?? [])].map((option) => option.value),
        canonical: sourceNode?.widgets?.find((widget) => widget.name === "file")?.value ?? "",
        frames: Number(cameraPanel?.querySelector('.reshoot-timeline input[type="range"]')?.max ?? 1),
        time: cameraPanel?.querySelector(".reshoot-timeline output")?.textContent ?? "",
        keyDisabled: cameraPanel?.querySelector('[data-action="key"]')?.disabled ?? true,
        status: cameraPanel?.querySelector(".reshoot-preview-status")?.textContent ?? "",
        statusHidden: cameraPanel?.querySelector(".reshoot-preview-status")?.hidden ?? false,
      } : null,
      preparation: {
        calls: app.__reshootQueueCalls ?? [],
        cameraExecutionId: `${hosts[0].id}:${cameraNode?.id}`,
      },
      seedMode: seedNode?.widgets?.find(
        (item) => item.name === "control_after_generate",
      )?.value ?? seedNode?.widgets?.[1]?.value,
      cameraHint: hosts[0].__comfyAppView.view.root
        .querySelector(".reshoot-app__hint")?.textContent ?? "",
      cameraMask: Boolean(hosts[0].__comfyAppView.view.root
        .querySelector(".reshoot-app__camera-mask")),
      cameraSwitchMask: Boolean(hosts[0].__comfyAppView.view.root
        .querySelector(".reshoot-app__camera-switch-mask")),
    };
  });
}

async function dragWarpPreview() {
  await page.evaluate(() => {
    const app = window.bindingTestApp;
    const host = app.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const panel = host.__comfyAppView.view.panels.find((item) => item.id === "camera").element;
    panel.querySelector('[data-view="warp"]').click();
    panel.querySelector(".reshoot-preview-stage img").hidden = false;
  });
  const stage = page.locator(".reshoot-preview-stage").first();
  const box = await stage.boundingBox();
  assert.ok(box, "Warp preview stage must be visible");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.36, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const app = window.bindingTestApp;
    const host = app.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const camera = host.subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "camera",
    );
    const value = (name) => camera.widgets.find((item) => item.name === name)?.value;
    const root = host.__comfyAppView.view.root;
    const readout = (label) => [...root.querySelectorAll(".reshoot-field")].find(
      (row) => row.querySelector(".reshoot-field__name")?.textContent === label,
    )?.querySelector(".reshoot-field__value")?.textContent ?? "";
    const panel = host.__comfyAppView.view.panels.find((item) => item.id === "camera").element;
    return {
      azimuth: value("azimuth"),
      elevation: value("elevation"),
      distance: value("distance"),
      rotationReadout: readout("Rotation"),
      tiltReadout: readout("Tilt"),
      distanceReadout: readout("Distance"),
      help: panel.querySelector(".reshoot-preview-help")?.textContent ?? "",
      rootNodeTypes: app.graph.nodes.map((node) => node.type),
    };
  });
}

async function switchSourceAndRoundTrip(filename) {
  await page.evaluate((value) => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const select = host.__comfyAppView.view.root.querySelector(".reshoot-app__source select");
    if (![...select.options].some((option) => option.value === value)) {
      throw new Error(`Source option is unavailable: ${value}`);
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, filename);
  await page.waitForFunction((value) => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const panel = host.__comfyAppView.view.panels.find((item) => item.id === "camera").element;
    const video = panel.querySelector("video");
    const source = host.subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "source-video",
    );
    return source.widgets.find((widget) => widget.name === "file")?.value === value &&
      video.currentSrc.includes(encodeURIComponent(value)) && video.readyState >= 1;
  }, filename, { timeout: 10000 });
  const serialized = await page.evaluate(() => window.bindingTestApp.graph.serialize());
  return load(serialized, true);
}

async function controlState() {
  return page.evaluate(async () => {
    const app = window.bindingTestApp;
    const host = app.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const role = (name) => host.subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === name,
    );
    const value = (node, name) => node.widgets?.find((widget) => widget.name === name)?.value;
    const hostValue = (name) => host.widgets?.find((widget) => widget.name === name)?.value;
    const { output } = await app.graphToPrompt();
    const promptOutput = Object.values(output).find(
      (node) => node.class_type === "MiniMaxH3ReferenceToVideo",
    );
    const noiseOutput = Object.values(output).find((node) => node.class_type === "RandomNoise");
    return {
      inner: {
        aspect: value(role("prepare"), "aspect_ratio"),
        resolution: value(role("prepare"), "megapixels"),
        duration: value(role("prepare"), "duration"),
        rotation: value(role("camera"), "azimuth"),
        keepAim: value(role("camera"), "keep_source_aim"),
        prompt: value(role("prompt"), "prompt"),
        seed: value(role("seed"), "noise_seed"),
      },
      host: {
        aspect: hostValue("aspect_ratio"),
        resolution: hostValue("megapixels"),
        duration: hostValue("duration"),
        rotation: hostValue("azimuth"),
        keepAim: hostValue("keep_source_aim"),
        prompt: hostValue("prompt"),
        seed: hostValue("noise_seed"),
      },
      prompt: promptOutput?.inputs?.prompt,
      seed: noiseOutput?.inputs?.noise_seed,
    };
  });
}

async function editControlsAndRoundTrip() {
  await page.evaluate(() => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const root = host.__comfyAppView.view.root;
    const field = (label) => [...root.querySelectorAll(".reshoot-field")].find(
      (row) => row.querySelector(".reshoot-field__name")?.textContent === label,
    );
    const set = (control, value, event) => {
      if (control.type === "checkbox") control.checked = value;
      else control.value = String(value);
      control.dispatchEvent(new Event(event, { bubbles: true }));
    };
    set(field("Aspect").querySelector("select"), "16:9", "change");
    set(field("Resolution").querySelector("select"), 1, "change");
    set(field("Duration").querySelector('input[type="range"]'), 4.2, "input");
    set(field("Rotation").querySelector('input[type="range"]'), -20, "input");
    set(field("Keep the source camera's aim").querySelector('input[type="checkbox"]'), false, "change");
    set(field("Seed").querySelector('input[type="number"]'), 123456789, "change");
    set(root.querySelector(".reshoot-app__prompt"), "crossview binding review", "input");
  });
  await page.waitForTimeout(350);
  const before = await controlState();
  const serialized = await page.evaluate(() => window.bindingTestApp.graph.serialize());
  await load(serialized, true);
  const after = await controlState();
  return { before, after };
}

async function timelineState() {
  return page.evaluate(() => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const camera = host.subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "camera",
    );
    const value = (name) => camera.widgets.find((widget) => widget.name === name)?.value;
    return {
      keys: JSON.parse(value("keyframes") || "[]"),
      enabled: value("use_keyframes"),
      motion: value("interp_motion"),
      frame: value("frame_index"),
    };
  });
}

async function editTimelineAndRoundTrip() {
  const cleared = await page.evaluate(() => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const panel = host.__comfyAppView.view.panels.find((item) => item.id === "camera").element;
    const key = panel.querySelector('[data-action="key"]');
    const range = panel.querySelector('.reshoot-timeline input[type="range"]');
    const motion = panel.querySelector(".reshoot-timeline select");
    key.click();
    range.value = "10";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    key.click();
    motion.value = "smooth";
    motion.dispatchEvent(new Event("change", { bubbles: true }));
    panel.querySelector('[data-action="clear"]').click();
    const camera = host.subgraph.nodes.find(
      (node) => node.properties?.reshoot_role === "camera",
    );
    const value = (name) => camera.widgets.find((widget) => widget.name === name)?.value;
    const state = {
      keys: JSON.parse(value("keyframes") || "[]"),
      enabled: value("use_keyframes"),
      undoVisible: !panel.querySelector('[data-action="undo"]').hidden,
    };
    panel.querySelector('[data-action="undo"]').click();
    return state;
  });
  await page.waitForTimeout(250);
  const before = await timelineState();
  const serialized = await page.evaluate(() => window.bindingTestApp.graph.serialize());
  await load(serialized, true);
  const after = await timelineState();
  return { cleared, before, after };
}

const resultFixtures = [
  ["Generated", "generated-save", process.env.APP_VIEW_RESULT_GENERATED],
  ["Warp guide", "warp-save", process.env.APP_VIEW_RESULT_WARP],
  ["Original audio", "original-audio-save", process.env.APP_VIEW_RESULT_ORIGINAL],
].filter(([, , filename]) => filename);

async function openResult(label, filename) {
  await page.evaluate((buttonLabel) => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const panel = host.__comfyAppView.view.panels.find((item) => item.id === "results").element;
    [...panel.querySelectorAll("button")].find(
      (button) => button.textContent === buttonLabel,
    ).click();
  }, label);
  await page.waitForFunction((file) => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const video = host.__comfyAppView.view.panels.find((item) => item.id === "results")
      .element.querySelector("video");
    return video.currentSrc.includes(file) && video.readyState >= 1;
  }, filename, { timeout: 10000 });
  return page.evaluate(() => {
    const host = window.bindingTestApp.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const panel = host.__comfyAppView.view.panels.find((item) => item.id === "results").element;
    const video = panel.querySelector("video");
    const download = panel.querySelector("a");
    return {
      src: video.currentSrc,
      readyState: video.readyState,
      duration: video.duration,
      error: video.error?.message ?? "",
      download: download.download,
      bindingError: panel.querySelector('[role="alert"]').textContent,
    };
  });
}

async function testResultsAndRoundTrip() {
  await page.evaluate((fixtures) => {
    const app = window.bindingTestApp;
    const host = app.graph.nodes.find(
      (node) => node.properties?.app_view_renderer === "reshoot@1",
    );
    const pathToGraph = (root, target, path = []) => {
      if (root === target) return path;
      for (const node of root.nodes ?? []) {
        if (!node.subgraph) continue;
        const found = pathToGraph(node.subgraph, target, [...path, node.id]);
        if (found) return found;
      }
      return null;
    };
    const executionId = (node) => [...pathToGraph(app.graph, node.graph), node.id].join(":");
    for (const [, role, filename] of fixtures) {
      const node = host.subgraph.nodes.find((entry) => entry.properties?.reshoot_role === role) ??
        app.graph.nodes.find((entry) => entry.properties?.reshoot_role === role);
      const id = node.graph === app.graph ? String(node.id) : `${host.id}:${node.id}`;
      app.nodeOutputs[id] = {
        images: [{ filename, subfolder: "crossview", type: "output" }],
      };
    }
    host.__comfyAppView.view.panels.find((item) => item.id === "results");
    host.__comfyAppView.view.sync();
  }, resultFixtures);
  const before = [];
  for (const [label,,filename] of resultFixtures) before.push(await openResult(label, filename));
  const serialized = await page.evaluate(() => window.bindingTestApp.graph.serialize());
  await load(serialized, true);
  const after = [];
  for (const [label,,filename] of resultFixtures) after.push(await openResult(label, filename));
  return { before, after };
}

try {
  await page.goto(process.env.COMFY_URL ?? "http://127.0.0.1:8188");
  await ready();
  settings = await page.evaluate(async () => {
    const { app } = await import("/scripts/app.js");
    return {
      node2: app.ui.settings.getSettingValue("Comfy.VueNodes.Enabled"),
      toolbox: app.ui.settings.getSettingValue("Comfy.Canvas.SelectionToolbox"),
    };
  });
  const modes = process.env.APP_VIEW_NODE2
    ? [process.env.APP_VIEW_NODE2 === "true"] : [true, false];
  for (const node2 of modes) {
    await page.evaluate(async (value) => {
      const { app } = await import("/scripts/app.js");
      await app.ui.settings.setSettingValueAsync("Comfy.VueNodes.Enabled", value);
      await app.ui.settings.setSettingValueAsync("Comfy.Canvas.SelectionToolbox", true);
    }, node2);
    await page.reload();
    await ready();
    await installQueueSpy();
    for (const [name, candidate, expected] of cases) {
      const state = await load(candidate, Boolean(expected.sourceFile || expected.missingSource));
      assert.equal(state.hosts, expected.hosts, `${name}: ${JSON.stringify(state)}`);
      assert.equal(state.errors.length, expected.errors, `${name}: ${JSON.stringify(state)}`);
      if (expected.message) assert.match(state.errors.join("\n"), expected.message);
      if (expected.resultMessage) assert.match(state.resultMessages.join("\n"), expected.resultMessage);
      if (expected.bindingMessage) assert.match(state.bindingMessages.join("\n"), expected.bindingMessage);
      if (expected.bindingErrors !== undefined) {
        assert.equal(state.bindingMessages.filter(Boolean).length, expected.bindingErrors,
          `${name}: ${JSON.stringify(state)}`);
      }
      if (expected.shared !== undefined) {
        assert.equal(state.shared, expected.shared, `${name}: ${JSON.stringify(state)}`);
        assert.equal(state.sharedCamera, expected.shared, `${name}: ${JSON.stringify(state)}`);
      }
      if (expected.promotedWrappers !== undefined) {
        assert.equal(state.promotedWrappers, expected.promotedWrappers,
          `${name}: ${JSON.stringify(state)}`);
      }
      if (!state.errors.length) {
        assert.equal(state.seedMode, "fixed", `${name}: ${JSON.stringify(state)}`);
        assert.equal(state.cameraHint, "Camera path and keyframes");
        assert.equal(state.cameraMask, true);
        assert.equal(state.cameraSwitchMask, true);
      }
      if (expected.sourceFile) {
        assert.ok(state.source.src.includes(encodeURIComponent(expected.sourceFile)) ||
          state.source.src.includes(expected.sourceFile), JSON.stringify(state.source));
        assert.ok(state.source.readyState >= 1, JSON.stringify(state.source));
        assert.ok(Number.isFinite(state.source.duration) && state.source.duration > 0,
          JSON.stringify(state.source));
        assert.equal(state.source.error, "");
        assert.equal(state.source.hidden, false);
        assert.equal(state.source.statusHidden, true);
        assert.equal(state.source.selected, expected.sourceFile);
        assert.equal(state.source.canonical, expected.sourceFile);
        assert.ok(state.source.options.includes(expected.sourceFile));
        assert.ok(state.source.frames > 1, JSON.stringify(state.source));
        assert.match(state.source.time, /\d+\.\d+ \/ [1-9]\d*\.\d+ s/);
        assert.equal(state.source.keyDisabled, false);
        assert.deepEqual(state.preparation.calls, [{
          number: 0,
          batchCount: 1,
          queueNodeIds: [state.preparation.cameraExecutionId],
        }], JSON.stringify(state.preparation));
      }
      if (expected.missingSource) {
        assert.ok(state.source.src.includes(expected.missingSource), JSON.stringify(state.source));
        assert.ok(state.source.error, JSON.stringify(state.source));
        assert.equal(state.source.status, "Choose an available source video.");
        assert.equal(state.source.statusHidden, false);
        assert.deepEqual(state.preparation.calls, []);
      }
      if (expected.recoverTo) {
        const recovered = await switchSourceAndRoundTrip(expected.recoverTo);
        assert.equal(recovered.source.selected, expected.recoverTo);
        assert.equal(recovered.source.canonical, expected.recoverTo);
        assert.equal(recovered.source.error, "");
        assert.ok(recovered.source.readyState >= 1, JSON.stringify(recovered.source));
        assert.ok(recovered.source.duration > 0, JSON.stringify(recovered.source));
        assert.equal(recovered.preparation.calls.length, 1, JSON.stringify(recovered.preparation));
      }
      if (expected.switchTo) {
        const roundTrip = await switchSourceAndRoundTrip(expected.switchTo);
        assert.equal(roundTrip.source.selected, expected.switchTo);
        assert.equal(roundTrip.source.canonical, expected.switchTo);
        assert.ok(roundTrip.source.readyState >= 1, JSON.stringify(roundTrip.source));
        assert.ok(roundTrip.source.duration > 0, JSON.stringify(roundTrip.source));
        assert.ok(roundTrip.source.frames > 1, JSON.stringify(roundTrip.source));
        assert.equal(roundTrip.preparation.calls.length, 1, JSON.stringify(roundTrip.preparation));
      }
      if (expected.controls) {
        const drag = await dragWarpPreview();
        assert.equal(Number.isInteger(drag.azimuth * 10), true, JSON.stringify(drag));
        assert.equal(Number.isInteger(drag.elevation * 10), true, JSON.stringify(drag));
        assert.equal(Number.isInteger(drag.distance * 100), true, JSON.stringify(drag));
        assert.match(drag.rotationReadout, /^-?\d+(?:\.\d)?°$/);
        assert.match(drag.tiltReadout, /^-?\d+(?:\.\d)?°$/);
        assert.match(drag.distanceReadout, /^\d+\.\d{2}×$/);
        assert.equal(drag.help, "Drag to orbit · Scroll to move closer");
        assert.equal(drag.rootNodeTypes.includes("LoadImage"), false, JSON.stringify(drag));
        assert.equal(drag.rootNodeTypes.length, 2, JSON.stringify(drag));
        const controls = await editControlsAndRoundTrip();
        const expectedValues = {
          aspect: "16:9", resolution: 1, duration: 4.2, rotation: -20,
          keepAim: false, prompt: "crossview binding review", seed: 123456789,
        };
        for (const controlState of [controls.before, controls.after]) {
          assert.deepEqual(controlState.inner, expectedValues);
          assert.deepEqual(controlState.host, expectedValues);
          assert.equal(controlState.prompt, expectedValues.prompt);
          assert.equal(controlState.seed, expectedValues.seed);
        }
        const timeline = await editTimelineAndRoundTrip();
        assert.deepEqual(timeline.cleared,
          { keys: [], enabled: false, undoVisible: true });
        for (const timelineState of [timeline.before, timeline.after]) {
          assert.deepEqual(timelineState.keys.map((key) => key.f), [1, 10]);
          assert.equal(timelineState.enabled, true);
          assert.equal(timelineState.motion, "smooth");
          assert.equal(timelineState.frame, 10);
        }
        if (resultFixtures.length) {
          const results = await testResultsAndRoundTrip();
          for (const group of [results.before, results.after]) {
            group.forEach((result, index) => {
              assert.ok(result.src.includes(resultFixtures[index][2]), JSON.stringify(result));
              assert.ok(result.readyState >= 1, JSON.stringify(result));
              assert.ok(result.duration > 0, JSON.stringify(result));
              assert.equal(result.error, "");
              assert.equal(result.download, resultFixtures[index][2]);
              assert.equal(result.bindingError, "");
            });
          }
        }
      }
      console.log(JSON.stringify({ node2, name, state }));
    }
  }
  const failures = pageErrors.filter((error) =>
    !error.includes("getCanvas: canvas is null") &&
    !error.includes("Failed to fetch dynamically imported"));
  assert.deepEqual(failures, []);
} finally {
  if (settings) {
    await page.evaluate(async (previous) => {
      const { app } = await import("/scripts/app.js");
      await app.ui.settings.setSettingValueAsync("Comfy.VueNodes.Enabled", previous.node2);
      await app.ui.settings.setSettingValueAsync("Comfy.Canvas.SelectionToolbox", previous.toolbox);
    }, settings).catch(() => undefined);
  }
  await browser.close();
}

console.log("Re-shoot source, controls, timeline, results, round-trip and binding cases passed in Node 2.0 and legacy.");
