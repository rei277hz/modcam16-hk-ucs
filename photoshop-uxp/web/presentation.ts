export type ImageResult = { state: 'displayed' | 'discarded' | 'failed'; decodeMs: number; error?: string };
/** Decoding never gates color evaluation or commits. A stale decode cannot paint. */
export class PngPresenter {
  private displayed = new Map<string,string>();
  private pending = new Map<string, { cancel(): void }>();
  private closed = false;
  invalidate(key: string) { this.pending.get(key)?.cancel(); this.pending.delete(key); }
  async show(key: string, bytes: Uint8Array<ArrayBuffer>, current: () => boolean): Promise<ImageResult> {
    this.invalidate(key);
    if (this.closed) return { state: 'discarded', decodeMs: 0 };
    const started = performance.now(), image = new Image();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, abort!: () => void;
    const cancellation = new Promise<false>(resolve => { abort = () => { cancelled = true; resolve(false); }; });
    const entry = { cancel: abort }; this.pending.set(key, entry);
    let retained = false;
    try {
      const loaded = new Promise<void>((resolve,reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error('The WebView could not decode the generated PNG.'));
      });
      loaded.catch(() => {});
      image.src = url;
      const decoded = (typeof image.decode === 'function' ? image.decode() : loaded).then(() => true);
      const timeout = new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error('PNG decoding timed out.')), 5000); });
      const ready = await Promise.race([decoded, cancellation, timeout]);
      const decodeMs = performance.now() - started;
      const target = document.getElementById(key);
      if (!ready || cancelled || this.closed || !current() || !target) return { state: 'discarded', decodeMs };
      for (const attribute of [...target.attributes]) if (attribute.name !== 'src') image.setAttribute(attribute.name, attribute.value);
      image.onload = image.onerror = null; target.replaceWith(image);
      const old = this.displayed.get(key); this.displayed.set(key,url); retained = true;
      if (old) URL.revokeObjectURL(old);
      return { state: 'displayed', decodeMs };
    } catch (error) {
      return { state: cancelled || this.closed || !current() ? 'discarded' : 'failed', decodeMs: performance.now() - started, error: String(error) };
    } finally {
      clearTimeout(timer); image.onload = image.onerror = null;
      if (this.pending.get(key) === entry) this.pending.delete(key);
      if (!retained) { image.removeAttribute('src'); URL.revokeObjectURL(url); }
    }
  }
  remove(key: string) { this.invalidate(key); const url = this.displayed.get(key); if (url) URL.revokeObjectURL(url); this.displayed.delete(key); }
  destroy() { this.closed = true; for (const key of this.pending.keys()) this.invalidate(key); for (const key of this.displayed.keys()) this.remove(key); }
}
