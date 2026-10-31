import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { registerAppViewRenderer } from "../../app-view-core.js";
import "./crossview-widget-compat.js";
import {
  resolveRequiredReshootBindings,
  reshootHostIsolationError,
} from "./bindings.js";
import { repairLegacyReshootWorkflow } from "./workflow.js";
import { createPreviewPanel } from './preview.js';
import { createResultsPanel } from './results.js';

const RENDERER = "reshoot@1";
const APP_HEIGHT = 790;
const APP_WIDTH = 520;
const PROMOTED_CALLBACK_PREVIOUS = Symbol("reshoot-promoted-callback-previous");

function addStyles() {
  if (document.getElementById("reshoot-app-view-styles")) return;
  const style = document.createElement("style");
  style.id = "reshoot-app-view-styles";
  style.textContent = `
    .reshoot-app {
      width: 100%;
      height: auto;
      overflow: visible;
      padding: 12px;
      border: 1px solid #34363c;
      border-radius: 10px;
      background: #202225;
      color: #eeeeef;
      box-sizing: border-box;
      font: 13px system-ui, sans-serif;
      scrollbar-width: thin;
    }
    .reshoot-app * { box-sizing: border-box; }
    .reshoot-app__source {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      padding: 9px;
      border: 1px solid #3f4248;
      border-radius: 10px;
      background: #292c30;
    }
    .reshoot-app__thumb {
      width: 56px;
      height: 38px;
      border-radius: 6px;
      object-fit: cover;
      background: #141516;
    }
    .reshoot-app__source select {
      min-width: 0;
      width: 100%;
      border: 0;
      background: transparent;
      color: #fff;
      font: inherit;
    }
    .reshoot-app button,
    .reshoot-app select,
    .reshoot-app textarea,
    .reshoot-app input { font: inherit; }
    .reshoot-app button {
      border: 1px solid #50545b;
      border-radius: 8px;
      background: #30343a;
      color: #fff;
      cursor: pointer;
    }
    .reshoot-app button:disabled { opacity: .45; cursor: default; }
    .reshoot-app__change { padding: 7px 10px; }
    .reshoot-app__hint {
      margin: 3px 0 10px;
      color: #a3a7ae;
      text-align: center;
      font-size: 11px;
    }
    .reshoot-app__camera {
      position: relative;
      min-height: 250px;
      margin-bottom: 10px;
      border-radius: 10px;
      background: #191b1e;
      overflow: hidden;
    }
    .reshoot-app__camera > div { width: 100%; }
    .reshoot-app__camera canvas {
      display: block;
      width: 100% !important;
      min-height: 250px;
    }
    .reshoot-app__camera-mask {
      position: absolute;
      z-index: 2;
      right: 0;
      bottom: 0;
      left: 0;
      height: 22px;
      background: #191b1e;
      pointer-events: none;
    }
    .reshoot-app__camera-switch-mask {
      position: absolute;
      z-index: 2;
      top: 0;
      right: 0;
      width: 120px;
      height: 30px;
      background: #191b1e;
    }
    .reshoot-field {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      min-height: 38px;
      margin: 3px 0;
      padding: 0 10px;
      border: 1px solid #3c4046;
      border-radius: 8px;
      background: #292c30;
    }
    .reshoot-field__name { color: #a3a7ae; }
    .reshoot-field--range { grid-template-columns: 92px minmax(0, 1fr) 58px; }
    .reshoot-field__value {
      color: #c4c7cc;
      text-align: right;
      font: 11px ui-monospace, monospace;
    }
    .reshoot-field input[type="range"] { width: 100%; accent-color: #e9fb45; }
    .reshoot-field input[type="checkbox"] { justify-self: end; }
    .reshoot-field select,
    .reshoot-field input[type="number"] {
      width: 100%;
      min-width: 0;
      padding: 4px 6px;
      border: 1px solid #50545b;
      border-radius: 5px;
      background: #191b1e;
      color: #fff;
    }
    .reshoot-field--check { grid-template-columns: 1fr auto; }
    .reshoot-app details {
      margin: 8px 0;
      border: 1px solid #3c4046;
      border-radius: 9px;
      background: #25282c;
    }
    .reshoot-app summary {
      padding: 10px 12px;
      cursor: pointer;
      color: #d1d4d9;
      font-weight: 650;
    }
    .reshoot-app details > div { padding: 0 8px 8px; }
    .reshoot-app__prompt-field { display: grid; gap: 6px; margin-top: 10px; color: #c4c7cc; }
    .reshoot-app__prompt {
      width: 100%;
      min-height: 64px;
      margin: 0;
      padding: 9px;
      border: 1px solid #50545b;
      border-radius: 8px;
      resize: vertical;
      background: #191b1e;
      color: #fff;
    }
    .reshoot-app h3, .reshoot-workspace h3 { margin:0 0 12px; font:600 13px system-ui; color:#dadde2; }
    .reshoot-workspace { min-width:0; padding:12px; border:1px solid #3f4248;
      border-radius:8px; background:#202225; color:#eeeeef; font:13px system-ui; }
    .reshoot-workspace button, .reshoot-workspace select, .reshoot-download {
      padding:7px 11px; border:1px solid #50545b; border-radius:6px; background:#292c30;
      color:inherit; font:inherit; cursor:pointer; }
    .reshoot-workspace button:disabled { opacity:.4; cursor:default; }
    .reshoot-workspace button[aria-pressed="true"] { border-color:#dfed59; color:#effe80; }
    .reshoot-preview-modes, .reshoot-output-options { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .reshoot-preview-stage { position:relative; display:grid; place-items:center; width:100%;
      height:380px; background:#151719; border:1px solid #3c4046; border-radius:7px;
      touch-action:none; overflow:hidden; cursor:grab; }
    .reshoot-preview-stage img, .reshoot-preview-stage video { width:100%; height:100%; object-fit:contain; min-height:0; }
    .reshoot-preview-stage img { user-select:none; -webkit-user-drag:none; }
    .reshoot-preview-status { position:absolute; max-width:80%; text-align:center; color:#b1b5bc; }
    .reshoot-preview-help { position:absolute; left:12px; bottom:10px; margin:0; padding:5px 8px;
      border-radius:6px; background:rgba(20,22,24,.82); color:#e1e4e8; font:11px system-ui;
      pointer-events:none; }
    .reshoot-timeline { margin-top:18px; border-top:1px solid #3f4248; padding-top:16px; }
    .reshoot-timeline__transport { display:grid; grid-template-columns:auto minmax(60px,1fr) auto auto; gap:9px; align-items:center; }
    .reshoot-timeline input { min-width:0; width:100%; accent-color:#e9fb45; }
    .reshoot-timeline output { white-space:nowrap; font:11px ui-monospace,monospace; color:#b9bec6; }
    .reshoot-timeline__markers { position:relative; grid-column:2; grid-row:2; height:24px; border-bottom:1px solid #3f4248; touch-action:none; }
    .reshoot-timeline__markers button { position:absolute; top:2px; transform:translateX(-50%); padding:2px 4px;
      background:transparent; border:0; color:#b8bc68; }
    .reshoot-timeline__tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:12px; }
    .reshoot-message { font:12px/1.5 system-ui; color:#b9bec6; margin:12px 0 0; }
    .reshoot-binding-errors { margin:0 0 10px; color:#ffb4ab; font:12px/1.45 system-ui; }
    .reshoot-workspace > video { display:block; width:100%; max-height:520px; background:#121416; margin-bottom:12px; }
    .reshoot-download { display:inline-block; text-decoration:none; }
  `;
  document.head.appendChild(style);
}

function widget(node, name, type) {
  return node?.widgets?.find(
    (item) => item.name === name && (!type || item.type === type),
  );
}

function setWidget(node, name, value) {
  const target = widget(node, name);
  if (!target) return false;
  const oldValue = target.value;
  target.value = value;
  target.callback?.(value, app.canvas, node);
  node.onWidgetChanged?.(name, value, oldValue, target);
  node.graph?.incrementVersion?.();
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function removePromotedCallback(current, target) {
  if (current === target) return target[PROMOTED_CALLBACK_PREVIOUS];
  if (typeof current === "function" && PROMOTED_CALLBACK_PREVIOUS in current) {
    current[PROMOTED_CALLBACK_PREVIOUS] = removePromotedCallback(
      current[PROMOTED_CALLBACK_PREVIOUS], target,
    );
  }
  return current;
}

function bridgePromotedWidgets(host, specifications) {
  const bindings = [];
  for (const { node, name } of specifications) {
    const inner = widget(node, name);
    const outer = host.widgets?.find((candidate) => candidate.name === name);
    if (!inner || !outer) continue;

    let syncing = false;
    let lastInner = inner.value;
    let lastOuter = outer.value;
    const previousCallback = inner.callback;
    const writeOuter = (value) => {
      if (!syncing && !Object.is(outer.value, value)) {
        const previous = outer.value;
        syncing = true;
        try {
          outer.value = value;
          outer.callback?.(value, app.canvas, host);
          host.onWidgetChanged?.(name, value, previous, outer);
          host.graph?.incrementVersion?.();
          host.graph?.setDirtyCanvas?.(true, true);
        } finally {
          syncing = false;
        }
      }
      lastInner = inner.value;
      lastOuter = outer.value;
    };
    const wrappedCallback = function (value) {
      wrappedCallback[PROMOTED_CALLBACK_PREVIOUS]?.apply(this, arguments);
      writeOuter(inner.value);
    };
    wrappedCallback[PROMOTED_CALLBACK_PREVIOUS] = previousCallback;
    inner.callback = wrappedCallback;

    bindings.push({
      inner,
      outer,
      node,
      name,
      wrappedCallback,
      reconcile() {
        if (syncing) return;
        const innerChanged = !Object.is(inner.value, lastInner);
        const outerChanged = !Object.is(outer.value, lastOuter);

        if (innerChanged && !outerChanged) {
          writeOuter(inner.value);
          return;
        }
        if (!innerChanged && outerChanged) {
          const previous = inner.value;
          syncing = true;
          try {
            inner.value = outer.value;
            inner.callback?.(outer.value, app.canvas, node);
            node.onWidgetChanged?.(name, outer.value, previous, inner);
            node.graph?.setDirtyCanvas?.(true, true);
          } finally {
            syncing = false;
          }
          lastInner = inner.value;
          lastOuter = outer.value;
          return;
        }
        if (innerChanged && outerChanged && !Object.is(inner.value, outer.value)) {
          if (host.properties?.app_view_mode === "app") {
            writeOuter(inner.value);
          } else {
            const previous = inner.value;
            syncing = true;
            try {
              inner.value = outer.value;
              inner.callback?.(outer.value, app.canvas, node);
              node.onWidgetChanged?.(name, outer.value, previous, inner);
              node.graph?.setDirtyCanvas?.(true, true);
            } finally {
              syncing = false;
            }
            lastInner = inner.value;
            lastOuter = outer.value;
          }
          return;
        }
        lastInner = inner.value;
        lastOuter = outer.value;
      },
    });
  }

  return {
    syncFromHost() {
      for (const binding of bindings) binding.reconcile();
    },
    dispose() {
      for (const binding of bindings) {
        binding.inner.callback = removePromotedCallback(
          binding.inner.callback, binding.wrappedCallback,
        );
      }
    },
  };
}

function valuesOf(target) {
  const values = target?.options?.values;
  if (typeof values === "function") return values();
  return Array.isArray(values) ? values : [];
}

function inputMediaUrl(value) {
  if (!value || typeof value !== "string") return "";
  const clean = value.replace(/\s+\[(input|output|temp)\]$/i, "");
  const parts = clean.replaceAll("\\", "/").split("/");
  const filename = parts.pop() ?? clean;
  const subfolder = parts.join("/");
  const query = new URLSearchParams({ filename, subfolder, type: "input" });
  return api.apiURL(`/view?${query}`);
}

function pathToGraph(root, target, path = []) {
  if (root === target) return path;
  for (const node of root?.nodes ?? []) {
    if (!node.subgraph) continue;
    const found = pathToGraph(node.subgraph, target, [...path, node.id]);
    if (found) return found;
  }
  return null;
}

function executionId(node) {
  if (!node?.graph) return null;
  const path = pathToGraph(app.graph, node.graph);
  if (!path) return null;
  return [...path, node.id].join(":");
}

function patchCrossViewPreviewId(camera) {
  const editor = camera?._crossviewPreview;
  if (!editor || editor.__reshootExecutionIdPatched) return;
  const target = camera;
  editor.node = new Proxy(target, {
    get(object, property) {
      if (property === "id") return executionId(object) ?? object.id;
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
    set(object, property, value) {
      return Reflect.set(object, property, value, object);
    },
  });
  editor.__reshootExecutionIdPatched = true;
}

function createCameraWidgetBorrower(camera, cameraMount, openPanel) {
  const borrowed = new Map();
  let previousView;
  let originalSetView, redirectView;

  return {
    borrow() {
      if (!camera) return;
      if (previousView === undefined) previousView = camera._crossviewView ?? 'orbit';
      patchCrossViewPreviewId(camera);
      for (const name of ["orbit"]) {
        const item = camera.widgets?.find((candidate) => candidate.name === name);
        const element = item?.element ?? item?.inputEl;
        if (!element || element.parentElement === cameraMount) continue;
        borrowed.set(element, {
          parent: element.parentElement,
          nextSibling: element.nextSibling,
        });
        cameraMount.appendChild(element);
      }
      if (camera._crossviewView !== 'orbit') camera._crossviewSetView?.('orbit');
      if (!redirectView && camera._crossviewSetView) {
        originalSetView = camera._crossviewSetView;
        redirectView = value => value === 'warp' ? openPanel('camera') : originalSetView(value);
        camera._crossviewSetView = redirectView;
      }
      // CrossView starts its animation loop while the inner subgraph is not
      // mounted, so the loop can stop before this canvas enters the App View.
      // A forced render makes the borrowed surface live immediately; the App
      // View sync keeps external widget edits visible as well.
      camera._crossviewOrbit?.render?.(true);
    },
    restore() {
      for (const [element, { parent, nextSibling }] of borrowed) {
        if (element.parentElement !== cameraMount) continue;
        if (!parent) {
          element.remove();
        } else if (nextSibling?.parentElement === parent) {
          parent.insertBefore(element, nextSibling);
        } else {
          parent.appendChild(element);
        }
      }
      borrowed.clear();
      if (redirectView && camera?._crossviewSetView === redirectView) camera._crossviewSetView = originalSetView;
      redirectView = undefined;
      if (previousView !== undefined) camera?._crossviewSetView?.(previousView);
      previousView = undefined;
      camera?._crossviewApplyView?.();
    },
    get count() {
      return borrowed.size;
    },
  };
}

function borrowCameraWidgets(borrower, active) {
  if (active) {
    borrower.borrow();
  } else {
    borrower.restore();
  }
}

function createRange({ node, name, label, suffix = "", precision = 1, pad = false }) {
  const target = widget(node, name);
  if (!target) return null;
  const row = document.createElement("label");
  row.className = "reshoot-field reshoot-field--range";
  const title = document.createElement("span");
  title.className = "reshoot-field__name";
  title.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(target.options?.min ?? 0);
  input.max = String(target.options?.max ?? 100);
  input.step = String(target.options?.step ?? 1);
  const readout = document.createElement("span");
  readout.className = "reshoot-field__value";
  const display = (value) => {
    const fixed = Number(value).toFixed(precision);
    return pad || !fixed.includes(".")
      ? fixed : fixed.replace(/0+$/, "").replace(/\.$/, "");
  };
  input.addEventListener("input", () => {
    node._crossviewPreview?.beginAudition();
    const value = Number(Number(input.value).toFixed(precision));
    setWidget(node, name, value);
    readout.textContent = `${display(value)}${suffix}`;
  });
  row.append(title, input, readout);
  return {
    element: row,
    sync() {
      const value = Number(target.value ?? 0);
      input.value = String(value);
      readout.textContent = `${display(value)}${suffix}`;
    },
  };
}

function createCheckbox({ node, name, label }) {
  const target = widget(node, name);
  if (!target) return null;
  const row = document.createElement("label");
  row.className = "reshoot-field reshoot-field--check";
  const title = document.createElement("span");
  title.className = "reshoot-field__name";
  title.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.addEventListener("change", () => setWidget(node, name, input.checked));
  row.append(title, input);
  return {
    element: row,
    sync() {
      input.checked = Boolean(target.value);
    },
  };
}

function createSelect({ node, name, label, options }) {
  const target = widget(node, name);
  if (!target) return null;
  const row = document.createElement("label");
  row.className = "reshoot-field";
  const title = document.createElement("span");
  title.className = "reshoot-field__name";
  title.textContent = label;
  const select = document.createElement("select");
  const values = options ?? valuesOf(target);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value.value ?? value);
    option.textContent = String(value.label ?? value);
    select.appendChild(option);
  }
  select.addEventListener("change", () => setWidget(
    node,
    name,
    typeof target.value === "number" ? Number(select.value) : select.value,
  ));
  row.append(title, select);
  return {
    element: row,
    sync() {
      select.value = String(target.value ?? "");
    },
  };
}

function createNumber({ node, name, label, step }) {
  const target = widget(node, name);
  if (!target) return null;
  const row = document.createElement("label");
  row.className = "reshoot-field";
  const title = document.createElement("span");
  title.className = "reshoot-field__name";
  title.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(target.options?.min ?? 0);
  input.max = String(target.options?.max ?? Number.MAX_SAFE_INTEGER);
  input.step = String(step ?? target.options?.step ?? 1);
  input.addEventListener("change", () => setWidget(node, name, Number(input.value)));
  row.append(title, input);
  return {
    element: row,
    sync() {
      input.value = String(target.value ?? 0);
    },
  };
}

function appendControl(parent, controls, control) {
  if (!control) return;
  parent.appendChild(control.element);
  controls.push(control);
}

function buildApp({ host, openPanel }) {
  addStyles();
  const { source, prepare, camera, prompt: promptNode, seed: seedNode } =
    resolveRequiredReshootBindings(host);

  const promotedBridge = bridgePromotedWidgets(host, [
    { node: source, name: "file" },
    { node: prepare, name: "duration" },
    { node: prepare, name: "aspect_ratio" },
    { node: prepare, name: "megapixels" },
    { node: camera, name: "azimuth" },
    { node: camera, name: "elevation" },
    { node: camera, name: "distance" },
    { node: camera, name: "hfov" },
    { node: camera, name: "vertical_shift" },
    { node: camera, name: "keep_source_aim" },
    { node: camera, name: "use_keyframes" },
    { node: camera, name: "interp_motion" },
    { node: promptNode, name: "prompt" },
    { node: seedNode, name: "noise_seed" },
  ]);

  const root = document.createElement("div");
  root.className = "reshoot-app";
  root.dataset.reshootApp = "1";
  const heading = document.createElement('h3');
  heading.textContent = 'Source & camera';
  root.append(heading);
  const preview = createPreviewPanel({host,camera,source,prepare,api,widget,setWidget,executionId,
    sourceUrl:() => inputMediaUrl(widget(source,'file')?.value),
    queuePreparation:(nodeId) => app.queuePrompt(0, 1, {queueNodeIds:[nodeId]})});
  const results = createResultsPanel({host,app,api,executionId});

  const sourceRow = document.createElement("div");
  sourceRow.className = "reshoot-app__source";
  const sourcePreview = document.createElement("video");
  sourcePreview.className = "reshoot-app__thumb";
  sourcePreview.muted = true;
  sourcePreview.playsInline = true;
  const sourceSelect = document.createElement("select");
  sourceSelect.setAttribute('aria-label','Source video');
  const changeButton = document.createElement("button");
  changeButton.className = "reshoot-app__change";
  changeButton.type = "button";
  changeButton.textContent = "Change";
  sourceRow.append(sourcePreview, sourceSelect, changeButton);
  root.appendChild(sourceRow);

  const hint = document.createElement("p");
  hint.className = "reshoot-app__hint";
  hint.textContent = "Camera path and keyframes";
  root.appendChild(hint);

  const cameraMount = document.createElement("div");
  cameraMount.className = "reshoot-app__camera";
  cameraMount.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const cameraMask = document.createElement('div');
  cameraMask.className = 'reshoot-app__camera-mask';
  cameraMask.setAttribute('aria-hidden', 'true');
  const cameraSwitchMask = document.createElement('div');
  cameraSwitchMask.className = 'reshoot-app__camera-switch-mask';
  cameraSwitchMask.setAttribute('aria-hidden', 'true');
  cameraSwitchMask.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  cameraMount.append(cameraMask, cameraSwitchMask);
  root.appendChild(cameraMount);
  const cameraWidgets = createCameraWidgetBorrower(camera, cameraMount, openPanel);

  const controls = [];
  appendControl(root, controls, createRange({ node: camera, name: "azimuth", label: "Rotation", suffix: "°", precision: 1 }));
  appendControl(root, controls, createRange({ node: camera, name: "elevation", label: "Tilt", suffix: "°", precision: 1 }));
  appendControl(root, controls, createRange({ node: camera, name: "distance", label: "Distance", suffix: "×", precision: 2, pad: true }));
  appendControl(root, controls, createRange({ node: camera, name: "hfov", label: "Lens", suffix: "°", precision: 1 }));
  appendControl(root, controls, createRange({ node: camera, name: "vertical_shift", label: "Height", precision: 2, pad: true }));
  appendControl(root, controls, createCheckbox({ node: camera, name: "keep_source_aim", label: "Keep the source camera's aim" }));

  const cameraMove = document.createElement("details");
  const cameraSummary = document.createElement("summary");
  cameraSummary.textContent = "CAMERA MOVE";
  const cameraMoveBody = document.createElement("div");
  cameraMove.append(cameraSummary, cameraMoveBody);
  appendControl(cameraMoveBody, controls, createCheckbox({ node: camera, name: "use_keyframes", label: "Use keyframed camera move" }));
  root.appendChild(cameraMove);

  const advanced = document.createElement("details");
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "ADVANCED";
  const advancedBody = document.createElement("div");
  advanced.append(advancedSummary, advancedBody);
  appendControl(advancedBody, controls, createSelect({ node: prepare, name: "aspect_ratio", label: "Aspect" }));
  appendControl(advancedBody, controls, createSelect({
    node: prepare,
    name: "megapixels",
    label: "Resolution",
    options: [
      { value: 0.4, label: "480p · 0.4 MP" },
      { value: 0.5, label: "Source · 0.5 MP" },
      { value: 1, label: "768p · 1 MP" },
    ],
  }));
  appendControl(advancedBody, controls, createRange({ node: prepare, name: "duration", label: "Duration", suffix: " s" }));
  appendControl(advancedBody, controls, createNumber({ node: seedNode, name: "noise_seed", label: "Seed", step: 1 }));
  root.appendChild(advanced);

  const promptField = document.createElement("label");
  promptField.className = "reshoot-app__prompt-field";
  const promptTitle = document.createElement("span");
  promptTitle.textContent = "Prompt";
  const prompt = document.createElement("textarea");
  prompt.className = "reshoot-app__prompt";
  prompt.placeholder = "Describe what the new view should reveal (optional)";
  prompt.addEventListener("input", () => setWidget(promptNode, "prompt", prompt.value));
  promptField.append(promptTitle, prompt);
  root.appendChild(promptField);

  changeButton.addEventListener("click", () => {
    const upload = source.widgets?.find(
      (item) => item.name === "upload" || item.type === "button",
    );
    upload?.callback?.();
  });

  sourceSelect.addEventListener("change", () => {
    setWidget(source, "file", sourceSelect.value);
  });

  const fileWidget = widget(source, "file");
  let lastSource = null;
  let active = false;
  let bindingUnavailable = false;
  const showBindingUnavailable = (message) => {
    if (!message) return false;
    if (!bindingUnavailable) {
      bindingUnavailable = true;
      active = false;
      cameraWidgets.restore();
      promotedBridge.dispose();
      preview.setActive(false);
      preview.setAppVisible(false);
      results.setActive(false);
      root.className = "comfy-app-view-error";
      root.textContent = `App View could not be created: ${message}`;
    }
    return true;
  };
  const sync = () => {
    if (showBindingUnavailable(reshootHostIsolationError(host))) return;
    promotedBridge.syncFromHost();
    const selected = String(fileWidget?.value ?? "");
    const sourceValues = valuesOf(fileWidget).map(String);
    if (selected && !sourceValues.includes(selected)) sourceValues.unshift(selected);
    const signature = sourceValues.map(String).join("\u0000");
    if (sourceSelect.dataset.signature !== signature) {
      sourceSelect.replaceChildren();
      for (const value of sourceValues) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = String(value).split("/").at(-1);
        sourceSelect.appendChild(option);
      }
      sourceSelect.dataset.signature = signature;
    }
    sourceSelect.value = selected;
    if (selected !== lastSource) {
      lastSource = selected;
      sourcePreview.src = inputMediaUrl(selected);
      sourcePreview.load();
    }
    for (const control of controls) control.sync();
    preview.sync();
    results.sync();
    const promptWidget = widget(promptNode, "prompt");
    if (document.activeElement !== prompt) prompt.value = String(promptWidget?.value ?? "");
    borrowCameraWidgets(
      cameraWidgets,
      active && root.isConnected,
    );
    if (active) {
      camera._crossviewOrbit?.render?.(true);
    }
    root.dataset.cameraExecutionId = executionId(camera) ?? "";
    root.dataset.previewExecutionId = String(
      camera._crossviewPreview?.node?.id ?? "",
    );
    root.dataset.sourceUploadAvailable = String(
      source.widgets?.some(
        (item) => item.name === "upload" || item.type === "button",
      ) ?? false,
    );
  };

  const timer = window.setInterval(sync, 250);
  sync();
  return {
    root,
    panels: [
      {id:'camera',label:'Preview & keyframes',element:preview.root},
      {id:'results',label:'Output',element:results.root},
    ],
    onPanelChange(id) {
      if (bindingUnavailable) {
        preview.setActive(false);
        results.setActive(false);
        return;
      }
      preview.setActive(id === 'camera');
      results.setActive(id === 'results');
    },
    cameraMount,
    sync,
    onShow() {
      active = true;
      preview.setAppVisible(true);
      requestAnimationFrame(() => {
        if (!active) return;
        sync();
        if (bindingUnavailable) return;
        cameraWidgets.borrow();
        sync();
      });
    },
    onHide() {
      active = false;
      preview.setAppVisible(false);
      cameraWidgets.restore();
      preview.setActive(false);
      results.setActive(false);
    },
    dispose() {
      active = false;
      preview.setAppVisible(false);
      window.clearInterval(timer);
      cameraWidgets.restore();
      promotedBridge.dispose();
      preview.dispose();
      results.dispose();
    },
  };
}


export const reshootRenderer = {
  id: RENDERER,
  name: "Re-shoot",
  source: import.meta.url,
  width: APP_WIDTH,
  primaryWidth: 420,
  expandedWidth: 1100,
  minWidth: 420,
  height: APP_HEIGHT,
  build: buildApp,
};

registerAppViewRenderer(reshootRenderer);

app.registerExtension({
  name: "comfy.nativeAppView.reshootWorkflowRepair",
  beforeConfigureGraph(workflow) {
    repairLegacyReshootWorkflow(workflow);
  },
});

