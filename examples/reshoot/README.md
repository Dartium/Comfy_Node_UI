# Re-shoot example

This example is separate from the generic extension. Install it only when you
want to open `reshoot-app-view.json` with its custom interface.

1. Copy `ui/comfynodeui-reshoot` into
   `ComfyUI/custom_nodes/ComfyUI-App-View/web/renderers/`.
2. Copy `nodes/ComfyUI-CrossViewWarp` into ComfyUI's `custom_nodes` folder.
3. Restart ComfyUI and open `reshoot-app-view.json`.

After replacing this UI folder with an update, reopen the workflow or reload
ComfyUI so its existing App instance is rebuilt from the new files.

Model download links are stored in the workflow JSON.

In App, expand the right panel for **Preview & keyframes** or **Output**.
Choosing a valid source automatically queues only depth and the 3D warp preview.
Aim the camera and add keyframes there, then use ComfyUI's Run button for the
final generation.
Save Video with the original audio remains outside the subgraph; the generated
and warp saves stay inside.

For two Re-shoot Apps in one workflow, duplicate the subgraph definition. Two
host nodes cannot share one definition because its native camera widget and
inner nodes are shared; the UI reports that configuration instead of sharing
controls silently.
