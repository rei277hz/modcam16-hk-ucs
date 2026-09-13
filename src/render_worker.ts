// Each worker owns an independent WASM instance. Evaluation has its own worker.
import init, {
  picker_colorchecker, picker_evaluate, picker_from_encoded, picker_render_linear_rows,
  picker_gpu_parameters,
} from "./wasm/pkg/modcam16_color_core.js";
import { encodeLinearRgbaPng, encodePreview, type ViewId } from "./preview_png";
import { SliceWebGpuRenderer } from "./slice_webgpu";

type RenderMessage = {
  kind: "render"; id: number; profile: ViewId; j: number;
  width: number; height: number;
};
type EvaluateMessage = {
  kind: "evaluate"; id: number; profile: ViewId; j: number;
  fittedRadiusX: number; fittedRadiusY: number; backgroundJ: number;
};
type Message = RenderMessage | EvaluateMessage
  | { kind: "colorchecker"; id: number; profile: number }
  | { kind: "set"; id: number; profile: number; red: number; green: number; blue: number }
  | { kind: "cancel-render"; id: number };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
const ready = init();
const latest = new Map<string, number>();
let pendingEvaluation: EvaluateMessage | undefined;
let evaluationQueued = false;
const gpuSlice = new SliceWebGpuRenderer();
const FULL_SLICE = 512;
let gpuParameters: Float32Array | undefined;
let cachedSlice: { key: string; pixels: Float32Array; renderer: "webgpu" | "wasm" } | undefined;
let pendingRender: RenderMessage | undefined;
let renderQueued = false;

function viewIndex(view: ViewId) {
  return view === 0 ? 0 : view === 1 ? 1 : view === 2 ? 2 : 3;
}

async function renderSlice(message: RenderMessage) {
  await ready;
  if (latest.get("render") !== message.id) return;
  const baseKey = `${message.profile}:${message.j.toFixed(12)}:${message.width}:${message.height}`;
  let pixels = cachedSlice?.key === baseKey ? cachedSlice.pixels : undefined;
  let renderer: "webgpu" | "wasm" = cachedSlice?.key === baseKey ? cachedSlice.renderer : "wasm";
  if (!pixels) {
    // A low-resolution request is specifically the CPU/WASM interaction path.
    // Never confirm or invoke WebGPU with a 64x64 slice: once WebGPU succeeds,
    // the main thread permanently requests full-resolution interaction frames.
    if (message.width === FULL_SLICE && message.height === FULL_SLICE && gpuSlice.available) {
      try {
        gpuParameters ??= picker_gpu_parameters();
        pixels = await gpuSlice.render(gpuParameters, viewIndex(message.profile), message.j, message.width, message.height);
        renderer = "webgpu";
      } catch {
        pixels = picker_render_linear_rows(message.profile, message.j, message.width, message.height, 0, message.height);
      }
    } else {
      pixels = picker_render_linear_rows(message.profile, message.j, message.width, message.height, 0, message.height);
    }
    cachedSlice = { key: baseKey, pixels, renderer };
  }
  if (latest.get("render") !== message.id) return;
  const png = encodeLinearRgbaPng(message.profile, message.width, message.height, pixels);
  workerScope.postMessage({ ...message, kind: "slice", renderer, png }, [png.buffer]);
}

async function renderLatest() {
  renderQueued = true;
  while (pendingRender) {
    const message = pendingRender;
    pendingRender = undefined;
    try { await renderSlice(message); }
    catch { reportError(message); }
  }
  renderQueued = false;
}

function reportError(message: Message, operation: string = message.kind) {
  workerScope.postMessage({ kind: "worker-error", id: message.id, operation,
    profile: "profile" in message ? message.profile : undefined });
}

async function evaluateLatest() {
  evaluationQueued = false;
  const message = pendingEvaluation;
  if (!message) return;
  pendingEvaluation = undefined;
  try {
    await ready;
    if (latest.get("evaluate") !== message.id) return;
    const values = picker_evaluate(message.profile, message.j, message.fittedRadiusX, message.fittedRadiusY, message.backgroundJ);
    workerScope.postMessage({ ...message, values });
    try {
      const png = encodePreview(message.profile, values.slice(26, 29), values.slice(29, 32), values[0] > 0.5);
      workerScope.postMessage({ ...message, kind: "preview", valid: values[0] > 0.5, png }, [png.buffer]);
    } catch { reportError(message, "preview"); }
  } catch { reportError(message); }
}

workerScope.onmessage = ({ data: message }) => {
  if (message.kind === "cancel-render") {
    latest.set("render", Math.max(latest.get("render") ?? -1, message.id + 1));
    return;
  }
  latest.set(message.kind, message.id);
  if (message.kind === "evaluate") {
    pendingEvaluation = message;
    if (!evaluationQueued) {
      evaluationQueued = true;
      setTimeout(() => void evaluateLatest(), 0);
    }
    return;
  }
  void ready.then(() => {
    if (latest.get(message.kind) !== message.id) return;
    if (message.kind === "render") {
      pendingRender = message;
      if (!renderQueued) void renderLatest();
    } else if (message.kind === "colorchecker") {
      workerScope.postMessage({ ...message, points: picker_colorchecker() });
    } else if (message.kind === "set") {
      workerScope.postMessage({ ...message, values: picker_from_encoded(message.red, message.green, message.blue) });
    }
  }).catch(() => reportError(message));
};
