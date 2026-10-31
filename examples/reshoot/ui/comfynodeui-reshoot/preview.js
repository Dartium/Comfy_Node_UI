import { createTimeline } from './timeline.js';

export function createPreviewPanel({host, camera, source, prepare, api, widget, setWidget, executionId, sourceUrl, queuePreparation}) {
  const root = document.createElement('section');
  root.className = 'reshoot-workspace';
  root.innerHTML = `<h3>Camera preview</h3><div class="reshoot-preview-modes">
    <button type="button" data-view="warp" aria-pressed="true">Warp preview</button>
    <button type="button" data-view="source" aria-pressed="false">Source</button></div>
    <div class="reshoot-preview-stage"><img alt="Warp preview" draggable="false" hidden><video muted playsinline hidden></video>
    <p class="reshoot-preview-help" hidden>Drag to orbit · Scroll to move closer</p>
    <p class="reshoot-preview-status" role="status">Preparing the 3D scene…</p></div>`;
  const stage = root.querySelector('.reshoot-preview-stage');
  const img = root.querySelector('img'), video = root.querySelector('video');
  const help = root.querySelector('.reshoot-preview-help');
  const status = root.querySelector('[role="status"]');
  let active = false, appVisible = false, view = 'warp', playing = false, disposed = false;
  let inflight = false, rerun = false, shown = '', objectUrl, aborter, timer, drag, metadataCount = 1;
  let mediaReady = false, preparingFor = null, failedFor = null, prepareTimer = null;
  const fingerprint = () => JSON.stringify([widget(source,'file')?.value, widget(prepare,'duration')?.value, widget(prepare,'aspect_ratio')?.value, widget(prepare,'megapixels')?.value]);
  let cachedFor = host.properties.reshoot_preview_source ?? null;
  function count() {
    if (cachedFor === fingerprint() && camera._crossviewClipFrames > 0) return camera._crossviewClipFrames;
    return metadataCount;
  }
  function frame() { return Math.max(1, Math.min(count(), Number(widget(camera,'frame_index')?.value ?? 1))); }
  function updateMetadata() {
    const available = Math.floor(video.duration * 24);
    const requested = Math.round(Number(widget(prepare,'duration')?.value ?? 5) * 24);
    const rounded = requested + ((5 - requested % 17) + 17) % 17;
    const n = Math.min(rounded, available);
    metadataCount = Number.isFinite(n) && n >= 5 ? n - (n - 5) % 17 : 1;
  }
  const timeline = createTimeline({camera, widget, setWidget, sourceFrames:count, onSeek:() => { stop(); sync(); }, onPlay:() => {
    if (playing) stop(); else { playing = true; timeline.setPlaying(true); shown = ''; sync(); }
  }});
  root.append(timeline.root);
  img.addEventListener('dragstart', event => event.preventDefault());
  function stop() { playing = false; clearTimeout(timer); timer = null; timeline.setPlaying(false); video.pause(); }
  const params = () => camera._crossviewPreview?.params() ?? {};
  const rounded = (value, digits) => {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  };
  function preparationStatus(message = 'Estimating depth and preparing the 3D scene…') {
    if (view !== 'warp') return;
    img.hidden = true;
    help.hidden = true;
    status.hidden = false;
    status.textContent = message;
  }
  function schedulePreparation() {
    const wanted = fingerprint();
    if (!appVisible || disposed || !mediaReady || !sourceUrl() || cachedFor === wanted ||
        preparingFor || failedFor === wanted || !executionId(camera)) return;
    clearTimeout(prepareTimer);
    prepareTimer = setTimeout(async () => {
      const requested = fingerprint();
      if (!appVisible || disposed || !mediaReady || cachedFor === requested || preparingFor ||
          failedFor === requested) return;
      preparingFor = requested;
      preparationStatus();
      try {
        await queuePreparation(executionId(camera));
      } catch (error) {
        if (preparingFor !== requested) return;
        preparingFor = null;
        failedFor = requested;
        preparationStatus(`Scene preparation failed: ${error.message}`);
      }
    }, 120);
  }
  async function request() {
    if (!active || disposed || view !== 'warp') return;
    if (inflight) { rerun = true; return; }
    if (cachedFor !== fingerprint()) {
      preparationStatus(video.error || !sourceUrl()
        ? 'Choose an available source video.'
        : !mediaReady ? 'Loading source video…'
        : failedFor === fingerprint()
          ? 'Scene preparation failed. Check ComfyUI’s error and run again.'
          : 'Estimating depth and preparing the 3D scene…');
      schedulePreparation();
      stop(); return;
    }
    const payload = {node_id:executionId(camera), frame:frame(), iso:false, params:params()};
    const requestedSource = fingerprint();
    const stillCurrent = () => !disposed && active && view === 'warp' && fingerprint() === requestedSource;
    const sig = JSON.stringify(payload);
    if (sig === shown && !playing) return;
    inflight = true;
    aborter = new AbortController();
    try {
      const response = await api.fetchApi(camera._crossviewPreview?.endpoint ?? '/crossview_preview/render', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:aborter.signal,
      });
      if (!stillCurrent()) return;
      if (!response.ok) {
        stop(); img.hidden = true; help.hidden = true; status.hidden = false;
        if (response.status === 409) {
          cachedFor = null;
          delete host.properties.reshoot_preview_source;
          status.textContent = 'Preview cache is empty. Preparing the 3D scene…';
          schedulePreparation();
        } else {
          status.textContent = `Preview failed (${response.status}).`;
        }
        shown = sig; return;
      }
      const info = JSON.parse(response.headers.get('X-Preview-Info') ?? 'null');
      if (info && camera._crossviewPreview) {
        camera._crossviewPreview.setCount(info.count);
        camera._crossviewPreview.pivot = info.pivot;
      }
      const nextUrl = URL.createObjectURL(await response.blob());
      if (!stillCurrent()) { URL.revokeObjectURL(nextUrl); return; }
      const previousUrl = objectUrl; objectUrl = nextUrl; img.src = nextUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      img.hidden = false; help.hidden = false; status.hidden = true; shown = sig;
      if (playing) timer = setTimeout(() => {
        setWidget(camera,'frame_index',frame() >= count() ? 1 : frame() + 1);
        timeline.sync(); request();
      }, 1000 / 24);
    } catch (error) {
      if (error.name !== 'AbortError' && stillCurrent()) { status.hidden = false; status.textContent = `Preview unavailable: ${error.message}`; stop(); shown = sig; }
    } finally {
      inflight = false;
      if (rerun) {
        rerun = false;
        queueMicrotask(request);
      }
    }
  }
  stage.addEventListener('pointerdown', event => {
    if (view !== 'warp' || img.hidden || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); stage.setPointerCapture(event.pointerId); stop();
    camera._crossviewPreview?.beginAudition();
    drag = {x:event.clientX,y:event.clientY,az:Number(widget(camera,'azimuth')?.value),el:Number(widget(camera,'elevation')?.value)};
  });
  stage.addEventListener('pointermove', event => {
    if (!drag) return;
    event.stopPropagation();
    const scale = stage.getBoundingClientRect().width / stage.offsetWidth || 1;
    setWidget(camera,'azimuth',rounded(Math.max(-180,Math.min(180,drag.az + (event.clientX-drag.x) / scale * .35)), 1));
    setWidget(camera,'elevation',rounded(Math.max(-89,Math.min(89,drag.el - (event.clientY-drag.y) / scale * .35)), 1));
    request();
  });
  stage.addEventListener('pointerup', () => { drag = null; request(); });
  stage.addEventListener('pointercancel', () => { drag = null; request(); });
  stage.addEventListener('wheel', event => {
    if (view !== 'warp') return;
    event.preventDefault(); event.stopPropagation(); camera._crossviewPreview?.beginAudition();
    setWidget(camera,'distance',rounded(Math.max(.1,Math.min(10,Number(widget(camera,'distance')?.value) * (event.deltaY > 0 ? 1.05 : 1/1.05))), 2));
    request();
  }, {passive:false});
  for (const button of root.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    stop(); view = button.dataset.view;
    for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed',String(b===button));
    img.hidden = view !== 'warp'; video.hidden = view !== 'source'; shown = '';
    help.hidden = view !== 'warp' || img.hidden;
    if (view === 'source' && video.error) video.load();
    sync();
  });
  video.addEventListener('loadedmetadata', () => {
    mediaReady = true; failedFor = null; updateMetadata(); timeline.sync(); schedulePreparation();
    if (view === 'source') { video.hidden = false; status.hidden = true; }
  });
  video.addEventListener('error', () => {
    mediaReady = false;
    img.hidden = view === 'warp'; help.hidden = true;
    status.hidden = false; status.textContent = 'Choose an available source video.';
  });
  const onExecuted = ({detail}) => {
    if (String(detail.node ?? detail.display_node) !== executionId(camera)) return;
    if (!detail.output?.crossview_preview) return;
    const completedFor = preparingFor ?? fingerprint();
    preparingFor = null; failedFor = null;
    cachedFor = completedFor; host.properties.reshoot_preview_source = completedFor;
    shown = ''; rerun = true;
    if (completedFor === fingerprint()) request(); else schedulePreparation();
  };
  const onExecutionFailure = () => {
    if (!preparingFor) return;
    failedFor = preparingFor;
    preparingFor = null;
    preparationStatus('Scene preparation failed. Check ComfyUI’s error and run again.');
  };
  api.addEventListener('executed',onExecuted);
  api.addEventListener('execution_error',onExecutionFailure);
  api.addEventListener('execution_interrupted',onExecutionFailure);
  function sync() {
    const url = sourceUrl();
    if (video.dataset.source !== url) {
      video.dataset.source = url;
      if (url) video.src = url; else video.removeAttribute('src');
      metadataCount = 1; mediaReady = false; failedFor = null; stop(); video.load();
    }
    updateMetadata(); timeline.sync();
    if (mediaReady && cachedFor !== fingerprint()) schedulePreparation();
    if (view === 'source') {
      video.hidden = false;
      status.hidden = video.readyState >= 1 && !video.error;
      status.textContent = video.error || !url
        ? 'Choose an available source video.' : 'Loading source video…';
      if (!active) return;
      const t = (frame()-1)/24;
      if (Number.isFinite(video.duration) && Math.abs(video.currentTime-t) > .025) video.currentTime = t;
      if (playing && !timer) timer = setTimeout(() => {
        timer = null; setWidget(camera,'frame_index',frame() >= count() ? 1 : frame()+1); sync();
      }, 1000/24);
    } else {
      if (!active) return;
      request();
    }
  }
  return {root, sync,
    setActive(value) {active = value; if (!active) {stop(); aborter?.abort();} else sync();},
    setAppVisible(value) {appVisible = value; if (!appVisible) clearTimeout(prepareTimer); else {sync(); schedulePreparation();}},
    dispose() {disposed = true; clearTimeout(prepareTimer); stop(); aborter?.abort();
      api.removeEventListener('executed',onExecuted);
      api.removeEventListener('execution_error',onExecutionFailure);
      api.removeEventListener('execution_interrupted',onExecutionFailure);
      if(objectUrl) URL.revokeObjectURL(objectUrl); video.removeAttribute('src'); video.load();}};
}
