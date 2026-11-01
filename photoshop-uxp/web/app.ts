import { workerSource } from './worker_source';
import { colorWorkerSource } from './color_worker_source';
import { previewWorkerSource } from './preview_worker_source';
import { LatestWorker, now, type Backend, type Reply, type Timings } from './jobs';
import { PngPresenter } from './presentation';
import { Context, RGB, VIEWS, finiteRGB, sameRGB } from '../host/protocol';
import { HostBridge, HOST_REPLY_TIMEOUT } from './bridge';
import { InterfaceFitter } from './fitting';
import { clamp01, slicePoint, trackwheelDelta, trackMotionAcceleration, J_REFERENCE_WHITE } from './math';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = $('pad'), wheel = $('wheel'), marker = $('selection');
const fields = ['j','x','y'].map(id => $<HTMLInputElement>(id));
const presenter = new PngPresenter();
const colorWorker = new LatestWorker(colorWorkerSource,'Color evaluation',['selection','checker'],receive,
  message => { clearQueuedCommit('worker failure'); status('Color worker failed: '+message,true); });
const previewWorker = new LatestWorker(previewWorkerSource,'Preview encoding',['preview','checker-png'],receive,
  message => status('Preview worker failed: '+message,true));
const sliceWorker = new LatestWorker(workerSource,'Slice rendering',['render'],receive,
  message => { lastRender = ''; status('Slice worker failed: '+message,true); });
let backend: Backend | undefined;
let backendGeneration = 0;
const history: { id: number; kind: string; timings: Timings; [key: string]: unknown }[] = [];
function measured(id: number, kind: string, timings: Timings, details: Record<string,unknown> = {}) {
  history.push({ id, kind, timings, ...details }); if (history.length > 32) history.shift();
}
let context: Context = { documentId: null, view: 0, viewName: 'Waiting for document', fallback: true, foreground: null };
let haveContext = false, code = [.46,.5,.5], full = false, scene: RGB | null = null, external: RGB | null = null;
let sequence = 0, selectionId = 0, completedSelection = 0, renderId = 0, checkerId = 0, activity = 0;
let valid = false, dragging: 'xy' | 'j' | null = null, pointer: { id: number; axis: 'xy' | 'j' } | null = null;
const arrowKeys = new Set<string>();
let wheelY = 0, wheelTime = 0, wheelTimer: ReturnType<typeof setTimeout> | undefined, rawJ = code[0];
type Feedback = 'idle' | 'gesture' | 'evaluation' | 'commit' | 'sync' | 'error';
let feedback: Feedback = 'idle';
type ClientTransaction = { id: number; documentId: number | null; code: number[]; source: string;
  requested?: RGB; events: Record<string, unknown>[] };
const transactions: ClientTransaction[] = [];
type PendingCommit = { id: number; documentId: number; epoch: number; selectionId: number;
  transaction: ClientTransaction; settled?: boolean; timer?: ReturnType<typeof setTimeout> };
let queuedCommit: PendingCommit | null = null, pendingCommit: PendingCommit | null = null;
let pendingSync: { id: number; epoch: number; sent: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
let expectedEchoes: { id: number; documentId: number; scene: RGB }[] = [];
let patchCodes: number[][] = [], activePatch = -1, lastRender = '', capabilities: Record<string, unknown> = {};
let lastGesture: Record<string, unknown> | null = null;
const bridge = new HostBridge(() => ++sequence, () => sendSync(), message => {
  if (pendingSync) { clearTimeout(pendingSync.timer); pendingSync = null; }
  status(message,true);
});
function status(text: string, error = false, phase: Feedback = error ? 'error' : 'idle') {
  feedback = phase; $('status').textContent = text; $('status').classList.toggle('error',error);
}
function trace(transaction: ClientTransaction, phase: string, details: Record<string, unknown> = {}) {
  transaction.events.push({ phase, timestamp: new Date().toISOString(), ...details });
}
function clearQueuedCommit(reason = 'superseded') {
  if (!queuedCommit) return;
  clearTimeout(queuedCommit.timer); trace(queuedCommit.transaction,'cancelled',{reason}); queuedCommit = null;
}
function cancelGesture() {
  const captured = pointer; pointer = null; dragging = null; clearQueuedCommit('gesture cancelled');
  arrowKeys.clear();
  if (captured) {
    try { (captured.axis === 'xy' ? pad : wheel).releasePointerCapture(captured.id); } catch { /* Window release remains available. */ }
  }
  if (wheelTimer) clearTimeout(wheelTimer); wheelTimer = undefined;
}
function beginActivity() {
  cancelGesture(); activity++;
  if (pendingSync) clearTimeout(pendingSync.timer); pendingSync = null;
  if (pendingCommit) clearTimeout(pendingCommit.timer);
}
function beginGesture(axis: 'xy' | 'j') {
  beginActivity(); dragging = axis;
  status('Drag to preview · release to set',false,'gesture');
}
function png(key: string, bytes: Uint8Array<ArrayBuffer>, id: number, current: () => boolean,
  displayed?: (decodeMs: number) => void) {
  void presenter.show(key,bytes,current).then(result => {
    measured(id,'decode:'+key,{ decodeMs: result.decodeMs },{ state:result.state });
    if (result.state === 'displayed') displayed?.(result.decodeMs);
    else if (result.state === 'failed') {
      if (key === 'slice') lastRender = '';
      status(result.error ?? 'PNG decoding failed.',true);
    }
  });
}
function sliceSize() { return backend === 'WASM' && dragging ? 128 : 256; }
function sliceKey() { return [context.view,code[0],full,sliceSize(),backendGeneration].join(':'); }
function rendererLabel(pending = false) {
  const displayed = capabilities.displayed as any;
  if (!displayed) { $('renderer').textContent = 'Rendering…'; return; }
  const device = displayed.device;
  const identity = device?.software ? ' · software' : displayed.renderer !== 'WASM' && !device?.vendor && !device?.renderer && !device?.architecture ? ' · device unknown' : '';
  $('renderer').textContent = `${displayed.renderer} · ${displayed.size}²${identity}${pending ? ' · updating' : ''}`;
  $('renderer').title = JSON.stringify({device,timings:displayed.timings,requested:capabilities.requested,displayedJ:displayed.j},null,2);
}
function coordinates() {
  fields.forEach((field,i) => { if (document.activeElement !== field) field.value = code[i].toFixed(4); });
  marker.style.left = code[1]*100+'%'; marker.style.top = (1-code[2])*100+'%';
  $('wheel-dot').style.top = (1-code[0])*100+'%'; wheel.setAttribute('aria-valuenow',code[0].toFixed(4));
  document.querySelectorAll('.patch').forEach((el,i) => el.classList.toggle('active',i===activePatch));
}
function render(force = false) {
  const signature = sliceKey();
  if (!force && signature === lastRender) return;
  lastRender = signature; renderId = ++sequence;
  presenter.invalidate('slice');
  capabilities.requested = { id:renderId,j:code[0],view:context.view,full,size:sliceSize(),at:now() };
  rendererLabel(true);
  sliceWorker.submit({ type:'render',id:renderId,epoch:activity,view:context.view,code:[...code],full,interacting:!!dragging,key:signature });
}
function selection() {
  clearQueuedCommit(); selectionId = ++sequence; valid = false;
  presenter.invalidate('preview');
  colorWorker.submit({ type:'selection',id:selectionId,epoch:activity,view:context.view,code:[...code],full,scene:external });
  coordinates(); render();
}
function importForeground(rgb: RGB) { external = [...rgb]; activePatch = -1; selection(); }
function unavailableForeground() {
  selectionId = ++sequence; valid = false; scene = external = null; marker.hidden = true;
  $('rgb').textContent = '—'; $('selection-state').textContent = 'Foreground unavailable'; render();
}
function checker() { checkerId = ++sequence; colorWorker.submit({ type:'checker',id:checkerId,epoch:activity,view:context.view }); }
function commit(source: string) {
  const transaction: ClientTransaction = { id: ++sequence, documentId: context.documentId, code: [...code], source, events: [] };
  transactions.push(transaction); if (transactions.length > 8) transactions.shift();
  trace(transaction,'released',{selectionId});
  if (!bridge.connected) {
    trace(transaction,'blocked',{reason:'disconnected'});
    status('Photoshop is disconnected. Click Sync foreground before setting a color.',true); bridge.connect(); return;
  }
  if (context.documentId === null) {
    trace(transaction,'blocked',{reason:'no document'}); status('Open a 32-bit ACEScg document to set the foreground.'); return;
  }
  if (!context.foreground || context.error) {
    trace(transaction,'blocked',{reason:context.error ?? 'no floats'});
    status(context.error ?? 'Floating-point foreground data unavailable. Capture diagnostics.',true); return;
  }
  clearQueuedCommit();
  const request: PendingCommit = { id: transaction.id, documentId: context.documentId, epoch: activity, selectionId, transaction };
  queuedCommit = request;
  status('Evaluating selected color…',false,'evaluation');
  request.timer = setTimeout(() => {
    if (queuedCommit !== request) return;
    clearQueuedCommit('evaluation timeout');
    status('Color evaluation did not finish. Photoshop’s foreground was not changed.',true);
  },HOST_REPLY_TIMEOUT);
  flushCommit();
}
function flushCommit() {
  const request = queuedCommit;
  if (!request || completedSelection !== request.selectionId) return;
  clearTimeout(request.timer); queuedCommit = null;
  if (request.epoch !== activity || request.documentId !== context.documentId) { trace(request.transaction,'cancelled'); return; }
  if (!valid || !scene || external) {
    trace(request.transaction,'blocked',{reason:'outside authoring gamut or external color'});
    status('This coordinate is outside the authoring gamut. Foreground preserved.',true); return;
  }
  request.transaction.requested = [...scene]; pendingCommit = request;
  expectedEchoes.push({ id: request.id, documentId: request.documentId, scene: [...scene] });
  expectedEchoes = expectedEchoes.slice(-8);
  status('Setting foreground…',false,'commit'); trace(request.transaction,'sent',{scene:[...scene]});
  request.timer = setTimeout(() => {
    if (pendingCommit !== request || request.epoch !== activity) return;
    trace(request.transaction,'reply-timeout');
    status('Photoshop has not confirmed the foreground update. Click Sync foreground to check.',true);
  },HOST_REPLY_TIMEOUT);
  if (!bridge.send({ type:'commit',id:request.id,documentId:request.documentId,scene:[...scene] })) {
    clearTimeout(request.timer); trace(request.transaction,'send-failed',{bridge:bridge.snapshot()});
    expectedEchoes = expectedEchoes.filter(e => e.id !== request.id); pendingCommit = null;
    status('Could not send the foreground color to Photoshop. Click Sync foreground to reconnect.',true);
  }
}
function syncForeground() {
  beginActivity();
  pendingSync = { id: ++sequence, epoch: activity, sent: false };
  status('Reading Photoshop foreground…',false,'sync');
  if (bridge.connected) sendSync(); else bridge.connect();
}
function sendSync() {
  const request = pendingSync;
  if (!request || request.sent || !bridge.connected) return;
  request.sent = true;
  request.timer = setTimeout(() => {
    if (pendingSync !== request || request.epoch !== activity) return;
    request.timer = undefined;
    status('Photoshop did not return its foreground. Click Sync foreground to try again.',true);
  },HOST_REPLY_TIMEOUT);
  if (!bridge.send({ type:'refresh',id:request.id })) {
    clearTimeout(request.timer); pendingSync = null;
    status('Could not request Photoshop’s foreground. Click Sync foreground to reconnect.',true);
  }
}
function snap(axis: 'xy'|'j', bypass = false) {
  activePatch = -1;
  if (bypass) { $('snap-label').textContent = 'Snapping bypassed'; return; }
  let distance = .02;
  patchCodes.forEach((patch,i) => {
    const d = Math.hypot(code[1]-patch[1],code[2]-patch[2]);
    if (d < distance) { activePatch = i; distance = d; }
  });
  if (axis === 'xy') {
    if (activePatch >= 0 && distance <= .005) code = [code[0],...patchCodes[activePatch].slice(1)];
    else if (Math.hypot(code[1]-.5,code[2]-.5) <= .005) code = [code[0],.5,.5];
  } else {
    const targets = activePatch < 0 ? [J_REFERENCE_WHITE] : [patchCodes[activePatch][0], J_REFERENCE_WHITE];
    targets.sort((a,b) => Math.abs(a-code[0])-Math.abs(b-code[0]));
    if (Math.abs(code[0]-targets[0]) <= .005) code[0] = targets[0];
  }
  $('snap-label').textContent = activePatch >= 0 ? `ColorChecker ${activePatch+1} · J′ ${patchCodes[activePatch][0].toFixed(3)}` : 'Drag to preview · release to set';
}
function movePad(event: PointerEvent) {
  const p = slicePoint(event.clientX,event.clientY,pad.getBoundingClientRect());
  code = [code[0],p.x,p.y]; external = null; snap('xy',event.altKey); selection();
}
function moveWheel(event: PointerEvent) {
  const delta = event.clientY-wheelY, height = wheel.getBoundingClientRect().height;
  if (delta === 0) return;
  const speed = Math.abs(delta)/Math.max(1,height)/(Math.max(1,event.timeStamp-wheelTime)/1000);
  rawJ = trackwheelDelta(rawJ,delta,height,.25,trackMotionAcceleration(speed)); code[0] = rawJ;
  wheelY = event.clientY; wheelTime = event.timeStamp; external = null; snap('j',event.altKey); selection();
}
for (const [element,axis] of [[pad,'xy'],[wheel,'j']] as const) {
  element.addEventListener('pointerdown',event => {
    if (event.button !== 0 || pointer) return;
    event.preventDefault(); element.focus(); beginGesture(axis); pointer = { id:event.pointerId,axis };
    lastGesture = { axis, pointerId:event.pointerId, phase:'started', capture:true };
    try { element.setPointerCapture(event.pointerId); }
    catch (error) { lastGesture.capture = false; lastGesture.captureError = String(error); }
    if (axis === 'xy') movePad(event);
    else { wheelY = event.clientY; wheelTime = event.timeStamp; rawJ = code[0]; }
  });
}
// Window capture receives outside-control release and also works when native
// pointer capture is unavailable. Clearing pointer first deduplicates release.
window.addEventListener('pointermove',event => {
  if (!pointer || event.pointerId !== pointer.id) return;
  if (pointer.axis === 'xy') movePad(event); else moveWheel(event);
},true);
window.addEventListener('pointerup',event => {
  if (!pointer || event.pointerId !== pointer.id) return;
  const gesture = pointer; pointer = null;
  if (gesture.axis === 'xy') movePad(event); else moveWheel(event);
  dragging = null;
  if (lastGesture) lastGesture.phase = 'released';
  try { (gesture.axis === 'xy' ? pad : wheel).releasePointerCapture(gesture.id); } catch { /* Already released. */ }
  render(); commit(gesture.axis === 'xy' ? 'pad' : 'wheel');
},true);
window.addEventListener('pointercancel',event => {
  if (!pointer || event.pointerId !== pointer.id) return;
  if (lastGesture) lastGesture.phase = 'cancelled'; cancelGesture(); render();
  if (feedback === 'gesture') status('Gesture cancelled. Foreground preserved.');
},true);
for (const [element,axis] of [[pad,'xy'],[wheel,'j']] as const) element.addEventListener('lostpointercapture',event => {
  if (pointer?.id === event.pointerId && pointer.axis === axis) { cancelGesture(); render(); status('Gesture cancelled. Foreground preserved.'); }
});
window.addEventListener('blur',() => { if (dragging) { cancelGesture(); render(); status('Gesture cancelled. Foreground preserved.'); } });
wheel.addEventListener('wheel',event => {
  if (!wheelTimer) { beginGesture('j'); rawJ = code[0]; }
  event.preventDefault(); external = null;
  const height = wheel.getBoundingClientRect().height;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
  rawJ = trackwheelDelta(rawJ,delta,height); code[0] = rawJ; snap('j',event.altKey); selection();
  if (wheelTimer) clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { dragging = null; wheelTimer = undefined; render(); commit('scroll'); },160);
},{passive:false});
for (const element of [pad,wheel]) {
  element.addEventListener('keydown',event => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const axis = element === wheel ? 'j' : 'xy';
    if (!arrowKeys.size || dragging !== axis || pointer || wheelTimer) beginGesture(axis);
    arrowKeys.add(event.key);
    external = null;
    const step = event.shiftKey ? .01 : .001;
    const index = axis === 'j' ? 0 : ['ArrowLeft','ArrowRight'].includes(event.key) ? 1 : 2;
    const sign = ['ArrowDown','ArrowLeft'].includes(event.key) ? -1 : 1;
    code[index] = clamp01(code[index]+sign*step);
    if (axis === 'xy') snap(axis,event.altKey);
    selection();
  });
  element.addEventListener('keyup',event => {
    if (!arrowKeys.delete(event.key) || arrowKeys.size || pointer || dragging !== (element === wheel ? 'j' : 'xy')) return;
    dragging = null; render(); commit('keyboard');
  });
}
fields.forEach((field,i) => field.addEventListener('change',() => {
  if (!field.value.trim() || !Number.isFinite(Number(field.value))) { field.value = code[i].toFixed(4); return; }
  beginActivity(); external = null; code[i] = clamp01(Number(field.value)); field.value = code[i].toFixed(4);
  selection(); commit('numeric');
}));
$('gamut').addEventListener('change',event => {
  beginActivity(); full = (event.target as HTMLSelectElement).value === 'full';
  external = scene; selection();
});
$('refresh').addEventListener('click',syncForeground);
$('diagnostics').addEventListener('click',() => {
  const snapshot = { ...capabilities, performance:{ version:1,history,queues:{ color:colorWorker.snapshot(),preview:previewWorker.snapshot(),slice:sliceWorker.snapshot() } }, viewport:{ width:window.innerWidth,height:window.innerHeight }, layout:fitter.snapshot(),
    bridge:bridge.snapshot(), interaction:{ activity,dragging,pointer,lastGesture,selectionId,completedSelection,
      queuedCommit:queuedCommit?.id,pendingCommit:pendingCommit?.settled ? undefined : pendingCommit?.id,
      pendingSync:pendingSync?.id,feedback,status:$('status').textContent },transactions };
  if (!bridge.send({ type:'diagnostics',capabilities:snapshot })) status('Diagnostics could not reach Photoshop. Click Sync foreground to reconnect.',true);
});
function receive(m: Reply) {
  if ('timings' in m) {
    if (m.type === 'gpu-timing') {
      const frame = [...history].reverse().find(item => item.id === m.id && item.kind === 'render');
      if (frame) Object.assign(frame.timings,m.timings);
      const displayed = capabilities.displayed as any;
      if (displayed?.id === m.id) { Object.assign(displayed.timings,m.timings); rendererLabel((capabilities.requested as any)?.id !== displayed.id); }
      return;
    }
    measured(m.id,m.type,m.timings);
  }
  if (m.type === 'selection' && m.id === selectionId) {
    completedSelection = m.id; code = m.code; scene = m.scene; valid = m.valid;
    marker.hidden = m.external && !valid; marker.classList.toggle('invalid',!valid);
    $('rgb').textContent = scene.map(v => v.toFixed(5)).join('  ');
    $('selection-state').textContent = valid ? 'Within authoring gamut' : m.external ? 'External color · outside picker domain' : 'Outside authoring gamut';
    if (queuedCommit && queuedCommit.selectionId === m.id) trace(queuedCommit.transaction,'evaluated',{valid,scene});
    coordinates(); flushCommit(); render();
    previewWorker.submit({ type:'preview',id:m.id,epoch:m.epoch,view:m.view,display:m.display,background:m.background,valid:m.external || m.valid });
  } else if (m.type === 'preview' && m.id === selectionId) {
    png('preview',m.png,m.id,() => m.id === selectionId);
  } else if (m.type === 'render') {
    if (backend && backend !== m.renderer) backendGeneration++;
    backend = m.renderer;
    capabilities.device = m.device; capabilities.failures = m.failures;
    // Fallback can discover WASM after release: an interactive 128px result
    // must then be followed by the current requested 256px result.
    if (m.id !== renderId) { render(); return; }
    if (m.size !== sliceSize()) { lastRender = ''; render(); return; }
    lastRender = sliceKey();
    capabilities.requested = { ...(capabilities.requested as object), size:m.size };
    png('slice',m.png,m.id,() => m.id === renderId,decodeMs => {
      capabilities = { ...capabilities, renderer:m.renderer,failures:m.failures,userAgent:navigator.userAgent,
        slice:{width:m.size,height:m.size},png:'cICP PQ 16-bit / ICC SDR 8-bit',
        displayed:{ id:m.id,j:m.code[0],view:m.view,full:m.full,size:m.size,renderer:m.renderer,device:m.device,
          decodedAt:now(),timings:{...m.timings,decodeMs} } };
      $('slice').dataset.requestId = String(m.id); $('slice').dataset.j = String(m.code[0]);
      rendererLabel(false);
    });
  } else if (m.type === 'checker-colors' && m.id === checkerId) {
    patchCodes = m.patches.map(patch => patch.code);
    previewWorker.submit({ type:'checker-png',id:m.id,epoch:m.epoch,view:m.view,patches:m.patches });
  } else if (m.type === 'checker' && m.id === checkerId) {
    const container = $('patches');
    for (let i=0;i<18;i++) presenter.remove('checker-'+i);
    container.replaceChildren();
    m.patches.forEach((patch,i) => {
      const dot = document.createElement('span'), img = document.createElement('img');
      dot.className = 'patch'; dot.style.left = patch.code[1]*100+'%'; dot.style.top = (1-patch.code[2])*100+'%';
      img.id = 'checker-'+i; img.alt = `ColorChecker ${i+1}`; dot.append(img); container.append(dot);
      png(img.id,patch.png,m.id,() => m.id === checkerId);
    });
  } else if (m.type === 'error') {
    if (m.id === queuedCommit?.selectionId) clearQueuedCommit('worker error');
    if (m.id === renderId) lastRender = '';
    if (m.id === selectionId || m.id === renderId || m.id === checkerId) status('Color rendering failed: '+m.message,true);
  }
}
window.addEventListener('message',event => {
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  if (bridge.receive(m)) return;
  if (m.type === 'theme') {
    const colors = m.colors;
    if (!colors || typeof colors !== 'object') return;
    for (const [key,css] of Object.entries({ background:'--panel-bg',foreground:'--panel-text',
      border:'--panel-border',secondary:'--panel-secondary',hoverBackground:'--panel-hover' })) {
      const value = colors[key];
      if (typeof value === 'string' && CSS.supports('color',value)) document.documentElement.style.setProperty(css,value);
    }
    if (colors.scheme === 'light' || colors.scheme === 'dark') {
      document.documentElement.style.colorScheme = colors.scheme; document.documentElement.dataset.theme = colors.scheme;
    }
  } else if (m.type === 'context') {
    const c = m.context as Context;
    if (!c || !(c.view in VIEWS) || !(c.documentId === null || Number.isInteger(c.documentId)) ||
        !(c.foreground === null || finiteRGB(c.foreground))) return;
    const explicit = Number.isInteger(m.requestId);
    if (explicit && (!pendingSync || pendingSync.id !== m.requestId || pendingSync.epoch !== activity)) return;
    // Correlated post-commit refreshes must not undo later gestures or report
    // a failed write as synchronized. A following ordinary poll still tracks
    // genuine changes from outside the plugin.
    const oldCommitRefresh = Number.isInteger(m.sourceCommitId) &&
      (!pendingCommit || pendingCommit.id !== m.sourceCommitId || pendingCommit.epoch !== activity);
    const switched = c.documentId !== context.documentId, viewChanged = c.view !== context.view;
    const colorChanged = !sameRGB(c.foreground,context.foreground);
    const echoIndex = expectedEchoes.findIndex(e => e.documentId === c.documentId && sameRGB(e.scene,c.foreground));
    const ownEcho = echoIndex >= 0;
    if (ownEcho) expectedEchoes.splice(0,echoIndex+1);
    const first = !haveContext; haveContext = true;
    if (explicit) { clearTimeout(pendingSync!.timer); pendingSync = null; }
    const changed = switched || viewChanged || (colorChanged && !ownEcho && !oldCommitRefresh);
    // An initial/polled context arriving while explicit sync is queued must
    // not cancel that sync; its correlated fresh snapshot is still required.
    if (changed && !explicit && !pendingSync) beginActivity();
    if (switched) expectedEchoes = [];
    context = c;
    bridge.confirm();
    $('view').textContent = VIEWS[c.view].replace('ACES 2.0 - ','');
    $('fallback').textContent = c.fallback ? `Default preview · ${c.viewName}` : '';
    if (viewChanged || !patchCodes.length) checker();
    if (explicit || first || changed) {
      if (c.foreground) importForeground(c.foreground); else unavailableForeground();
      if (!pendingSync) status(c.error ?? (c.documentId === null ? 'Open a 32-bit ACEScg document.' : 'Foreground synchronized.'),!!c.error);
    } else if (feedback === 'idle' && !Number.isInteger(m.sourceCommitId)) {
      status(c.error ?? (c.documentId === null ? 'Open a 32-bit ACEScg document.' : 'Foreground synchronized.'),!!c.error);
    }
  } else if (m.type === 'committed') {
    const transaction = transactions.find(t => t.id === m.id);
    if (transaction) trace(transaction,'host-reply',{applied:m.applied,foreground:m.foreground,reason:m.reason,error:m.error});
    if (!m.applied) expectedEchoes = expectedEchoes.filter(e => e.id !== m.id);
    const request = pendingCommit;
    if (!request || m.id !== request.id || request.epoch !== activity || m.documentId !== context.documentId) return;
    clearTimeout(request.timer); request.settled = true;
    // Retain the request as the provenance for its following context refresh.
    if (finiteRGB(m.foreground)) { context = { ...context,foreground:m.foreground }; importForeground(m.foreground); }
    if (m.error) status(m.error,true);
    else status(m.applied ? 'Foreground set.' : 'Foreground preserved; the request was cancelled.');
  } else if (m.type === 'host-error') {
    expectedEchoes = expectedEchoes.filter(e => e.id !== m.id);
    const transaction = transactions.find(t => t.id === m.id);
    if (transaction) trace(transaction,'host-error',{error:m.message});
    if (pendingSync && pendingSync.id === m.id && pendingSync.epoch === activity) {
      clearTimeout(pendingSync.timer); pendingSync = null; status(m.message,true);
    } else if (pendingCommit && pendingCommit.id === m.id && pendingCommit.epoch === activity) {
      clearTimeout(pendingCommit.timer); status(m.message,true);
    } else if (!m.id && feedback !== 'error' && feedback !== 'commit' && feedback !== 'sync' && feedback !== 'evaluation') status(m.message,true);
  } else if (m.type === 'notice' && feedback !== 'error' && feedback !== 'commit' && feedback !== 'sync' && feedback !== 'evaluation') status(m.message);
});
window.addEventListener('pagehide',() => {
  cancelGesture(); if (pendingSync) clearTimeout(pendingSync.timer); if (pendingCommit) clearTimeout(pendingCommit.timer);
  fitter.destroy(); bridge.destroy(); colorWorker.destroy(); previewWorker.destroy(); sliceWorker.destroy(); presenter.destroy();
});
const fitter = new InterfaceFitter($('fit-viewport'), $('interface'), () => {
  if (!dragging && !queuedCommit) return;
  if (lastGesture) lastGesture.phase = 'cancelled by resize';
  cancelGesture(); render();
  status('Panel resized. Gesture cancelled; foreground preserved.');
});
coordinates(); selection(); checker(); bridge.connect();
