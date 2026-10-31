---
name: comfy-app-view-authoring
description: Create or revise reusable custom UIs for ComfyUI-App-View on native ComfyUI workflows and subgraphs while preserving their normal graph, slots, outputs, execution, and agent access. Use for renderer authoring, workflow-to-UI bindings, Node/App presentation switching, or App View portability; do not use for ordinary workflow-only edits.
---

# ComfyUI-App-View Authoring

Build the custom UI as another representation of a real ComfyUI workflow. Keep
the workflow executable and editable without the renderer.

Before changing a renderer or binding a new workflow, read
[references/app-view-format.md](references/app-view-format.md). Inspect the
actual workflow JSON, node definitions, installed frontend version, and any
existing App source being adapted.

## Required shape

- Keep computation, typed connections, subgraph inputs/outputs, and queueing in
  ComfyUI.
- Put renderer selection in `SubgraphNode.properties.app_view_renderer` and the
  selected presentation in `app_view_mode`.
- Register App-specific renderers with the generic App View registry. Do not add
  App names or bindings to the generic host layer.
- Use the Selection Toolbox command supplied by the generic extension for
  `Node ↔ App`; do not add a second switch inside the node.
- Use the shared one/two-panel shell: keep essential controls in `root` and
  return named `panels` for previews, timelines or results on the right. The
  host owns the layout icon, navigation, saved choice and sizing. A UI package
  may contain several files; keep its application logic inside its own folder.
- Let ComfyUI's own Run control execute the graph. Do not add Sign in, Analyze,
  Generate, or `queuePrompt` controls merely because the source standalone App
  had them.
- When the requested UI genuinely has a preparation stage, queue only its exact
  Comfy output node through partial execution after the canonical input is
  valid. Keep final generation on ComfyUI's Run control; do not auto-queue the
  full graph or add a duplicate Generate button.
- Give form fields persistent visible labels associated with their controls;
  placeholders and `aria-label` alone do not replace them.
- Within a field, show the value once. Selects and text/number inputs already
  display it; use a separate readout for controls such as sliders that do not.

## State and bindings

Treat meaningful workflow values as canonical. The custom UI may keep transient
interaction state, but camera values, prompts, seeds, assets, job references,
and reusable results must resolve to the real workflow widgets or promoted
subgraph widgets.

When a renderer reuses an inner custom widget, confirm both directions:

```text
App edit -> canonical workflow value -> serialize/reload
Node/agent edit -> canonical workflow value -> App refresh
```

Do not assume that changing an inner widget updates a promoted host widget.
Bridge them explicitly when the installed frontend keeps separate state.

The App View may use the whole nested workflow. Do not promote every UI field
just to make it visible. Promote only the ordinary Node surface the author wants
people and agents to see; choose typed composition inputs and outputs
independently.

The framework supplies `host` and `app`; it does not discover controlled nodes.
For every binding, choose both a stable selector and a search scope: a promoted
host widget, a role inside `host.subgraph`, a role in the containing/root graph
or recursive workflow, or a path from a named host slot. Workflow wires are not
required for UI access unless the binding deliberately follows those wires.

Visible titles, screen position and node order are not identity. A role binding
survives title changes and unrelated rewiring; a connection binding does not
survive retargeting that path. Moving a node inside or outside a subgraph changes
its scope, so update the binding unless it intentionally performs a unique
recursive lookup. Scope external roles to the owning host when several App Views
can coexist. Treat zero or multiple matches as an unavailable binding instead of
silently choosing the first node. Avoid numeric node IDs except for an explicitly
version-locked workflow, and resolve bindings per host rather than in module-global
state.

## Deliver the workflow and its UI

This version attaches App Views to native subgraph nodes. Inspect or create the
appropriate subgraph before binding a UI; do not claim direct attachment to an
arbitrary ordinary node.

Return the prepared workflow JSON and one self-contained, named folder per UI.
Use an author-qualified folder name to avoid colliding with other installed UIs.
Keep its entrypoint, helpers and assets together inside that folder. Use relative
imports and asset URLs so the folder can be renamed. Register the renderer's
readable `name` and `source: import.meta.url`; the framework
derives the folder from that module's location and exposes it in **UI files…**.
For workflows with several UIs, include each required folder once. Explain the
delivery using subgraph names, folder names and exact destination paths, not
renderer IDs or a file-by-file scavenger hunt. Never tell the user to copy all
of `renderers` or overwrite an unrelated same-named folder.

The recipient installs ComfyUI-App-View once, copies each supplied UI folder
whole into `ComfyUI/custom_nodes/ComfyUI-App-View/web/renderers`, and restarts.
There is no need to resend the framework or a wrapper named `custom_nodes`.
A JSON import carries graph values and renderer ID, not JavaScript. If the UI
is already installed, the JSON alone is sufficient. A skill is for authoring,
not for using a finished UI.

The renderer ID belongs to each subgraph, not to the JSON filename. Match it to
the ID registered by the UI module; filenames are not inferred from IDs.
Use distinct namespaced IDs for different UIs and a new version for incompatible
bindings. Duplicate registrations are rejected, not replaced. Reuse the same
installed UI across workflows and keep values in each host. Bind by stable
roles or promoted widget names, not workflow filenames or numeric node IDs.
Preserve the binding through edits unrelated to its controls. Retarget affected
bindings when the controlled nodes/settings change; do not clone the UI just
because the surrounding workflow differs.

Keep author-facing APIs and code examples in the skill references. Keep the
root README brief: where the extension goes, where additional UI files go,
and what accompanies the JSON. Avoid GitHub download tutorials, stock ComfyUI
instructions and repeated explanations of the same installation steps.
Identify example-only node dependencies explicitly. Model download metadata
belongs in the workflow JSON; do not generate a second model-link document.

## Agent use

The official local Comfy MCP can inspect custom nodes, list workflow slots and
notes, validate the workflow, change saved slots, and run it. It does not author
frontend renderer files or automatically turn extension operations into MCP
tools. A coding agent using this skill authors the UI package; MCP is useful for
workflow discovery and verification.

Give promoted fields clear labels and add a normal Markdown Note when an agent
needs semantic guidance. Add a separate live-UI bridge only when the requested
behavior truly requires controlling an already-open browser instance.

## Verification

Run the project validators and operate the real frontend. Verify Node and App
presentations, App-to-workflow and workflow-to-App changes, save/reload,
renderer absence, ordinary Run, Node 2.0, legacy, and manual resizing. Wait for
custom node definitions before loading the workflow; placeholder `UNKNOWN`
widgets prove only that the frontend was loaded too early. If a renderer borrows
a native DOM/canvas widget, mount it only while App is visible, force its first
render when necessary, and restore it to the original parent on hide/dispose.
Use the host's visibility lifecycle, not just saved `app_view_mode` or
`element.isConnected`: entering a subgraph can leave an inactive App in the DOM.
Test App -> inner graph -> App repeatedly and also enter from Node mode.
Before styling, run a narrow binding regression in Node 2.0 and legacy. For each
DOM-backed control, assert the canonical value and JavaScript type in the inner
widget, promoted host widget, exported execution prompt, and after
serialize/reload. DOM selects return strings; normalize against the workflow
widget's type before invoking callbacks, then propagate the callback-normalized
widget value rather than the raw DOM value.
Promoting a media selector to a connected input hides the original selector and
input preview in Node 2.0 by design. Keep a locally editable loader's selector
unconnected; App can bind directly to it without promoting it.
After replacing framework or renderer files, reload the frontend once so the new
module is actually under test. In that fresh session, test an unavailable media
value followed by a valid selection without reopening the workflow; preview
metadata, timeline length and serialize/reload must recover. Address nested
output readback by the node's instance execution path, not the shared subgraph
definition ID, and verify it after reload with more than one host instance.
For automatic preparation, verify one partial target, one in-flight request,
invalidation on every preparation input, and an exact executed/error readback.
Partial queueing calls widget `beforeQueued` hooks across the graph, so confirm
that unrelated seeds and controls do not change.
Exercise its real pointer gestures. Node 2.0 WidgetDOM stops pointermove before
document-level listeners, so bridge movement at the canvas only when the reused
widget depends on a document listener and prevent duplicate legacy handling.
For nodes with autogrow inputs, check the exported execution prompt's input
names and values/connections. A valid node count or a visible cable does not
prove that width, height or frame count reaches the intended input.
For each binding strategy, also verify a renamed display title, unrelated
rewiring, missing and duplicate matches, and two hosts using the same renderer.
If moving a controlled node across a subgraph boundary is supported, verify that
move explicitly; otherwise report the binding's scope as a compatibility limit.
