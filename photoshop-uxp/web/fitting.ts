type Size = { width: number; height: number };

/** Fit logical controls into an allocation without setting a panel minimum.
 * Layout stays at its normal readable scale where possible; the whole UI can
 * scale down continuously when even the compact controls cannot fit. */
export class InterfaceFitter {
  private observer: ResizeObserver;
  private mutation: MutationObserver;
  private frame = 0;
  private active = true;
  private allocation: Size | null = null;
  private scale = 1;
  private logical: Size = { width: 0, height: 0 };
  private readonly resized = () => { this.checkAllocation(); this.schedule(); };
  constructor(private viewport: HTMLElement, private content: HTMLElement,
    private allocationChanged: () => void) {
    this.observer = new ResizeObserver(this.resized);
    this.observer.observe(viewport);
    this.observer.observe(content);
    this.mutation = new MutationObserver(() => this.schedule());
    this.mutation.observe(content, { subtree: true, childList: true, characterData: true });
    window.addEventListener('resize', this.resized);
    this.fit();
  }
  private checkAllocation() {
    const next = { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
    if (this.allocation && (next.width !== this.allocation.width || next.height !== this.allocation.height))
      this.allocationChanged();
    this.allocation = next;
  }
  private schedule() {
    if (this.active && !this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.fit(); });
  }
  fit() {
    if (!this.active) return;
    this.checkAllocation();
    const { width, height } = this.allocation!;
    if (width <= 0 || height <= 0) return;
    // This is a logical layout reference, not a native or displayed minimum.
    // Below it every element scales together, including labels and inputs.
    // Reserve one pixel for fractional rounding so readable layouts fit at
    // scale 1 rather than putting every HDR image in a transformed ancestor.
    const logicalWidth = Math.max(276, width - 1);
    this.content.style.width = `${logicalWidth}px`;
    const workspace = this.content.querySelector<HTMLElement>('.workspace')!;
    const picker = this.content.querySelector<HTMLElement>('.picker-row')!;
    const wheelColumn = this.content.querySelector<HTMLElement>('.wheel-column')!;
    const padColumn = this.content.querySelector<HTMLElement>('.pad-column')!;
    const pad = this.content.querySelector<HTMLElement>('#pad')!;
    // Measure the compact interface with a small positive logical pad. It is
    // scaled below this size if needed; no physical size floor is imposed.
    pad.style.width = pad.style.height = '32px';
    padColumn.style.width = '32px';
    this.content.style.setProperty('--wheel-height', '32px');
    const baseHeight = this.content.offsetHeight;
    const widthRoom = picker.clientWidth - wheelColumn.offsetWidth - Number.parseFloat(getComputedStyle(picker).columnGap);
    const fixedHeight = baseHeight - workspace.offsetHeight;
    const axisHeight = Math.max(padColumn.offsetHeight, wheelColumn.offsetHeight) - pad.offsetHeight;
    const side = Math.max(32, Math.floor(Math.min(widthRoom, height - fixedHeight - axisHeight - 1)));
    pad.style.width = pad.style.height = `${side}px`;
    padColumn.style.width = `${side}px`;
    this.content.style.setProperty('--wheel-height', `${side}px`);
    // Fractional layout rounds element metrics to integers. Include slack so
    // the full control bounds fit even after scaling, without a size floor.
    this.logical = { width: Math.max(logicalWidth, this.content.scrollWidth) + .5,
      height: Math.max(this.content.offsetHeight, this.content.scrollHeight) + .5 };
    this.scale = Math.min(1, width / this.logical.width, height / this.logical.height);
    this.content.style.transform = this.scale < 1 ? `scale(${this.scale})` : 'none';
    this.content.style.left = `${Math.max(0, (width - this.logical.width * this.scale) / 2)}px`;
    this.content.style.top = `${Math.max(0, (height - this.logical.height * this.scale) / 2)}px`;
  }
  snapshot() {
    this.fit();
    const pad = this.content.querySelector<HTMLElement>('#pad')!.getBoundingClientRect();
    const wheel = this.content.querySelector<HTMLElement>('#wheel')!.getBoundingClientRect();
    const main = this.content.querySelector<HTMLElement>('main')!;
    return { scale: this.scale, logicalSize: { ...this.logical },
      displayedSize: { width: this.logical.width * this.scale, height: this.logical.height * this.scale },
      pad: { width: pad.width, height: pad.height }, wheel: { width: wheel.width, height: wheel.height },
      page: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
      main: { width: main.clientWidth, height: main.clientHeight, scrollWidth: main.scrollWidth, scrollHeight: main.scrollHeight } };
  }
  destroy() {
    this.active = false;
    this.observer.disconnect(); this.mutation.disconnect();
    window.removeEventListener('resize', this.resized);
    cancelAnimationFrame(this.frame); this.frame = 0;
  }
}
