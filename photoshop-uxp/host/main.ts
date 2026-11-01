import { Context, RGB, ForegroundReading, ForegroundResult, finiteRGB, readForeground,
  foregroundCommand, nativeForegroundCommand, ForegroundWriter, ForegroundFailure, HostQueue, resolveView } from './protocol';
import { ForegroundSampler } from './foreground';
import { PanelSizer } from './sizing';
import { EXTENSION, PANEL_CONFIGURATION } from './version';
declare function require(id: string): any;
const { app, action, core, imaging, constants } = require('photoshop');
const { entrypoints, storage, host } = require('uxp');
const webview = document.getElementById('picker') as any;
const sizer = new PanelSizer(webview, typeof core.suppressResizeGripper === 'function'
  ? () => core.suppressResizeGripper({ type: 'panel', target: 'picker', value: false }) : undefined, PANEL_CONFIGURATION);
const queue = new HostQueue();
let visible = false, ready = false, pollPending = false, listening = false, previous = '';
let timer: ReturnType<typeof setInterval> | undefined, visibilityEpoch = 0, readyId: number | undefined;
let lastDocument: number | null = null, lastDescriptor: unknown = null;
let lastReading: ForegroundReading | undefined, previousTheme = '';
let ownedModalContext: any;
const bridge = { received: 0, rejected: 0, sent: 0, handshakes: 0, lastReceived: '', lastSent: '', error: '' };
type Transaction = { id: number; documentId: number; requested: RGB; timestamp: string;
  events: Record<string, unknown>[]; outcome?: ForegroundResult };
const transactions: Transaction[] = [];
const documentId = () => app.documents.length ? Number(app.activeDocument.id) : null;
function requestId(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }
async function batch(descriptor: any) {
  const result = (await action.batchPlay([descriptor], {}))[0];
  if (result?._obj === 'error' || result?._obj === 'Error') {
    const error = new Error(result.message || 'Photoshop command failed.');
    Object.assign(error, { descriptor: result });
    throw error;
  }
  return result;
}
// All callers share HostQueue. A foreground sample within a write reuses its
// acquired scope rather than trying to enter a nested executeAsModal call.
async function nativeModal(callback: (context: any) => Promise<void>) {
  if (ownedModalContext) return callback(ownedModalContext);
  await core.executeAsModal(async (context: any) => {
    ownedModalContext = context;
    try { await callback(context); } finally { ownedModalContext = undefined; }
  }, { commandName: 'Synchronize modCAM16 foreground', timeOut: 1 });
}
const readNative = () => batch({ _obj: 'get', _target: [
  { _property: 'foregroundColor' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] });
const sampler = new ForegroundSampler({ app, imaging, constants, batch, readNative, modal: nativeModal });
async function readDetailed(fresh = false): Promise<ForegroundReading> {
  try {
    const id = documentId(), descriptor = await readNative();
    lastReading = await readForeground(descriptor, (color, model) => core.convertColor(color, model), {
      rgbProperty: () => batch({ _obj: 'get', _target: [
        { _property: 'foregroundColorRGB' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }] }),
      sample: id === null ? undefined : () => sampler.sample(id, descriptor, fresh, lastDescriptor),
    });
    if (documentId() !== id) lastReading = { ...lastReading, foreground: null, error: 'Document changed during foreground reading.' };
  } catch (error) {
    lastReading = { foreground: null, descriptor: (error as any)?.descriptor ?? null,
      error: `Photoshop foreground read failed: ${String(error)}` };
  }
  return lastReading;
}
const writer = new ForegroundWriter({ documentId, read: () => readDetailed(true),
  write: (rgb: RGB) => { sampler.invalidate(); return batch(foregroundCommand(rgb)); },
  restore: (reading: ForegroundReading) => { sampler.invalidate(); return batch(nativeForegroundCommand(reading.descriptor)); },
  schedule: callback => queue.run(callback),
  // timeOut is in seconds, not milliseconds.
  modal: callback => nativeModal(callback),
});
function send(message: any) {
  if (!ready) return;
  try { webview.postMessage(message); bridge.sent++; bridge.lastSent = message.type; }
  catch (error) { bridge.error = String(error); }
}
function theme() {
  const body = getComputedStyle(document.body), probe = getComputedStyle(document.getElementById('theme-probe')!);
  return { background: body.backgroundColor, foreground: body.color,
    border: body.borderTopColor, secondary: probe.color, hoverBackground: probe.backgroundColor,
    scheme: ['light', 'lightest'].some(value => window.matchMedia(`(prefers-color-scheme: ${value})`).matches) ? 'light' : 'dark' };
}
function refreshTheme(force = false) {
  try {
    const colors = theme(), serialized = JSON.stringify(colors);
    if (force || serialized !== previousTheme) { previousTheme = serialized; send({ type: 'theme', colors }); }
  } catch { /* Missing theme APIs must not block foreground synchronization. */ }
}
// Called only within the shared queue, including diagnostics and explicit sync.
async function readContext(fresh = false) {
  const id = documentId();
  lastReading = undefined;
  if (id !== lastDocument) { writer.cancel(); sampler.invalidate(); lastDocument = id; }
  let state: Context = { documentId: id, foreground: null, view: 0, viewName: 'No document', fallback: true };
  if (id !== null) {
    // View discovery may fall back without hiding a readable foreground.
    try { lastDescriptor = await batch({ _obj: 'get', _target: [{ _ref: 'document', _id: id }] }); }
    catch (error) { lastDescriptor = { error: String(error), descriptor: (error as any)?.descriptor }; }
    const reading = await readDetailed(fresh);
    state = { documentId: id, foreground: reading.foreground, ...resolveView(lastDescriptor) };
    if (reading.error) state.error = reading.error;
  } else lastDescriptor = null;
  if (documentId() !== id) throw new Error('Document changed during synchronization. Click Sync foreground again.');
  return state;
}
async function refresh(force = false, id?: number, sourceCommitId?: number) {
  if (!ready || !visible) {
    if (id !== undefined) send({ type: 'host-error', kind: 'sync', id, message: 'The Photoshop panel is hidden. Reopen it and synchronize again.' });
    return;
  }
  if (!force && pollPending) return;
  if (!force) pollPending = true;
  const epoch = visibilityEpoch;
  try {
    await queue.run(async () => {
      if (!visible || epoch !== visibilityEpoch) {
        if (id !== undefined) throw new Error('The Photoshop panel was hidden during synchronization.');
        return;
      }
      sizer.sync(); refreshTheme(force);
      const state = await readContext(id !== undefined);
      if (!visible || epoch !== visibilityEpoch) {
        if (id !== undefined) throw new Error('The Photoshop panel was hidden during synchronization.');
        return;
      }
      const serialized = JSON.stringify(state);
      if (force || serialized !== previous) {
        previous = serialized;
        send({ type: 'context', context: state, requestId: id, forceImport: id !== undefined, sourceCommitId });
      }
    });
  } catch (error) { send({ type: 'host-error', kind: id === undefined ? 'context' : 'sync', id, message: String(error) }); }
  finally { if (!force) pollPending = false; }
}
async function commit(message: { id: number; documentId: number; scene: RGB }) {
  const transaction: Transaction = { id: message.id, documentId: message.documentId,
    requested: [...message.scene], timestamp: new Date().toISOString(), events: [] };
  transactions.push(transaction); if (transactions.length > 8) transactions.shift();
  let result: ForegroundResult;
  try {
    result = await writer.commit(message.documentId, message.scene, event => {
      const details: Record<string, unknown> = { ...event, timestamp: new Date().toISOString() };
      transaction.events.push(details);
    });
  } catch (error) {
    // Return a fresh actual color even on acquisition or command failure, so
    // the panel can discard its optimistic selection when a read is possible.
    const reading = await queue.run(async () => {
      if (documentId() !== message.documentId) return null;
      const value = await readDetailed(true);
      return documentId() === message.documentId ? value : null;
    });
    transaction.events.push({ phase: 'failure-readback', reading, timestamp: new Date().toISOString() });
    result = { applied: false, reason: 'failed', foreground: reading?.foreground ??
      (documentId() === message.documentId && error instanceof ForegroundFailure ? error.foreground : null), error: String(error) };
  }
  transaction.outcome = result;
  send({ type: 'committed', id: message.id, documentId: message.documentId, ...result });
  await refresh(true, undefined, message.id);
}
async function diagnostics(capabilities: unknown) {
  const captured = await queue.run(async () => {
    let state: Context | undefined, contextError: string | undefined;
    try { state = await readContext(true); } catch (error) { contextError = String(error); }
    // A failed color read must not prevent saving diagnostics.
    const reading = lastReading ?? await readDetailed(true);
    return { context: state, contextError, documentDescriptor: lastDescriptor,
      foregroundDescriptor: reading.descriptor, foregroundRGBProperty: reading.rgbProperty,
      foregroundConversion: reading.conversion, foregroundSource: reading.source,
      foregroundSample: reading.sample, foregroundError: reading.error,
      transactions: JSON.parse(JSON.stringify(transactions)) };
  });
  const file = await storage.localFileSystem.getFileForSaving('modcam16-host-diagnostics.json', { types: ['json'] });
  if (!file) return;
  await file.write(JSON.stringify({ schema: 4, timestamp: new Date().toISOString(), extension: EXTENSION,
    photoshop: host?.version ?? app.version, ...captured, bridge: { ...bridge, ready, visible },
    theme: previousTheme ? JSON.parse(previousTheme) : null, layout: sizer.layout(), capabilities,
    verification: 'Captured host data; visual HDR and painting checks still require the documented host procedure.' }, null, 2));
  send({ type: 'notice', message: 'Host diagnostics saved.' });
}
window.addEventListener('message', async (event: any) => {
  if (event.source !== webview) { bridge.rejected++; return; }
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  bridge.received++; bridge.lastReceived = message.type;
  try {
    if (message.type === 'ready') {
      const repeated = ready && readyId === message.id;
      ready = true; readyId = message.id; bridge.handshakes++;
      sizer.sync(true, 'ready');
      if (!repeated) void sizer.requestGrip('grip-ready');
      send({ type: 'connected', id: message.id, extension: EXTENSION });
      if (!repeated) await refresh(true);
    } else if (message.type === 'refresh') {
      if (requestId(message.id)) writer.cancel();
      await refresh(true, requestId(message.id) ? message.id : undefined);
    } else if (message.type === 'diagnostics') await diagnostics(message.capabilities);
    else if (message.type === 'commit' && requestId(message.id) && Number.isInteger(message.documentId) && finiteRGB(message.scene)) {
      if (!visible || !ready) throw new Error('The Photoshop panel is not ready. Click Sync foreground and try again.');
      await commit(message);
    }
  } catch (error) { send({ type: 'host-error', kind: message.type, id: message.id, message: String(error) }); }
});
const onNotification = () => {
  // Native commands inside our noninteractive modal scope are silenced by
  // Photoshop; also ignore them here in case a host delivers them late.
  if (ownedModalContext) return;
  sampler.invalidate(); void refresh();
};
function hidePanel() {
  visible = false; visibilityEpoch++; writer.cancel(); sizer.hide();
  if (timer) clearInterval(timer); timer = undefined;
  if (listening) { listening = false; action.removeNotificationListener(['set', 'select', 'open', 'close', 'exchange', 'reset'], onNotification); }
}
entrypoints.setup({ panels: { picker: {
  show(root: HTMLElement) { visible = true; sizer.show(root); timer ??= setInterval(() => void refresh(), 1000); void refresh(true);
    if (!listening) { listening = true; action.addNotificationListener(['set', 'select', 'open', 'close', 'exchange', 'reset'], onNotification); } },
  hide: hidePanel,
  destroy() { hidePanel(); sizer.destroy(); ready = false; readyId = undefined; },
} } });
