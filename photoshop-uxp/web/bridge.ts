const REPLY_TIMEOUT = 5000, RETRY_INTERVAL = 250;

// UXP may inject its WebView API after the page starts. Never capture a
// permanently undefined reference or silently discard a user action.
export class HostBridge {
  connected = false;
  extension: { id: string; version: string } | null = null;
  private readyId: number | null = null;
  private deadline = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observations = { sent: 0, received: 0, attempts: 0, lastSent: '', lastReceived: '', error: '' };
  constructor(private allocate: () => number, private onConnect: () => void,
    private onError: (message: string) => void) {}
  private api() { return (window as any).uxpHost; }
  send(message: any) {
    const api = this.api();
    if (typeof api?.postMessage !== 'function') {
      this.observations.error = 'UXP WebView bridge is unavailable'; this.connected = false; return false;
    }
    try {
      api.postMessage(message);
      this.observations.sent++; this.observations.lastSent = message.type;
      return true;
    } catch (error) { this.observations.error = String(error); this.connected = false; return false; }
  }
  connect() {
    if (this.connected || this.readyId !== null) return;
    const id = this.readyId = this.allocate();
    this.deadline = Date.now() + REPLY_TIMEOUT;
    const attempt = () => {
      if (this.readyId !== id) return;
      this.observations.attempts++;
      this.send({ type: 'ready', id });
      if (this.readyId !== id) return;
      if (Date.now() >= this.deadline) {
        this.readyId = null; this.timer = undefined;
        this.onError('Could not connect to Photoshop. Click Sync foreground to try again.');
      } else this.timer = setTimeout(attempt, RETRY_INTERVAL);
    };
    attempt();
  }
  receive(message: any) {
    this.observations.received++; this.observations.lastReceived = message.type;
    if (message.type === 'connected' && message.id === this.readyId && this.readyId !== null) {
      if (typeof message.extension?.id === 'string' && typeof message.extension?.version === 'string') this.extension = message.extension;
      this.confirm(); return true;
    }
    return false;
  }
  // A valid context also proves connectivity with older host bridges.
  confirm() {
    const wasConnected = this.connected;
    this.connected = true; this.readyId = null;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    this.observations.error = '';
    if (!wasConnected) this.onConnect();
  }
  snapshot() { return { ...this.observations, connected: this.connected,
    available: typeof this.api()?.postMessage === 'function', readyId: this.readyId, extension: this.extension }; }
  destroy() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.readyId = null; }
}

export const HOST_REPLY_TIMEOUT = REPLY_TIMEOUT;
