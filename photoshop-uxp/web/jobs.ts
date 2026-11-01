import type { RGB, View } from '../host/protocol';
export type Timings = Record<string, number | string | null>;
export type Backend = 'WebGPU' | 'WebGL2' | 'WASM';
export type DeviceInfo = { api: Backend; vendor: string; renderer: string; architecture?: string; device?: string; fallback?: boolean | null; software: true | null };
export type Stamp = { id: number; epoch: number; view: View; queuedAt?: number; sentAt?: number };
export type SelectionRequest = Stamp & { type: 'selection'; code: number[]; full: boolean; scene: RGB | null };
export type CheckerRequest = Stamp & { type: 'checker' };
export type PreviewRequest = Stamp & { type: 'preview'; display: RGB; background: RGB; valid: boolean };
export type Patch = { code: number[]; display: RGB };
export type CheckerPngRequest = Stamp & { type: 'checker-png'; patches: Patch[] };
export type RenderRequest = Stamp & { type: 'render'; code: number[]; full: boolean; interacting: boolean; key: string };
export type Job = SelectionRequest | CheckerRequest | PreviewRequest | CheckerPngRequest | RenderRequest;
export type SelectionResult = Stamp & { type: 'selection'; code: number[]; scene: RGB; valid: boolean; external: boolean; display: RGB; background: RGB; timings: Timings };
export type RenderResult = RenderRequest & { png: Uint8Array<ArrayBuffer>; renderer: Backend; size: number; failures: string[]; device: DeviceInfo; timings: Timings };
export type Reply = SelectionResult | RenderResult |
  (Stamp & { type: 'checker-colors'; patches: Patch[]; timings: Timings }) |
  (Stamp & { type: 'preview'; png: Uint8Array<ArrayBuffer>; timings: Timings }) |
  (Stamp & { type: 'checker'; patches: { code: number[]; png: Uint8Array<ArrayBuffer> }[]; timings: Timings }) |
  { type: 'error'; id: number; message: string } | { type: 'gpu-timing'; id: number; timings: Timings };
export const now = () => performance.timeOrigin + performance.now();
export function arrival(job: Stamp): Timings {
  return { queueMs: Math.max(0, (job.sentAt ?? now()) - (job.queuedAt ?? now())), transportMs: Math.max(0, now() - (job.sentAt ?? now())) };
}
export function reply(message: Reply, transfer: Transferable[] = []) { globalThis.postMessage(message, { transfer }); }
export function deviceInfo(api: Backend, vendor = '', renderer = '', architecture = '', fallback: boolean | null = null, device = ''): DeviceInfo {
  return { api, vendor, renderer, architecture, device, fallback, software: /swiftshader|llvmpipe|lavapipe|software rasterizer|microsoft basic render/i.test([vendor, renderer, architecture].join(' ')) ? true : null };
}

/** Backpressure lives on the sender: a blocked worker cannot coalesce its inbox. */
export class LatestWorker {
  private worker?: Worker;
  private active?: Job;
  private pending = new Map<Job['type'], Job>();
  private closed = false;
  readonly counts = { submitted: 0, sent: 0, completed: 0, replaced: 0, failed: 0, maxPending: 0 };
  constructor(private source: string, private name: string, private priority: Job['type'][], private receive: (message: Reply) => void, private failure: (message: string) => void) {}
  submit(job: Job) {
    if (this.closed) return;
    this.counts.submitted++;
    if (this.pending.has(job.type)) this.counts.replaced++;
    this.pending.set(job.type, { ...structuredClone(job), queuedAt: now() });
    this.counts.maxPending = Math.max(this.counts.maxPending, this.pending.size);
    this.pump();
  }
  private pump() {
    if (this.closed || this.active || !this.pending.size) return;
    const kind = this.priority.find(type => this.pending.has(type))!;
    this.active = this.pending.get(kind)!; this.pending.delete(kind);
    try {
      if (!this.worker) {
        const url = URL.createObjectURL(new Blob([this.source], { type: 'text/javascript' }));
        let worker: Worker;
        try { worker = new Worker(url, { name: this.name }); } finally { URL.revokeObjectURL(url); }
        this.worker = worker;
        worker.onmessage = event => {
          if (this.worker !== worker || this.closed) return;
          const message = event.data as Reply;
          if (message.type === 'gpu-timing') { this.receive(message); return; }
          if (message.id !== this.active?.id) return;
          this.active = undefined; this.counts.completed++;
          if (message.type === 'error') this.counts.failed++;
          try { this.receive(message); } finally { this.pump(); }
        };
        worker.onerror = event => { if (this.worker === worker) this.fail(event.message); };
        worker.onmessageerror = () => { if (this.worker === worker) this.fail('Worker reply could not be decoded.'); };
      }
      this.counts.sent++;
      this.worker.postMessage({ ...this.active, sentAt: now() });
    } catch (error) { this.fail(String(error)); }
  }
  private fail(message: string) {
    this.counts.failed++; this.active = undefined; this.cancelPending();
    this.worker?.terminate(); this.worker = undefined; this.failure(`${this.name}: ${message}`);
  }
  cancelPending() { this.counts.replaced += this.pending.size; this.pending.clear(); }
  snapshot() { return { ...this.counts, active: this.active?.id ?? null, pending: [...this.pending.values()].map(job => job.id) }; }
  destroy() { this.closed = true; this.cancelPending(); this.active = undefined; this.worker?.terminate(); this.worker = undefined; }
}
