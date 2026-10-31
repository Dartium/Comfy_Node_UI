# App View format used in this project

## Files to inspect first

- `custom_nodes/ComfyUI-App-View/web/app-view-core.js` — generic registry,
  Selection Toolbox command, mounting, view switching, and sizing.
- `examples/reshoot/ui/comfynodeui-reshoot/` — optional renderer that addresses
  inner workflow nodes by stable roles and reuses a custom DOM widget.
- Each example's JSON beside its `ui` folder — accepted workflow binding.

## Workflow binding

The host remains an ordinary native `SubgraphNode`. Bind a renderer with:

```json
{
  "properties": {
    "app_view_renderer": "example@1",
    "app_view_package": { "folder": "author-example", "name": "Example UI" },
    "app_view_mode": "node"
  }
}
```

Use a versioned renderer ID. Keep `node` as the portable default. Renderer
absence must leave the normal subgraph usable.

The lookup is `host.properties.app_view_renderer -> rendererRegistry.get(id)`.
There is no lookup by workflow filename or renderer filename. Each host can
select a different ID; several hosts can also reuse the same registered renderer.
`build` receives the selected host, so bindings must resolve within that host's
workflow rather than retain another instance's nodes in module-global state.
The registry is shared by loaded workflows. A second implementation registered
with the same ID is rejected; the first is not overwritten. Distinct UIs and
incompatible versions need distinct IDs and folders. An in-place update of the
same compatible UI replaces its folder files and is loaded after a reload.

`app_view_package` is a delivery hint, not renderer selection. The framework
refreshes it from the registered module's actual source directory when mounting.
Include it when preparing a JSON so **UI files…** can name a missing UI's folder
on another machine. It lets users find folders without reading IDs or code.

Stable inner roles belong in the relevant node's ordinary properties when node
IDs are likely to change:

```json
{ "properties": { "example_role": "camera" } }
```

Do not use screen position or translated title text as identity.

Node lookup is renderer behavior, separate from ComfyUI's data flow. The host
does not need a cable to a node merely so JavaScript can read or edit it. Declare
the selector and scope for every controlled node:

| Binding | Survives | Requires an update when |
| --- | --- | --- |
| Promoted host widget | inner node rearrangement | the promoted name or canonical value changes |
| Stable role in `host.subgraph` | title changes and unrelated rewiring | the node moves outside that subgraph |
| Stable role in the containing/root or recursively walked workflow | title changes, rewiring and movement within the searched scope | the role becomes missing or ambiguous |
| Connection from a named host input/output | title and numeric ID changes | that connection path is rewired |
| Numeric node ID | no structural copy or rebuild | the workflow is copied, regenerated or renumbered |

Do not bind by visual title, position or list order. Type alone is insufficient
when several nodes have the same type. A role lookup must return exactly one node
in its declared scope. If it returns none or several, show the binding as
unavailable and identify the missing or duplicated role. When external nodes can
serve several App hosts, use a persisted host-specific namespace or explicit
binding map so one host cannot control another host's node.

Renaming a display title does not affect a role or connection binding. Changing
wires affects only bindings that follow those wires. Moving a node across a
subgraph boundary preserves its role property but changes which graph contains
it; update an inside/outside binding, or use a unique recursive lookup when that
mobility is part of the UI's supported contract.

## Renderer contract

Create `custom_nodes/ComfyUI-App-View/web/renderers/<author-ui>/index.js`. ComfyUI loads
the `.js` files in the package's `WEB_DIRECTORY`; each UI module self-registers
with the shared registry. Do not add per-App imports to the generic entrypoint.
For the layout in this repository, registration looks like this:

```js
import { registerAppViewRenderer } from "../../app-view-core.js";

registerAppViewRenderer({
  id: "example@1",
  name: "Example UI",
  source: import.meta.url,
  width: 520,
  primaryWidth: 420,
  expandedWidth: 1100,
  height: 640,
  build({ host, app, api, openPanel }) {
    const root = document.createElement("div");
    const preview = document.createElement("section");
    return {
      root,
      panels: [{ id: "preview", label: "Preview", element: preview }],
      onPanelChange(id) {}, // null when collapsed, hidden, or inside the subgraph
      onShow() {},
      onHide() {},
      dispose() {},
    };
  },
});
```

The renderer can inspect `host.subgraph`, the host's promoted widgets, and the
root graph. Keep App-specific selectors, labels, field mapping, and visual code
inside this UI's folder. Use module-relative imports and asset URLs; renaming
the folder must preserve the binding. `source` allows the generic framework to derive the
folder shown to the user; it must be the real module URL, not a guessed path.

The host owns `Node ↔ App`, the adjacent one/two-panel icon, section navigation,
DOM mounting and sizing. Put essential controls in `root`; put focused tasks in
`panels` with stable IDs and short labels. `openPanel(id)` reveals a section.
`app_view_layout` (compact/expanded) and `app_view_section` persist per subgraph.
Resizing preserves the selected layout and enforces its minimum width in both
native renderers. Only the toolbar button collapses the right panel.
Pause playback/requests when `onPanelChange(null)` is called. Older renderers
returning only `root` remain usable as a single panel.

Measure natural size in unscaled layout units. Do not set 100% height or use
canvas-zoomed bounds for node sizing. Verify section expansion, manual resizing
and repeated save/reload in both native renderers without cumulative growth.

The skeleton above only mounts a panel. Implement controls, canonical-value
bindings and workflow-to-UI updates in the renderer. The host calls `onShow`,
`onHide` and `dispose`; it does not call a `sync` function on every graph edit.
`onShow`/`onHide` follow both presentation and the active canvas graph. An App
stored in `app` mode is inactive while the user is inside its subgraph. Keep
borrowed DOM widgets with their native nodes during that time.
Use the existing renderer patterns for update subscriptions or polling, and
dispose them when the host is removed. The optional dimensions guide sizing;
keep user resizing intact. Renderer IDs and binding selectors must match the
JSON being delivered, not just a workflow open in the author's browser.

## Canonical values

There are two common binding shapes.

### Promoted host widget

Use the host widget directly when it is the canonical parameter:

```js
const prompt = host.widgets.find((widget) => widget.name === "prompt");
prompt.value = next;
prompt.callback?.(next, app.canvas, host);
host.onWidgetChanged?.("prompt", next, previous, prompt);
```

Use the actual installed frontend's widget APIs. Preserve callbacks and notify
the graph so ordinary UI, serialization, and agent edits stay synchronized.

### Inner custom widget plus promoted value

Some rich widgets, such as CrossView's camera editor, live on an inner node.
If the same field is also promoted, changing the inner widget may not update the
host's stored value. Bridge callbacks in both directions and restore wrapped
callbacks in `dispose`. Verify the serialized host value, not only the visible
inner control.

DOM controls do not preserve workflow types automatically. In particular,
`select.value` is always a string. Normalize it against the canonical widget
before calling its callback, and copy the widget's value after the callback into
the promoted host value. Do not copy the original DOM string a second time. A
binding test must compare both value and `typeof` in the inner widget, host
widget, exported execution prompt and serialized/reloaded workflow.

Transient hover, open details, canvas buffers, and animation frames can stay in
the renderer. Do not make them workflow slots.

## Media and nested results

When a media URL changes, assign it and explicitly load the media element. If an
element has already failed and the same URL becomes valid, retry loading when its
panel is opened. Drive duration, timeline limits and keyframe availability from
loaded metadata rather than the selected filename. Test missing -> valid in one
mounted App instance, then serialize and reload.

ComfyUI keys an inner node's execution result by its concrete host-instance path,
not by the shared subgraph-definition graph ID. Resolve the frontend's execution
ID for that node; do not construct `node.graph.id:node.id`. Verify result restore
after reload and with two hosts so one instance cannot display another's output.

## Public graph surface

Subgraph inputs and outputs are an author choice:

- expose settings that should remain editable in ordinary Node view;
- expose typed values that other nodes should connect to;
- keep App-only presentation details private;
- allow multiple outputs when the workflow naturally has them.

Re-shoot currently exposes 13 ordinary settings and three `VIDEO` results.
Its generated and warp saves are internal; the original-audio SaveVideo stays
outside. The Output section finds internal saves by role and the external save
through its direct connection to the corresponding host output.
Its video selector stays on the internal LoadVideo node, unconnected, so both
native renderers retain selection/upload and preview. App edits that same widget.
The App renderer still uses other inner preview behavior without publishing it
as a slot.

Re-shoot resolves every required inner role exactly once and resolves each save
either inside or through its named host output. Its borrowed camera widget belongs
to the subgraph definition, so two App hosts may use separate definitions but
cannot share one definition; that configuration displays an unavailable-binding
message instead of sharing values.

## Packaging and agent guidance

Distribution is:

```text
workflow JSON
+ named, self-contained UI folders for ComfyUI-App-View/web/renderers
+ normal custom-node/model dependencies of the workflow
```

The workflow does not embed JavaScript. Install the ComfyUI-App-View extension
once under ComfyUI's `custom_nodes`. To add a UI, copy its whole named folder
into `ComfyUI-App-View/web/renderers`, restart,
and open the JSON. Reusing an already-installed UI needs only the JSON.
If the extension or renderer is missing, the workflow still opens as a native
subgraph; this fallback does not supply missing computational nodes or models.

Ship the UI's own folder, not a replacement copy of the framework.
ComfyUI loads these modules through the extension's existing `WEB_DIRECTORY`.
Make dependencies and imports resolve at the installed destination; the source
folder's name is not a protocol. For a standalone ComfyUI package outside this
layout, implement and verify its entrypoint and imports before documenting it
as installable directly into `custom_nodes`.

Before delivery, walk the workflow's native subgraph instances (including nested
definitions) and match their `app_view_renderer` values to the actual registered
modules. Check that every module, local import and asset needed by each UI is
inside its own folder, except the generic framework and declared computational
extensions. Do not leave a hidden dependency on a sibling UI's files. Include
each required folder once and report its name, the subgraphs using it, and the
exact installation destination. Keep internal IDs out of user-facing instructions.
Report missing modules or assets instead of claiming a complete transfer.

The node context menu's **UI files…** lists the current workflow's UI folders.
Their names are derived from `source: import.meta.url`, with saved metadata used
when a renderer is absent. The installable generic extension contains no example
renderer; copy only the named UI folders required by the workflow.

Reusing a UI does not require copying its files again. Test the same renderer
against two host instances or an edited workflow; unrelated graph edits must
not retarget its controls or share values between hosts. Preserve semantic
roles/promoted names used for binding. If controlled nodes/settings change,
retarget the binding or version an incompatible UI explicitly.

The optional examples live under `examples`, outside the installable
`custom_nodes/ComfyUI-App-View` folder. Each example keeps its workflow JSON and
named UI folder together. CrossView and the model weights are dependencies of
the Re-shoot example, not of the generic extension. Keep download URLs in
workflow model metadata rather than duplicating a list in a separate Markdown
file.

For external agents, use clear slot labels and a normal `MarkdownNote` in the
workflow. Official local Comfy MCP can read workflow slots and notes, inspect
installed custom nodes/models, validate, and run. It does not create renderer
source files; the coding agent applies this skill to those files.

## Checks

From the repository root, run `node tools/test-ui-packages.mjs` and
`node tools/validate-package.mjs`, then operate the selected example in the real
frontend.

Also inspect the resulting screenshots in `.tmp`. Confirm:

- one Selection Toolbox `Node ↔ App` control and no switch in the node body;
- native settings in Node mode and only the renderer surface in App mode;
- no renderer-owned Run or sign-in control;
- App edits survive serialize/reload;
- ordinary Node or agent edits appear in App;
- select/number values keep their canonical JavaScript types in the inner
  widget, promoted host widget, execution prompt and reloaded workflow;
- an unavailable source can be replaced without reopening, and loaded metadata
  updates preview duration, timeline and keyframe controls;
- nested output readback uses the host instance execution path and survives reload;
- expanding renderer content grows the node without an inner scrollbar;
- manually narrowing or widening the host preserves that size and reflows the UI;
- borrowed native DOM widgets return to their original node in Node mode;
- real pointer drag works in Node 2.0 and its value survives the state bridge;
- missing renderer degrades to the native subgraph;
- renamed node titles do not break stable bindings;
- missing or duplicate roles fail visibly instead of selecting an arbitrary node;
- unrelated rewiring does not retarget role bindings;
- two hosts using the same renderer do not share controlled nodes or values;
- supported inside/outside moves keep their binding, while unsupported moves
  report the exact scope limit.

For the pinned frontend 1.57.4, verify Node 2.0 and legacy after custom node
definitions are registered. Loading earlier creates placeholder `UNKNOWN`
widgets and is a test/setup race, not a reason to add a second state system.

## Official references

- <https://docs.comfy.org/custom-nodes/js/javascript_hooks>
- <https://docs.comfy.org/custom-nodes/js/subgraphs>
- <https://docs.comfy.org/agent-tools/mcp>
- <https://docs.comfy.org/agent-tools/in-app-agent>
