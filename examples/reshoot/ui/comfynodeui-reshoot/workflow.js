// Migrate known defects in the released Re-shoot example.
// Connections are identified by roles and socket names, never by node numbers.
function uniqueRole(nodes, role) {
  const matches = (nodes ?? []).filter((node) => node.properties?.reshoot_role === role);
  return matches.length === 1 ? matches[0] : undefined;
}

export function reserveReshootVideoSpace(definition, source) {
  if (!Array.isArray(source.pos) || !Array.isArray(source.size)) return;
  source.size[1] = Math.max(source.size[1], 520);
  const below = definition.nodes.filter((node) => Array.isArray(node.pos) &&
    Math.abs(node.pos[0] - source.pos[0]) < 40 && node.pos[1] > source.pos[1]);
  const nearest = Math.min(...below.map((node) => node.pos[1]));
  const offset = Math.max(0, source.pos[1] + source.size[1] + 40 - nearest);
  if (offset) for (const node of below) node.pos[1] += offset;
}

// Used when preparing the example, not as a load hook on arbitrary user graphs.
// The video with original audio stays outside as the visible output.
export function containAuxiliaryOutputs(workflow) {
  const hosts = workflow.nodes?.filter(n => n.properties?.app_view_renderer === 'reshoot@1') ?? [];
  const host = hosts.length === 1 ? hosts[0] : undefined;
  const definition = workflow.definitions?.subgraphs?.find(g => g.id === host?.type);
  if (!definition) return workflow;
  const seedRoles = definition.nodes.filter(n => n.properties?.reshoot_role === 'seed');
  const seedCandidates = definition.nodes.filter(n => n.type === 'RandomNoise');
  if (!seedRoles.length && seedCandidates.length === 1) {
    seedCandidates[0].properties ??= {};
    seedCandidates[0].properties.reshoot_role = 'seed';
  }
  const outsidePosition = uniqueRole(workflow.nodes, 'generated-save')?.pos
    ?? [host.pos[0] + 1240, host.pos[1]];
  for (const role of ['warp-save', 'generated-save']) {
    const node = uniqueRole(workflow.nodes, role);
    if (!node || node.type !== 'SaveVideo') continue;
    if (node.inputs.some((input,index) => index > 0 && input.link != null) ||
        node.outputs?.some(output => output.links?.length)) continue;
    const link = workflow.links.find(l => l[1] === host.id && l[3] === node.id && l[4] === 0);
    if (!link || definition.nodes.some(n => n.id === node.id)) continue;
    const boundary = definition.links.find(l => l.target_id === -20 && l.target_slot === link[2]);
    if (!boundary) continue;
    const id = ++definition.state.lastLinkId;
    definition.links.push({id,origin_id:boundary.origin_id,origin_slot:boundary.origin_slot,target_id:node.id,target_slot:0,type:'VIDEO'});
    definition.nodes.find(n => n.id === boundary.origin_id).outputs[boundary.origin_slot].links.push(id);
    node.inputs[0].link = id;
    node.properties.reshoot_app_member = true;
    node.pos = [3900, role === 'warp-save' ? 350 : 850];
    definition.nodes.push(node);
    if (typeof node.id === 'number') definition.state.lastNodeId = Math.max(definition.state.lastNodeId, node.id);
    workflow.nodes = workflow.nodes.filter(n => n !== node);
    workflow.links = workflow.links.filter(l => l !== link);
    host.outputs[link[2]].links = host.outputs[link[2]].links.filter(n => n !== link[0]);
  }
  const original = uniqueRole(definition.nodes, 'original-audio-save');
  if (original?.type === 'SaveVideo' &&
      !workflow.nodes.some(n => n.id === original.id) &&
      !original.inputs.some((input,index) => index > 0 && input.link != null) &&
      !original.outputs?.some(output => output.links?.length)) {
    const link = definition.links.find(l => l.id === original.inputs[0]?.link);
    const boundary = link && definition.links.find(l => l.target_id === -20 &&
      l.origin_id === link.origin_id && l.origin_slot === link.origin_slot);
    if (boundary) {
      const id = Math.max(workflow.last_link_id ?? 0, ...workflow.links.map(l => l[0])) + 1;
      workflow.last_link_id = id;
      workflow.links.push([id,host.id,boundary.target_slot,original.id,0,'VIDEO']);
      (host.outputs[boundary.target_slot].links ??= []).push(id);
      definition.nodes.find(n => n.id === link.origin_id).outputs[link.origin_slot].links =
        definition.nodes.find(n => n.id === link.origin_id).outputs[link.origin_slot].links.filter(n => n !== link.id);
      definition.links = definition.links.filter(l => l !== link);
      definition.nodes = definition.nodes.filter(n => n !== original);
      original.inputs[0].link = id;
      delete original.properties.reshoot_app_member;
      original.pos = [...outsidePosition];
      workflow.nodes.push(original);
      if (typeof original.id === 'number') workflow.last_node_id = Math.max(workflow.last_node_id,original.id);
    }
  }
  host.properties.app_view_layout ??= 'expanded';
  return workflow;
}

export function repairLegacyReshootWorkflow(workflow) {
  const definitions = workflow?.definitions?.subgraphs ?? [];
  const containers = [workflow, ...definitions];
  let repaired = 0;
  for (const definition of definitions) {
    const hosts = containers.flatMap((graph) => (graph.nodes ?? [])
      .filter((node) => node.type === definition.id && node.properties?.app_view_renderer === "reshoot@1")
      .map((node) => ({ graph, node })));
    if (!hosts.length) continue;
    const role = (name) => uniqueRole(definition.nodes, name);
    const prepare = role("prepare"), prompt = role("prompt"), source = role("source-video");
    if (!role("seed")) {
      const seeds = definition.nodes?.filter((node) => node.type === "RandomNoise") ?? [];
      if (seeds.length === 1) {
        seeds[0].properties ??= {};
        seeds[0].properties.reshoot_role = "seed";
        repaired++;
      }
    }
    const seed = role("seed");
    if (seed?.type === "RandomNoise") {
      if (Array.isArray(seed.widgets_values) && seed.widgets_values[1] !== "fixed") {
        seed.widgets_values[1] = "fixed";
        repaired++;
      }
      if (seed.widgets_values_named?.control_after_generate !== undefined &&
          seed.widgets_values_named.control_after_generate !== "fixed") {
        seed.widgets_values_named.control_after_generate = "fixed";
        repaired++;
      }
    }
    if (!prepare || !prompt || source?.type !== "LoadVideo") continue;

    const names = ["width", "height", "length"];
    const links = names.map((name) => {
      const slot = prepare.outputs?.findIndex((output) => output.name === name);
      return definition.links.find((link) => link.origin_id === prepare.id &&
        link.origin_slot === slot && link.target_id === prompt.id);
    });
    const oldTargets = ["height", "length", "ref_image_size"];
    if (prompt.inputs.find((input) => input.name === "width")?.link == null &&
        links.every((link, index) => link && prompt.inputs[link.target_slot]?.name === oldTargets[index])) {
      for (const input of prompt.inputs) if (links.some((link) => link.id === input.link)) input.link = null;
      links.forEach((link, index) => {
        link.target_slot = prompt.inputs.findIndex((input) => input.name === names[index]);
        link.type = prompt.inputs[link.target_slot].type;
        prompt.inputs[link.target_slot].link = link.id;
      });
      repaired++;
    }

    // Do not remove a deliberately wired media input, or collapse different
    // per-instance files into one shared definition. Those are authored graphs.
    if (hosts.length !== 1) continue;
    const { graph, node: host } = hosts[0];
    const outerIndex = host.inputs?.findIndex((input) => input.name === "file") ?? -1;
    const innerIndex = definition.inputs?.findIndex((input) => input.name === "file") ?? -1;
    const fileInput = source.inputs?.find((input) => input.name === "file");
    if (outerIndex < 0 || innerIndex < 0 || host.inputs[outerIndex].link != null || fileInput?.link == null) continue;
    const promotion = definition.links.find((link) => link.id === fileInput.link);
    if (!promotion || promotion.origin_id !== -10 || promotion.origin_slot !== innerIndex ||
        promotion.target_id !== source.id || definition.inputs[innerIndex].linkIds?.length !== 1) continue;
    const widgetIndex = host.inputs.slice(0, outerIndex).filter((input) => input.widget).length;
    const value = host.widgets_values_named?.file ?? host.widgets_values?.[widgetIndex];
    if (typeof value !== "string") continue;

    source.widgets_values_named ??= {};
    source.widgets_values_named.file = value;
    const innerWidgetIndex = source.inputs.filter((input) => input.widget).findIndex((input) => input.name === "file");
    if (Array.isArray(source.widgets_values) && innerWidgetIndex >= 0) source.widgets_values[innerWidgetIndex] = value;
    fileInput.link = null;
    definition.links = definition.links.filter((link) => link !== promotion);
    definition.inputs.splice(innerIndex, 1);
    for (const link of definition.links) {
      if (link.origin_id === -10 && link.origin_slot > innerIndex) link.origin_slot--;
    }
    host.inputs.splice(outerIndex, 1);
    if (Array.isArray(host.widgets_values)) host.widgets_values.splice(widgetIndex, 1);
    if (host.widgets_values_named) delete host.widgets_values_named.file;
    reserveReshootVideoSpace(definition, source);
    for (const link of graph.links ?? []) {
      if (Array.isArray(link)) {
        if (link[3] === host.id && link[4] > outerIndex) link[4]--;
      } else if (link.target_id === host.id && link.target_slot > outerIndex) link.target_slot--;
    }
    repaired++;
  }
  return repaired;
}
