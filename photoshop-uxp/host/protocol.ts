export type RGB = [number, number, number];
export type View = 0 | 1 | 2 | 4;
export const VIEWS: Record<View, string> = {
  0: 'ACES 2.0 - HDR 1000 nits (Rec.2020)',
  1: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  2: 'ACES 2.0 - HDR 1000 nits (P3 D65)',
  4: 'ACES 2.0 - SDR 100 nits (P3 D65)',
};
export type Context = { documentId: number | null; view: View; viewName: string;
  fallback: boolean; foreground: RGB | null; error?: string };
export const finiteRGB = (v: unknown): v is RGB => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export const sameRGB = (a: RGB | null, b: RGB | null, epsilon = 2e-6) =>
  a === null && b === null || !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= epsilon * Math.max(1, Math.abs(v), Math.abs(b[i])));

// Only inspect scalar values explicitly identified as the current OCIO view.
// A list of available views, or a look with a similar name, is not current state.
export function resolveView(descriptor: unknown): { view: View; viewName: string; fallback: boolean } {
  let current: string | undefined;
  function visit(value: any, path: string[], depth: number) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8) return;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const next = [...path, normalized];
      const ocio = next.some(p => p.includes('ocio') || p.includes('opencolorio'));
      if (ocio && /^(?:ocio|opencolorio)?(?:current|selected|display)?view(?:name)?$/.test(normalized)
          && typeof child === 'string') current = child;
      else visit(child, next, depth + 1);
    }
  }
  visit(descriptor, [], 0);
  const normalize = (s: string) => s.trim().toLowerCase().replace(/p3-d65/g, 'p3 d65').replace(/\s+/g, ' ');
  const entry = Object.entries(VIEWS).find(([, name]) => current && normalize(name) === normalize(current));
  return { view: entry ? Number(entry[0]) as View : 0, viewName: current ?? 'View unavailable', fallback: !entry };
}

export function nativeColor(descriptor: any): any {
  return descriptor?.foregroundColor ?? descriptor?.foregroundColorRGB ?? descriptor?.RGBFloatColor ?? descriptor;
}
export type ColorReading = { kind: 'float' | 'ordinary' | 'other' | 'invalid'; rgb?: RGB };
export function classifyColor(descriptor: unknown): ColorReading {
  const c = nativeColor(descriptor);
  if (!c || typeof c !== 'object') return { kind: 'invalid' };
  if (['redFloat', 'greenFloat', 'blueFloat'].some(key => key in c)) {
    const rgb = [c.redFloat, c.greenFloat, c.blueFloat];
    return finiteRGB(rgb) ? { kind: 'float', rgb } : { kind: 'invalid' };
  }
  if (['red', 'green', 'grain', 'blue'].some(key => key in c)) {
    // "grain" is Photoshop's legacy green-channel alias, not a float field.
    if ('green' in c && 'grain' in c && c.green !== c.grain) return { kind: 'invalid' };
    const rgb = [c.red, c.green ?? c.grain, c.blue];
    return finiteRGB(rgb) ? { kind: 'ordinary', rgb } : { kind: 'invalid' };
  }
  return { kind: 'other' };
}
export function floatColor(descriptor: unknown): RGB | null {
  const color = classifyColor(descriptor);
  // Ordinary RGB units are not evidence of scene-linear ACEScg values.
  return color.kind === 'float' ? color.rgb! : null;
}

export function nativeForegroundCommand(descriptor: unknown) {
  const color = nativeColor(descriptor);
  if (!color || typeof color !== 'object' || (!color._obj && !floatColor(color)))
    throw new Error('Photoshop did not expose a restorable native foreground descriptor.');
  return { _obj: 'set', _target: [{ _ref: 'color', _property: 'foregroundColor' }],
    to: color._obj ? color : { _obj: 'RGBColor', ...color }, _options: { dialogOptions: 'silent' } };
}

export function foregroundCommand(rgb: RGB) {
  if (!finiteRGB(rgb)) throw new Error('Foreground color must contain three finite numbers.');
  return { _obj: 'set', _target: [{ _ref: 'color', _property: 'foregroundColor' }],
    to: { _obj: 'RGBColor', redFloat: rgb[0], greenFloat: rgb[1], blueFloat: rgb[2] },
    _options: { dialogOptions: 'silent' } };
}

// ColorConversionModel.RGB in Photoshop's colorTypes contract. This internal
// enum is not exported by photoshop.constants. The return type permits both
// ordinary RGB and explicit floats; model 15 does not guarantee float output.
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/a80f5fb4006291e76ec2fb481461b4b579fc3055/types/photoshop/util/colorTypes.d.ts
export const RGB_CONVERSION_MODEL = 15;
export type ForegroundSample = { documentId: number; foreground: RGB | null;
  sourceDepth?: number; sourceProfile?: string; componentSize?: number; components?: number;
  colorSpace?: string; colorProfile?: string; width?: number; height?: number; alpha?: number; cached?: boolean;
  cleanup: { closed: boolean; sourceRestored: boolean; autoCloseRegistered: boolean; imageDataDisposed: boolean };
  stages: { phase: string; elapsedMs?: number; sincePreviousMs?: number; result?: unknown; error?: string }[]; timings?: Record<string, number>; error?: string };
export type ForegroundReading = { foreground: RGB | null; descriptor: unknown;
  source?: 'native-float' | 'rgb-property' | 'native-conversion' | 'paint-sample';
  rgbProperty?: { descriptor?: unknown; error?: string };
  conversion?: { targetModel: number; descriptor?: unknown; error?: string };
  sample?: ForegroundSample; error?: string };

export async function readForeground(descriptor: any,
  convert: (color: any, targetModel: number) => unknown | Promise<unknown>,
  fallback: { rgbProperty?(): Promise<unknown>; sample?(): Promise<ForegroundSample> } = {}): Promise<ForegroundReading> {
  const direct = floatColor(descriptor);
  if (direct) return { foreground: direct, descriptor, source: 'native-float' };
  const reading: ForegroundReading = { foreground: null, descriptor };
  if (fallback.rgbProperty) {
    const property: NonNullable<ForegroundReading['rgbProperty']> = {};
    reading.rgbProperty = property;
    try {
      property.descriptor = await fallback.rgbProperty();
      const foreground = floatColor(property.descriptor);
      if (foreground) return { ...reading, foreground, source: 'rgb-property' };
    } catch (error) {
      property.error = String(error);
      property.descriptor = (error as any)?.descriptor ??
        ((error as any)?.number === undefined ? undefined : { number: (error as any).number });
    }
  }
  // Keep the actual native conversion result as evidence. Its ordinary RGB
  // output must not be normalized or gamma-decoded with a guessed profile.
  const conversion: NonNullable<ForegroundReading['conversion']> = reading.conversion = { targetModel: RGB_CONVERSION_MODEL };
  try {
    conversion.descriptor = await convert(nativeColor(descriptor), RGB_CONVERSION_MODEL);
    const foreground = floatColor(conversion.descriptor);
    if (foreground) return { ...reading, foreground, source: 'native-conversion' };
  } catch (error) {
    conversion.error = String(error);
    conversion.descriptor = (error as any)?.descriptor ??
      ((error as any)?.number === undefined ? undefined : { number: (error as any).number });
  }
  if (fallback.sample) {
    try {
      reading.sample = await fallback.sample();
      const sample = reading.sample;
      if (validForegroundSample(sample)) return { ...reading, foreground: sample.foreground, source: 'paint-sample' };
    } catch (error) { reading.error = String(error); }
  }
  reading.error = `Photoshop could not read the ${nativeColor(descriptor)?._obj ?? 'unknown'} foreground as floating-point ACEScg. ${reading.sample?.error ?? reading.error ?? 'Capture host diagnostics.'}`;
  return reading;
}

export const isACEScgProfile = (value: unknown): value is string => typeof value === 'string' &&
  /^ACEScg(?:\s*\(Linear(?: RGB)? Profile\))?$/i.test(value.trim());
export function validForegroundSample(sample: ForegroundSample): boolean {
  return !!sample && finiteRGB(sample.foreground) && sample.sourceDepth === 32 && isACEScgProfile(sample.sourceProfile) &&
    sample.componentSize === 32 && sample.colorSpace === 'RGB' && isACEScgProfile(sample.colorProfile) &&
    [3, 4].includes(sample.components ?? 0) && sample.width === 1 && sample.height === 1 && !sample.error &&
    (sample.components === 3 || Number.isFinite(sample.alpha) && Math.abs(sample.alpha! - 1) <= 2e-6) &&
    !!sample.cleanup?.closed && !!sample.cleanup.sourceRestored && !!sample.cleanup.autoCloseRegistered && !!sample.cleanup.imageDataDisposed;
}

export type ForegroundResult = { applied: boolean; foreground: RGB | null; reason?: string; error?: string };
export type ForegroundEvent = { phase: string; foreground?: RGB | null; result?: unknown; error?: string;
  command?: unknown; reading?: ForegroundReading };
export class ForegroundFailure extends Error {
  constructor(message: string, readonly foreground: RGB | null = null, cause?: unknown) {
    super(message, { cause });
    for (const key of ['descriptor', 'number']) if ((cause as any)?.[key] !== undefined)
      Object.assign(this, { [key]: (cause as any)[key] });
  }
}

// Share a queue between foreground transactions and context reads so polling
// cannot publish intermediate writes and explicit sync waits for active writes.
export class HostQueue {
  private tail = Promise.resolve();
  run<T>(callback: () => Promise<T>): Promise<T> {
    const result = this.tail.then(callback);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class ForegroundWriter {
  private queue = new HostQueue();
  private latest = 0;
  constructor(private host: { documentId(): number | null; read(): Promise<ForegroundReading>;
    write(rgb: RGB): Promise<unknown>; restore(reading: ForegroundReading): Promise<unknown>;
    modal(callback: () => Promise<void>): Promise<unknown>;
    schedule?<T>(callback: () => Promise<T>): Promise<T> }) {}
  cancel() { this.latest++; }
  commit(documentId: number, rgb: RGB, observe: (event: ForegroundEvent) => void = () => {}): Promise<ForegroundResult> {
    if (!finiteRGB(rgb)) return Promise.reject(new Error('Invalid ACEScg color.'));
    const serial = ++this.latest;
    const current = () => serial === this.latest && documentId === this.host.documentId();
    const schedule = this.host.schedule?.bind(this.host) ?? this.queue.run.bind(this.queue);
    observe({ phase: 'queued', foreground: [...rgb] });
    return schedule(async () => {
      let result: ForegroundResult = { applied: false, foreground: null, reason: 'cancelled' };
      if (!current()) { observe({ phase: 'cancelled' }); return result; }
      try {
        // executeAsModal is documented as Promise<void>. Capture the result
        // here rather than depending on the modal callback's return value.
        await this.host.modal(async () => {
          observe({ phase: 'modal-entered' });
          if (!current()) return;
          const previous = await this.host.read();
          observe({ phase: 'previous', foreground: previous.foreground, reading: previous });
          if (!previous.foreground || previous.error) throw new ForegroundFailure('Photoshop did not expose a floating-point foreground color.');
          // Establish a lossless native backup before attempting any mutation.
          const restoreCommand = nativeForegroundCommand(previous.descriptor);
          if (!current()) { result.foreground = documentId === this.host.documentId() ? previous.foreground : null; return; }
          try {
            observe({ phase: 'write-requested', foreground: [...rgb], command: foregroundCommand(rgb) });
            observe({ phase: 'write-result', result: await this.host.write(rgb) });
            const actual = await this.host.read();
            observe({ phase: 'readback', foreground: actual.foreground, reading: actual });
            if (documentId !== this.host.documentId()) throw new ForegroundFailure('Document changed during the foreground transaction.');
            if (actual.error || !sameRGB(actual.foreground, rgb)) throw new ForegroundFailure('Photoshop did not preserve the requested ACEScg floats.');
            result = { applied: true, foreground: actual.foreground };
          } catch (error) {
            if (documentId !== this.host.documentId()) throw new ForegroundFailure('Document changed during the foreground transaction; restoration was not attempted in another document.', null, error);
            // A rejected command may have changed the native color before
            // throwing. Restore on every uncertain outcome after an attempt.
            observe({ phase: 'restore-requested', foreground: previous.foreground, command: restoreCommand });
            let restored: ForegroundReading | undefined;
            try {
              observe({ phase: 'restore-result', result: await this.host.restore(previous) });
              restored = await this.host.read();
              observe({ phase: 'restored', foreground: restored.foreground, reading: restored });
              if (documentId !== this.host.documentId() || restored.error || !sameRGB(restored.foreground, previous.foreground))
                throw new Error('Restoration readback did not match the previous foreground.');
            } catch (restoreError) {
              observe({ phase: 'restore-failed', error: String(restoreError) });
              throw new ForegroundFailure(`${String(error)} Foreground write and restoration could not be verified. ${String(restoreError)} Resynchronize with Photoshop.`, restored?.foreground ?? null, error);
            }
            throw new ForegroundFailure(`${String(error)} The previous foreground was restored.`, restored.foreground, error);
          }
        });
        observe({ phase: result.applied ? 'applied' : 'cancelled', foreground: result.foreground });
        return result;
      } catch (error) { observe({ phase: 'failed', error: String(error), result: (error as any)?.descriptor ??
        ((error as any)?.number === undefined ? undefined : { number: (error as any).number }) }); throw error; }
    });
  }
}
