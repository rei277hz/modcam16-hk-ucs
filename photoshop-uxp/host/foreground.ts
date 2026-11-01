import { ForegroundSample, RGB, finiteRGB, isACEScgProfile, nativeColor, validForegroundSample } from './protocol';

// A stable fingerprint of native descriptor values; aliases do not change
// identity. No RGB scaling, transfer curve, or magnitude heuristic is used.
export function foregroundSignature(descriptor: unknown): string {
  function ordered(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(ordered);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key === 'grain' ? 'green' : key] = ordered(value[key]);
    return result;
  }
  return JSON.stringify(ordered(nativeColor(descriptor)));
}

export class ForegroundSampler {
  private cached?: { key: string; sample: ForegroundSample };
  constructor(private host: { app: any; imaging: any; constants: any;
    batch(command: any): Promise<any>; readNative(): Promise<unknown>;
    modal(callback: (context: any) => Promise<void>): Promise<void> }) {}
  invalidate() { this.cached = undefined; }
  private documentId(): number | null {
    return this.host.app.documents.length ? Number(this.host.app.activeDocument.id) : null;
  }
  private exists(id: number): boolean {
    return Array.from(this.host.app.documents as ArrayLike<any>).some(doc => Number(doc.id) === id);
  }
  async sample(documentId: number, descriptor: unknown, fresh: boolean, documentDescriptor: any): Promise<ForegroundSample> {
    const signature = foregroundSignature(descriptor);
    const key = JSON.stringify([documentId, signature, documentDescriptor?.depth, documentDescriptor?.profile]);
    if (!fresh && this.cached?.key === key && this.documentId() === documentId)
      return { ...JSON.parse(JSON.stringify(this.cached.sample)), cached: true };
    const sample: ForegroundSample = { documentId, foreground: null, cached: false, stages: [], timings: {},
      cleanup: { closed: true, sourceRestored: false, autoCloseRegistered: false, imageDataDisposed: true } };
    const clock = () => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const started = clock(); let previousStage = started;
    const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      const start = clock();
      try { return await operation(); } finally { sample.timings![name] = (sample.timings![name] ?? 0) + clock()-start; }
    };
    let temporary: any;
    const stage = (phase: string, result?: unknown, error?: unknown) => {
      if (error !== undefined && result === undefined) result = (error as any)?.descriptor ??
        ((error as any)?.number === undefined ? undefined : { number: (error as any).number });
      const stamp = clock();
      sample.stages.push({ phase, elapsedMs:stamp-started,sincePreviousMs:stamp-previousStage, ...(result === undefined ? {} : { result }), ...(error === undefined ? {} : { error: String(error) }) });
      previousStage = stamp;
    };
    try {
      await this.host.modal(async context => {
        let imageData: any;
        const source = this.host.app.activeDocument;
        const assertSource = () => {
          if (this.documentId() !== documentId) throw new Error('Document changed during foreground sampling.');
        };
        const assertTemporary = () => {
          if (!temporary || Number(temporary.id) === documentId || this.documentId() !== Number(temporary.id))
            throw new Error('Temporary foreground document is not active; no fill was attempted.');
          if (context.isCancelled) throw new Error('Foreground sampling was cancelled.');
        };
        try {
          assertSource();
          if (context.isCancelled) throw new Error('Foreground sampling was cancelled.');
          const sourceDescriptor = await this.host.batch({ _obj: 'get', _target: [{ _ref: 'document', _id: documentId }] });
          sample.sourceDepth = sourceDescriptor.depth; sample.sourceProfile = sourceDescriptor.profile;
          stage('source-checked', { documentId, depth: sample.sourceDepth, profile: sample.sourceProfile });
          if (sample.sourceDepth !== 32 || !isACEScgProfile(sample.sourceProfile))
            throw new Error('Foreground sampling requires a 32-bit ACEScg document.');
          const before = await this.host.readNative();
          assertSource();
          if (foregroundSignature(before) !== signature) throw new Error('Foreground changed before native sampling; synchronize again.');
          // The duplicate carries the source's native color-management state.
          // Never create a new document using an assumed working RGB profile.
          temporary = await timed('duplicateMs', () => source.duplicate('modCAM16 foreground probe', true));
          sample.cleanup.closed = false;
          if (Number(temporary.id) === documentId) throw new Error('Photoshop returned the source document instead of a duplicate.');
          await context.hostControl.registerAutoCloseDocument(Number(temporary.id));
          sample.cleanup.autoCloseRegistered = true;
          assertTemporary();
          stage('duplicate-created', { documentId: Number(temporary.id) });
          const copy = await this.host.batch({ _obj: 'get', _target: [{ _ref: 'document', _id: Number(temporary.id) }] });
          if (copy.depth !== 32 || !isACEScgProfile(copy.profile)) throw new Error('Temporary duplicate did not preserve 32-bit ACEScg.');
          assertTemporary(); await temporary.selection.deselect();
          assertTemporary(); await timed('cropMs', () => temporary.crop({ left: 0, top: 0, right: 1, bottom: 1 }));
          assertTemporary();
          const layer = await temporary.createPixelLayer({ name: 'Foreground sample', opacity: 100 });
          assertTemporary(); temporary.activeLayers = [layer];
          // An alpha channel selected in the original must not redirect Fill.
          await this.host.batch({ _obj: 'select', _target: [{ _ref: 'channel', _enum: 'channel', _value: 'RGB' }],
            _options: { dialogOptions: 'silent' } });
          assertTemporary();
          // Fill does not reliably accept an explicit target. Require the
          // owned duplicate to be active immediately before this command.
          await timed('fillMs', () => this.host.batch({ _obj: 'fill', using: { _enum: 'fillContents', _value: 'foregroundColor' },
            opacity: { _unit: 'percentUnit', _value: 100 }, mode: { _enum: 'blendMode', _value: 'normal' },
            preserveTransparency: false,
            _options: { dialogOptions: 'silent' } }));
          stage('foreground-filled');
          assertTemporary();
          const pixels = await timed<any>('getPixelsMs', () => this.host.imaging.getPixels({ documentID: Number(temporary.id), layerID: Number(layer.id),
            sourceBounds: { left: 0, top: 0, right: 1, bottom: 1 }, colorSpace: 'RGB', componentSize: 32, applyAlpha: false }));
          imageData = pixels.imageData; sample.cleanup.imageDataDisposed = false;
          for (const property of ['componentSize', 'components', 'colorSpace', 'colorProfile', 'width', 'height'] as const)
            (sample as any)[property] = imageData[property];
          const data = await timed<any>('getDataMs', () => imageData.getData({ chunky: true }));
          const rgb: RGB = [data[0], data[1], data[2]];
          if (sample.components === 4) sample.alpha = data[3];
          if (Object.prototype.toString.call(data) !== '[object Float32Array]' || !finiteRGB(rgb) ||
              data.length !== sample.components || ![3, 4].includes(sample.components ?? 0) ||
              (sample.components === 4 && (!Number.isFinite(sample.alpha) || Math.abs(sample.alpha! - 1) > 2e-6)))
            throw new Error('Native foreground sample is not an opaque 32-bit RGB pixel.');
          sample.foreground = rgb;
          stage('pixels-read', { foreground: rgb, componentSize: sample.componentSize, colorProfile: sample.colorProfile });
          if (sample.componentSize !== 32 || sample.colorSpace !== 'RGB' || !isACEScgProfile(sample.colorProfile) || sample.width !== 1 || sample.height !== 1)
            throw new Error('Native foreground sample did not expose a 1×1 floating-point ACEScg pixel.');
        } catch (error) { sample.error = String(error); stage('probe-failed', undefined, error); }
        finally {
          if (imageData) {
            try { imageData.dispose(); sample.cleanup.imageDataDisposed = true; }
            catch (error) { sample.error = `Could not dispose native sample: ${String(error)}`; stage('dispose-failed', undefined, error); }
          }
          // A third document becoming active is an external switch. Cleanup
          // the duplicate, but never steal that document's focus.
          const active = this.documentId();
          const mayRestore = active === null || active === documentId || active === Number(temporary?.id);
          const external = mayRestore ? undefined : Array.from(this.host.app.documents as ArrayLike<any>)
            .find(doc => Number(doc.id) === active);
          if (temporary && Number(temporary.id) !== documentId) {
            try {
              await timed('closeMs', () => temporary.close(this.host.constants.SaveOptions.DONOTSAVECHANGES));
              sample.cleanup.closed = true;
              if (sample.cleanup.autoCloseRegistered) await context.hostControl.unregisterAutoCloseDocument(Number(temporary.id));
              stage('duplicate-closed');
            } catch (error) { sample.error = `Temporary document cleanup failed: ${String(error)}`; stage('close-failed', undefined, error); }
          }
          try {
            // Closing an inactive copy may itself activate its owner. Keep
            // the external document's focus unless a new third document won.
            const afterClose = this.documentId();
            if (external && this.exists(Number(external.id)) &&
                (afterClose === null || afterClose === documentId || afterClose === Number(temporary?.id))) {
              this.host.app.activeDocument = external;
              stage('external-focus-restored', { documentId: Number(external.id) });
            }
            if (mayRestore && this.exists(documentId) && this.documentId() !== documentId) this.host.app.activeDocument = source;
            sample.cleanup.sourceRestored = this.documentId() === documentId;
            if (!sample.cleanup.sourceRestored) throw new Error('Source document could not be restored after sampling.');
            if (foregroundSignature(await this.host.readNative()) !== signature) throw new Error('Foreground changed during native sampling; synchronize again.');
            stage('source-restored');
          } catch (error) { sample.error = String(error); stage('source-restore-failed', undefined, error); }
        }
      });
    } catch (error) { sample.error = String(error); stage('modal-failed', undefined, error); }
    // The host auto-closes registered documents when a cancelled scope exits,
    // even when cancellation prevented the explicit close in finally.
    if (temporary && !this.exists(Number(temporary.id)) && !sample.cleanup.closed) {
      sample.cleanup.closed = true; stage('duplicate-auto-closed');
    }
    sample.cleanup.sourceRestored = this.documentId() === documentId;
    if (!validForegroundSample(sample)) {
      sample.foreground = null;
      sample.error ??= 'Native foreground sampling or temporary-document cleanup could not be verified.';
      this.invalidate();
    }
    sample.timings!.totalMs = clock()-started;
    if (!sample.error && sample.foreground) this.cached = { key, sample: JSON.parse(JSON.stringify(sample)) };
    return sample;
  }
}
