export type Dimensions = { width: number; height: number };

function dimensions(element: HTMLElement | null, rounded = true): Dimensions | null {
  if (!element) return null;
  const bounds = element.getBoundingClientRect();
  const width = rounded ? Math.floor(bounds.width) : bounds.width;
  const height = rounded ? Math.floor(bounds.height) : bounds.height;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

/** Keep the native WebView within the host allocation, independent of its content. */
export class PanelSizer {
  private root: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private active = false;
  private applied: Dimensions | null = null;
  private stripHeight = 0;
  private epoch = 0;
  private gripRequest = 0;
  private grip: { requestedVisible: boolean; status: string; error?: string } = { requestedVisible: true, status: 'unrequested' };
  private history: { timestamp: string; source: string; panel: Dimensions; webview: Dimensions; nativeStripHeight: number }[] = [];
  private readonly resized = () => this.sync(false, 'window-resize');
  private readonly rootResized = () => this.sync(false, 'root-resize');
  constructor(private readonly webview: HTMLElement,
    private readonly showGrip?: () => Promise<unknown>, private readonly configuration?: unknown) {}

  async requestGrip(source: string) {
    if (!this.active) return;
    const epoch = this.epoch, request = ++this.gripRequest;
    this.grip = { requestedVisible: true, status: this.showGrip ? 'requested' : 'unsupported' };
    if (!this.showGrip) return;
    try {
      await this.showGrip();
      if (this.active && epoch === this.epoch && request === this.gripRequest)
        this.grip = { requestedVisible: true, status: 'applied' };
    } catch (error) {
      if (this.active && epoch === this.epoch && request === this.gripRequest)
        this.grip = { requestedVisible: true, status: 'failed', error: String(error) };
    }
    if (this.active && epoch === this.epoch && request === this.gripRequest) this.sync(false, source);
  }

  show(root: HTMLElement) {
    if (root !== this.root) { this.hide(); this.root = root; }
    if (!this.active) {
      this.active = true;
      this.epoch++;
      if (typeof ResizeObserver === 'function') {
        this.observer = new ResizeObserver(() => this.sync(false, 'observer'));
        this.observer.observe(root);
      }
      root.addEventListener?.('resize', this.rootResized);
      window.addEventListener('resize', this.resized);
      this.sync(true, 'show');
      void this.requestGrip('grip-show');
    } else this.sync();
  }

  sync(force = false, source = 'poll') {
    if (!this.active) return;
    const panel = dimensions(this.root);
    if (!panel) return;
    // The WebView is a separate native surface. Leave Photoshop's grip area
    // uncovered; very small allocations still leave space for the whole UI.
    const strip = Math.min(20, panel.height / 4);
    const size = { width: panel.width, height: panel.height - strip };
    if (!force && size.width === this.applied?.width && size.height === this.applied?.height) return;
    // Set both the native element attributes and its CSS bounds. Percentage
    // CSS alone can leave UXP's embedded browser at its initial dimensions.
    const width = `${size.width}px`, height = `${size.height}px`;
    this.webview.setAttribute('width', width);
    this.webview.setAttribute('height', height);
    this.webview.style.width = width;
    this.webview.style.height = height;
    this.applied = size;
    this.stripHeight = strip;
    this.history.push({ timestamp: new Date().toISOString(), source, panel, webview: { ...size }, nativeStripHeight: strip });
    if (this.history.length > 8) this.history.shift();
  }

  hide() {
    if (!this.active) return;
    this.active = false;
    this.epoch++;
    this.observer?.disconnect();
    this.observer = null;
    this.root?.removeEventListener?.('resize', this.rootResized);
    window.removeEventListener('resize', this.resized);
  }

  destroy() { this.hide(); this.root = null; this.applied = null; }

  layout() {
    return { panel: dimensions(this.root), webview: dimensions(this.webview, false),
      appliedWebview: this.applied ? { ...this.applied } : null,
      resizeGrip: { ...this.grip, nativeStripHeight: this.stripHeight }, configuration: this.configuration,
      recentResizes: this.history.map(value => ({ ...value, panel: { ...value.panel }, webview: { ...value.webview } })) };
  }
}
