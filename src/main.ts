import "./style.css";
import { VIEW_IDS, VIEW_NAMES, type ViewId } from "./preview_png";
import {
  J_REFERENCE_WHITE,
  PATCH_ENTRY_RADIUS,
  ROLLING_BALL_SENSITIVITY,
  backgroundFromSlider,
  canvasPoint,
  clamp01,
  nearestJSnapTarget,
  nearestSnapTarget,
  rollingBallAcceleration,
  rollingBallDelta,
  rollingBallVelocity,
  rollingWheelDelta,
  projectSnapCode,
  slicePoint,
} from "./picker_math";

const FULL = 512;
const PREVIEW = 64;
const SOURCE_PROFILE = 2;
const INITIAL_J = 0.3;
const PATCH_NAMES = [
  "Dark Skin",
  "Light Skin",
  "Blue Sky",
  "Foliage",
  "Blue Flower",
  "Bluish Green",
  "Orange",
  "Purplish Blue",
  "Moderate Red",
  "Purple",
  "Yellow Green",
  "Orange Yellow",
  "Blue",
  "Green",
  "Red",
  "Yellow",
  "Magenta",
  "Cyan",
] as const;

type Code = { j: number; x: number; y: number };
type Patch = {
  name: string;
  j: number;
  x: number;
  y: number;
  p3: [number, number, number];
  srgb: [number, number, number];
  available: boolean;
};
type SnapTarget =
  | { kind: "neutral"; x: number; y: number }
  | { kind: "patch"; index: number; x: number; y: number; j: number };
type RenderResponse = {
  kind: "slice";
  id: number;
  profile: number;
  width: number;
  height: number;
  j: number;
  renderer: "webgpu" | "wasm";
  png: Uint8Array<ArrayBuffer>;
};
type EvaluateResponse = {
  kind: "evaluate";
  id: number;
  profile: number;
  j: number;
  fittedRadiusX: number;
  fittedRadiusY: number;
  backgroundJ: number;
  values: Float64Array;
};
type PreviewResponse = Omit<EvaluateResponse, "kind" | "values"> & {
  kind: "preview"; valid: boolean; png: Uint8Array<ArrayBuffer>;
};
type ColorCheckerResponse = {
  kind: "colorchecker";
  id: number;
  profile: number;
  points: Float64Array;
};
type SetResponse = {
  kind: "set";
  id: number;
  profile: number;
  values: Float64Array;
};
type WorkerError = {
  kind: "worker-error";
  id: number;
  operation: string;
  profile?: number;
};

const $ = <T extends Element>(selector: string) =>
  document.querySelector<T>(selector)!;
const checkerboard = $("#gamut-checkerboard") as HTMLCanvasElement;
const gamutSliceImage = $("#gamut-slice") as HTMLImageElement;
const indicators = $("#gamut-indicators") as HTMLCanvasElement;
const plotFrame = $(".plot-frame") as HTMLElement;
const plotStatus = $("#plot-status") as HTMLElement;
const viewMenu = $("#view-menu") as HTMLElement;
const viewButtons = Array.from(viewMenu.querySelectorAll<HTMLButtonElement>("[data-view]"));
const previewStatus = $("#preview-status") as HTMLElement;
const jWheel = $("#j-wheel") as HTMLElement;
const jWheelRoller = $(".j-wheel-roller") as HTMLElement;
const jReferenceTick = $("#j-reference-tick") as HTMLElement;
const jCurrentIndicator = $("#j-current-indicator") as HTMLElement;
const jNumber = $("#j-number") as HTMLInputElement;
const backgroundRange = $("#background-brightness") as HTMLInputElement;
const backgroundValue = $("#background-brightness-value") as HTMLElement;
const backgroundStick = $("#background-stick") as HTMLElement;
const preview = $("#preview") as HTMLButtonElement;
let previewImage = $("#preview-image") as HTMLImageElement;
const linearValue = $("#linear-value") as HTMLElement;
const encodedValue = $("#encoded-value") as HTMLInputElement;
const copyValue = $("#copy-value") as HTMLButtonElement;
const setValue = $("#set-value") as HTMLButtonElement;
const checkerName = $("#colorchecker-name") as HTMLElement;
const jStick = $("#j-stick") as HTMLElement;

function canvasContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  try {
    const p3 = target.getContext("2d", { colorSpace: "display-p3" });
    if (p3) return p3;
  } catch {
    // Fall through for browsers without canvas color-space selection.
  }
  const context = target.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required.");
  return context;
}

const checkerboardContext = canvasContext(checkerboard);
const indicatorContext = canvasContext(indicators);
let displayP3Canvas = false;
try {
  displayP3Canvas = indicatorContext.getContextAttributes().colorSpace === "display-p3";
} catch {
  displayP3Canvas = false;
}
let sliceSize = FULL;

let imageKey = "";
let renderId = 0;
let evaluationId = 0;
let checkerId = 0;
let setId = 0;
let currentRender:
  | {
      id: number;
      key: string;
      profile: ViewId;
      j: number;
      width: number;
      height: number;
    }
  | undefined;
let currentPatches: Patch[] = [];
let activePatch: number | null = null;
let activeTarget: SnapTarget | null = null;
let activeAxis: "j" | "xy" | null = null;
let code: Code = { j: INITIAL_J, x: 0.38, y: 0.65 };
let realCode: Code = { ...code };
let sliceTouchPointerId: number | null = null;
let sliceTouchLastX = 0;
let sliceTouchLastY = 0;
let sliceTouchLastTime = 0;
let sliceTouchVelocityX = 0;
let sliceTouchVelocityY = 0;
let jWheelPointerId: number | null = null;
let jWheelMouseTracking = false;
let jWheelLastX = 0;
let jWheelLastY = 0;
let jWheelLastTime = 0;
let jWheelVelocityX = 0;
let jWheelVelocityY = 0;
let jWheelTextureOffset = 0;
let jWheelVisualHeight = 0;
let jWheelSuppressClick = false;
let sliceTrackingActive = false;
let selectedView: ViewId = 1;
let confirmedSliceRenderer: "unknown" | "webgpu" | "wasm" = "unknown";
let previewUrl: string | undefined;
let sliceUrl: string | undefined;
let pageClosed = false;
let backgroundSnap: number | null = null;
let latestValueResponseId = 0;
let previewDecodeActive = false;
let queuedPreview: PreviewResponse | undefined;

const sliceWorker = new Worker(new URL("./render_worker.ts", import.meta.url), { type: "module" });
const evaluatorWorker = new Worker(new URL("./render_worker.ts", import.meta.url), { type: "module" });
const checkerWorker = evaluatorWorker;

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
function currentCode(): Code {
  return { ...code };
}
function currentRealCode(): Code {
  return { ...realCode };
}
function currentProfile(): ViewId { return selectedView; }
function requestedSliceSize() {
  return activeAxis === "j" && confirmedSliceRenderer === "wasm"
    ? PREVIEW
    : FULL;
}
function stateKey(code = currentCode(), size = requestedSliceSize()) {
  return `${selectedView}:${size}:${code.j.toFixed(12)}`;
}
function formatRgb(values: ArrayLike<number>) {
  return `(${Array.from(values, (value) => (Number.isFinite(value) ? value.toFixed(4) : "nan")).join(", ")})`;
}
function encodeHex(values: ArrayLike<number>) {
  return Array.from(values, (value) =>
    Math.round(clamp01(Number(value)) * 255)
      .toString(16)
      .padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
}
function decodeHex(value: string): [number, number, number] | undefined {
  const match = /^([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  return [
    parseInt(match[1].slice(0, 2), 16) / 255,
    parseInt(match[1].slice(2, 4), 16) / 255,
    parseInt(match[1].slice(4, 6), 16) / 255,
  ];
}
function currentBackgroundJ() {
  return backgroundFromSlider(Number(backgroundRange.value));
}
function updateBackground() {
  backgroundValue.textContent = currentBackgroundJ().toFixed(3);
}
function updateJWheelVisual() {
  const height = jWheel.getBoundingClientRect().height || 1;
  if (jWheelVisualHeight > 0 && Math.abs(height - jWheelVisualHeight) > 0.01)
    jWheelTextureOffset *= height / jWheelVisualHeight;
  jWheelVisualHeight = height;
  // The wheel is a free physical surface. Its texture phase records raw
  // pointer travel and is deliberately independent of accelerated/snapped J'.
  jWheelRoller.style.backgroundPositionY = `${jWheelTextureOffset}px`;
  jWheel.dataset.realValue = realCode.j.toFixed(6);
  jWheel.dataset.visualOffset = jWheelTextureOffset.toFixed(3);
}
function updatePlotLabel() {
  const interaction = sliceTrackingActive
    ? " mouse tracking active;"
    : sliceTouchPointerId !== null
      ? " touch or pen gesture active;"
      : ";";
  plotFrame.setAttribute(
    "aria-label",
    `Gamut slice${interaction} x' ${code.x.toFixed(6)}, y' ${code.y.toFixed(6)}`,
  );
}
function setDisplayedCode(next: Code) {
  code = {
    j: clamp01(next.j),
    x: clamp01(next.x),
    y: clamp01(next.y),
  };
  updatePlotLabel();
  jWheel.setAttribute("aria-valuenow", code.j.toString());
  jWheel.setAttribute("aria-valuetext", code.j.toFixed(3));
  jWheel.dataset.value = code.j.toFixed(6);
  if (document.activeElement !== jNumber) jNumber.value = code.j.toFixed(3);
  jCurrentIndicator.style.bottom = `${code.j * 100}%`;
  plotFrame.dataset.realJ = realCode.j.toFixed(6);
  plotFrame.dataset.realX = realCode.x.toFixed(6);
  plotFrame.dataset.realY = realCode.y.toFixed(6);
  plotFrame.dataset.displayJ = code.j.toFixed(6);
  plotFrame.dataset.displayX = code.x.toFixed(6);
  plotFrame.dataset.displayY = code.y.toFixed(6);
  updateJWheelVisual();
  drawIndicators();
}
function setRealCode(axis: keyof Code, value: number) {
  const target = clamp01(value);
  realCode[axis] = target;
}
function setAllCode(next: Code) {
  realCode = {
    j: clamp01(next.j),
    x: clamp01(next.x),
    y: clamp01(next.y),
  };
  setDisplayedCode(realCode);
}
function paintCheckerboard() {
  checkerboardContext.clearRect(0, 0, checkerboard.width, checkerboard.height);
  checkerboardContext.fillStyle = "#171a20";
  checkerboardContext.fillRect(0, 0, checkerboard.width, checkerboard.height);
  const tile = 16;
  for (let y = 0; y < checkerboard.height; y += tile) {
    for (let x = 0; x < checkerboard.width; x += tile) {
      checkerboardContext.fillStyle = ((x / tile + y / tile) & 1) === 0 ? "#1b1f26" : "#11151b";
      checkerboardContext.fillRect(x, y, tile, tile);
    }
  }
}
function drawCircle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stroke: string,
  lineWidth: number,
) {
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
}
function drawIndicators() {
  const scale = indicators.width;
  const point = (x: number, y: number) => canvasPoint(x, y, scale);
  indicatorContext.clearRect(0, 0, indicators.width, indicators.height);
  indicatorContext.save();
  const [cx, cy] = point(code.x, code.y);
  drawCircle(indicatorContext, cx, cy, 7, "rgb(255 255 255 / 65%)", 2);
  const [nx, ny] = point(0.5, 0.5);
  indicatorContext.strokeStyle = "rgb(255 255 255 / 25%)";
  indicatorContext.lineWidth = 2;
  indicatorContext.beginPath();
  indicatorContext.moveTo(nx - 8, ny);
  indicatorContext.lineTo(nx + 8, ny);
  indicatorContext.moveTo(nx, ny - 8);
  indicatorContext.lineTo(nx, ny + 8);
  indicatorContext.stroke();
  drawCircle(indicatorContext, nx, ny, PATCH_ENTRY_RADIUS * scale, "rgb(245 193 93 / 30%)", 1.5);
  currentPatches.forEach((patch, patchIndex) => {
    const [px, py] = point(patch.x, patch.y);
    indicatorContext.fillStyle = displayP3Canvas
      ? `color(display-p3 ${patch.p3.join(" ")})`
      : `rgb(${patch.srgb.map((v) => Math.round(clamp01(v) * 255)).join(" ")})`;
    indicatorContext.beginPath();
    indicatorContext.arc(px, py, 3.5, 0, Math.PI * 2);
    indicatorContext.fill();
    const active = activeTarget?.kind === "patch" && activeTarget.index === patchIndex;
    drawCircle(indicatorContext, px, py, PATCH_ENTRY_RADIUS * scale,
      active ? "rgb(190 220 255 / 78%)" : "rgb(190 220 255 / 26%)", active ? 2 : 1.5);
  });
  if (activeTarget?.kind === "neutral")
    drawCircle(indicatorContext, nx, ny, PATCH_ENTRY_RADIUS * scale, "rgb(245 193 93 / 78%)", 2);
  indicatorContext.restore();
}
function invalidatePendingSet() {
  // A hex import must not overwrite newer pointer or Background input.
  // Advancing the request token makes an eventual worker response obsolete.
  setId += 1;
}
function updatePatchLocators() {
  const patch = activePatch === null ? undefined : currentPatches[activePatch];
  jStick.hidden = patch === undefined;
  if (patch) {
    jStick.style.bottom = `${patch.j * 100}%`;
  }
  jCurrentIndicator.style.bottom = `${code.j * 100}%`;
  checkerName.classList.toggle("is-hidden", !patch);
  checkerName.setAttribute("aria-hidden", String(!patch));
  checkerName.textContent = patch?.name ?? "";
}
function updatePatchCandidate(applySnap = true) {
  const real = currentRealCode();
  const patchPoints = currentPatches.map((patch) => ({ x: patch.x, y: patch.y }));
  const candidate = nearestSnapTarget(real.x, real.y, patchPoints);
  if (candidate?.kind === "neutral") {
    activeTarget = candidate;
    activePatch = null;
  } else if (candidate) {
    const patch = currentPatches[candidate.index];
    activePatch = candidate.index;
    activeTarget = {
      kind: "patch",
      index: candidate.index,
      x: patch.x,
      y: patch.y,
      j: patch.j,
    };
  } else {
    activePatch = null;
    activeTarget = null;
  }
  plotFrame.dataset.snapTarget =
    activeTarget?.kind === "patch"
      ? `patch:${activeTarget.index}`
      : activeTarget?.kind ?? "none";
  const jTarget = nearestJSnapTarget(
    real.j,
    activeTarget?.kind === "patch" ? activeTarget.j : undefined,
  );
  plotFrame.dataset.jSnapTarget = jTarget?.kind ?? "none";
  plotFrame.dataset.colorcheckerRingCount = String(currentPatches.length);
  updatePatchLocators();
  const projected =
    applySnap
      ? projectSnapCode(
          real,
          activeTarget,
          activeTarget?.kind === "patch" ? activeTarget.j : undefined,
          activeAxis,
          code,
        )
      : real;
  setDisplayedCode(projected);
}
function displayValues(values: Float64Array) {
  const valid = values[0] > 0.5;
  linearValue.textContent = valid ? formatRgb(values.slice(1, 4)) : "Unavailable";
  if (valid && document.activeElement !== encodedValue)
    encodedValue.value = encodeHex(values.slice(10, 13));
  encodedValue.title = valid ? "sRGB-transfer encoded scene-linear AP1" : "Last valid encoded AP1; the current pick is unavailable";
  preview.classList.toggle("preview-unavailable", !valid);
  // While the replacement PNG is being encoded/decoded, do not leave a
  // previous valid swatch visible behind the unavailable diagnostic cross.
  // displayPreview() changes this to "invalid" once the black diagnostic PNG
  // is ready, or to "valid" for a normal replacement.
  preview.dataset.previewReady = "pending";
  preview.dataset.valid = String(valid);
  preview.setAttribute("aria-label", `${valid ? "Picked color" : "Out-of-gamut color"}; ${VIEW_NAMES[selectedView]}. Choose view transform`);
  backgroundValue.textContent = currentBackgroundJ().toFixed(3);
  const backgroundDescription = `Surround J' ${currentBackgroundJ().toFixed(3)} in the fixed HDR P3 authoring scale`;
  backgroundValue.title = backgroundDescription;
  backgroundRange.setAttribute("aria-valuetext", backgroundDescription);
  backgroundSnap = finite(values[19], 0);
  backgroundStick.hidden = false;
  backgroundStick.style.left = `${clamp01(backgroundSnap) * 100}%`;
}
function evaluationIsCurrent(response: EvaluateResponse | PreviewResponse) {
  return !pageClosed && response.id === evaluationId && response.profile === selectedView &&
    response.j === code.j && response.fittedRadiusX === code.x && response.fittedRadiusY === code.y &&
    Math.abs(response.backgroundJ - currentBackgroundJ()) < 1e-12;
}
function responseBelongsToCurrentView(response: EvaluateResponse | PreviewResponse) {
  return !pageClosed && response.profile === selectedView;
}
function responseMayAdvanceDuringGesture(response: EvaluateResponse | PreviewResponse) {
  return responseBelongsToCurrentView(response) &&
    (activeAxis !== null || evaluationIsCurrent(response));
}
async function displayPreview(response: PreviewResponse) {
  if (!responseMayAdvanceDuringGesture(response)) return;
  previewDecodeActive = true;
  const url = URL.createObjectURL(new Blob([response.png], { type: "image/png" }));
  const nextImage = new Image(256, 256);
  nextImage.id = "preview-image";
  nextImage.alt = `Picked color and background — ${VIEW_NAMES[response.profile as ViewId]}`;
  nextImage.src = url;
  try {
    await nextImage.decode();
    if (!responseMayAdvanceDuringGesture(response)) {
      URL.revokeObjectURL(url);
      return;
    }
    const previousUrl = previewUrl;
    previewImage.replaceWith(nextImage);
    previewImage = nextImage;
    previewUrl = url;
    preview.dataset.view = String(response.profile);
    preview.dataset.imageGeneration = String(response.id);
    preview.dataset.imageCode = JSON.stringify([response.j, response.fittedRadiusX, response.fittedRadiusY, response.backgroundJ]);
    preview.classList.toggle("preview-unavailable", !response.valid);
    preview.dataset.valid = String(response.valid);
    preview.dataset.previewReady = response.valid ? "valid" : "invalid";
    previewStatus.hidden = true;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  } catch {
    URL.revokeObjectURL(url);
    if (responseMayAdvanceDuringGesture(response)) {
      previewStatus.textContent = "Preview could not be decoded; previous image retained.";
      previewStatus.hidden = false;
    }
  } finally {
    previewDecodeActive = false;
    const next = queuedPreview;
    queuedPreview = undefined;
    if (next) queuePreview(next);
  }
}
function queuePreview(response: PreviewResponse) {
  if (!responseMayAdvanceDuringGesture(response)) return;
  if (previewDecodeActive) {
    if (!queuedPreview || response.id > queuedPreview.id) queuedPreview = response;
    return;
  }
  void displayPreview(response);
}
async function displaySlice(response: RenderResponse, key: string) {
  if (!currentRender || currentRender.id !== response.id) return;
  const url = URL.createObjectURL(new Blob([response.png], { type: "image/png" }));
  const nextImage = new Image(response.width, response.height);
  nextImage.alt = "J', x', and y' gamut slice";
  nextImage.src = url;
  try {
    await nextImage.decode();
    if (!currentRender || currentRender.id !== response.id) {
      URL.revokeObjectURL(url);
      return;
    }
    const mayAdvanceGesture = activeAxis === "j";
    const exactState = stateKey(currentCode(), response.width) === key;
    const settledSize = requestedSliceSize();
    if (pageClosed || response.profile !== selectedView ||
      (!mayAdvanceGesture && (!exactState || response.width !== settledSize))) {
      URL.revokeObjectURL(url);
      currentRender = undefined;
      if (!pageClosed) requestRender();
      return;
    }
    const previousUrl = sliceUrl;
    gamutSliceImage.src = url;
    gamutSliceImage.dataset.renderer = response.renderer;
    gamutSliceImage.dataset.view = String(response.profile);
    gamutSliceImage.dataset.imageGeneration = String(response.id);
    gamutSliceImage.dataset.imageCode = JSON.stringify([response.j]);
    if (response.renderer === "webgpu") confirmedSliceRenderer = "webgpu";
    else if (confirmedSliceRenderer === "unknown") confirmedSliceRenderer = "wasm";
    plotFrame.dataset.sliceRenderer = confirmedSliceRenderer;
    sliceUrl = url;
    sliceSize = response.width;
    imageKey = key;
    currentRender = undefined;
    plotFrame.setAttribute("aria-busy", "false");
    plotStatus.hidden = true;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    requestRender();
  } catch {
    URL.revokeObjectURL(url);
    if (currentRender?.id === response.id) {
      currentRender = undefined;
      plotFrame.setAttribute("aria-busy", "false");
      plotStatus.textContent = "Slice image could not be decoded; previous image retained.";
      plotStatus.hidden = false;
      if (stateKey() !== key) requestRender();
    }
  }
}
function requestEvaluate() {
  const code = currentCode();
  const id = ++evaluationId;
  evaluatorWorker.postMessage({
    kind: "evaluate",
    id,
    profile: currentProfile(),
    j: code.j,
    fittedRadiusX: code.x,
    fittedRadiusY: code.y,
    backgroundJ: currentBackgroundJ(),
  });
}
function requestRender() {
  const size = requestedSliceSize();
  const code = currentCode();
  const key = stateKey(code, size);
  if (imageKey === key && sliceSize === size) {
    return;
  }
  plotFrame.setAttribute("aria-busy", "true");
  // Keep one slice frame in flight. Pointer updates merely change the latest
  // desired state; displaySlice() requests that state after this frame lands.
  // This avoids starvation when fast gestures previously cancelled every job.
  if (currentRender) return;
  const id = ++renderId;
  currentRender = { id, key, profile: selectedView, j: code.j, width: size, height: size };
  sliceWorker.postMessage({
    kind: "render",
    id,
    profile: currentProfile(),
    j: code.j,
    width: size,
    height: size,
  });
}
function schedule() {
  // Pointer events can arrive faster than animation frames. The workers
  // already coalesce and cancel stale requests, so submit the newest state
  // immediately rather than waiting for rAF; this keeps J'/XY gestures live
  // even during fast drags while retaining bounded worker work.
  requestEvaluate();
  requestRender();
}
function parsePatches(values: Float64Array) {
  if (values.length !== PATCH_NAMES.length * 10) return;
  const patches: Patch[] = [];
  for (let i = 0; i < PATCH_NAMES.length; i++) {
    const o = i * 10;
    patches.push({
      name: PATCH_NAMES[i],
      j: clamp01(values[o]),
      x: clamp01(values[o + 1]),
      y: clamp01(values[o + 2]),
      p3: [values[o + 3], values[o + 4], values[o + 5]],
      srgb: [values[o + 6], values[o + 7], values[o + 8]],
      available: values[o + 9] > 0.5,
    });
  }
  currentPatches = patches;
  activePatch = null;
  activeTarget = null;
  updatePatchCandidate(false);
}
function requestPatches() {
  currentPatches = [];
  activePatch = null;
  activeTarget = null;
  plotFrame.dataset.snapTarget = "none";
  plotFrame.dataset.jSnapTarget = "none";
  plotFrame.dataset.colorcheckerRingCount = "0";
  updatePatchLocators();
  const id = ++checkerId;
  checkerWorker.postMessage({
    kind: "colorchecker",
    id,
    profile: SOURCE_PROFILE,
  });
}
function chooseView(view: ViewId) {
  cancelSliceTracking();
  finishJWheelInteraction(false);
  selectedView = view;
  preview.title = `${VIEW_NAMES[view]} — click to change view`;
  viewButtons.forEach(button => button.setAttribute("aria-checked", String(Number(button.dataset.view) === view)));
  closeViewMenu(true);
  // No coordinate conversion, marker reload, snap projection, or background edit.
  schedule();
}
function closeViewMenu(restoreFocus = false) {
  viewMenu.hidden = true;
  preview.setAttribute("aria-expanded", "false");
  if (restoreFocus) preview.focus({ preventScroll: true });
}
function openViewMenu() {
  viewMenu.hidden = false;
  preview.setAttribute("aria-expanded", "true");
  const rect = preview.getBoundingClientRect();
  const width = Math.min(370, innerWidth - 20);
  viewMenu.style.width = `${width}px`;
  viewMenu.style.left = `${Math.max(10, Math.min(rect.left, innerWidth - width - 10))}px`;
  viewMenu.style.top = `${Math.max(10, Math.min(rect.bottom + 4, innerHeight - viewMenu.offsetHeight - 10))}px`;
  viewButtons.find(button => Number(button.dataset.view) === selectedView)?.focus({ preventScroll: true });
}
function setFromHex() {
  cancelSliceTracking();
  finishJWheelInteraction(false);
  const decoded = decodeHex(encodedValue.value);
  if (!decoded) {
    encodedValue.setCustomValidity("Enter exactly six hexadecimal digits.");
    encodedValue.reportValidity();
    return;
  }
  encodedValue.setCustomValidity("");
  const id = ++setId;
  evaluatorWorker.postMessage({
    kind: "set",
    id,
    profile: SOURCE_PROFILE,
    red: decoded[0],
    green: decoded[1],
    blue: decoded[2],
  });
}

[sliceWorker, evaluatorWorker].forEach((worker) => {
  worker.onmessage = (
    event: MessageEvent<
      | RenderResponse
      | EvaluateResponse
      | PreviewResponse
      | ColorCheckerResponse
      | SetResponse
      | WorkerError
    >,
  ) => {
    const response = event.data;
    if (response.kind === "worker-error") {
      const current =
        ((response.operation === "render" &&
          response.id === currentRender?.id) ||
          ((response.operation === "evaluate" || response.operation === "preview") && response.id === evaluationId) ||
          (response.operation === "colorchecker" &&
            response.id === checkerId) ||
          (response.operation === "set" && response.id === setId));
      if (!current) return;
      if (response.operation === "preview") {
        previewStatus.textContent = "Preview encoding failed; previous image retained.";
        previewStatus.hidden = false;
        return;
      }
      if (response.operation === "render" || response.operation === "slice") {
        currentRender = undefined;
        plotFrame.setAttribute("aria-busy", "false");
      }
      plotStatus.hidden = false;
      plotStatus.textContent = "Color engine error";
      return;
    }
    if (response.kind === "colorchecker") {
      if (response.id === checkerId)
        parsePatches(response.points);
      return;
    }
    if (response.kind === "set") {
      if (
        response.id !== setId ||
        response.values.length < 4
      )
        return;
      setAllCode({
        j: response.values[1],
        x: response.values[2],
        y: response.values[3],
      });
      if (response.values[0] > 0.5) updatePatchCandidate(false);
      else {
        activePatch = null;
        activeTarget = null;
        updatePatchLocators();
      }
      schedule();
      return;
    }
    if (response.kind === "evaluate") {
      if (responseMayAdvanceDuringGesture(response) && response.id > latestValueResponseId) {
        latestValueResponseId = response.id;
        displayValues(response.values);
      }
      return;
    }
    if (response.kind === "preview") {
      queuePreview(response);
      return;
    }
    if (response.kind === "slice") {
      const render = currentRender;
      if (
        !render ||
        response.id !== render.id ||
        response.profile !== render.profile ||
        response.width !== render.width ||
        response.height !== render.height ||
        response.j !== render.j
      )
        return;
      void displaySlice(response, render.key);
    }
  };
});

function jWheelEventTime(event: PointerEvent) {
  return Number.isFinite(event.timeStamp) && event.timeStamp > 0
    ? event.timeStamp
    : performance.now();
}
function beginJWheelMotion(event: PointerEvent, tracking: "mouse-active" | "drag-active") {
  jWheelLastX = event.clientX;
  jWheelLastY = event.clientY;
  jWheelLastTime = jWheelEventTime(event);
  jWheelVelocityX = 0;
  jWheelVelocityY = 0;
  activeAxis = "j";
  jWheel.dataset.tracking = tracking;
  jWheel.classList.add("is-tracking");
  jNumber.blur();
}
function applyJWheelMotion(event: PointerEvent) {
  const rect = jWheel.getBoundingClientRect();
  const deltaX = event.clientX - jWheelLastX;
  const deltaY = event.clientY - jWheelLastY;
  const eventTime = jWheelEventTime(event);
  const elapsedMs = Math.max(1, eventTime - jWheelLastTime);
  const velocity = rollingBallVelocity(
    { x: jWheelVelocityX, y: jWheelVelocityY },
    deltaX,
    deltaY,
    rect.height,
    rect.height,
    elapsedMs,
  );
  jWheelVelocityX = velocity.x;
  jWheelVelocityY = velocity.y;
  jWheelLastX = event.clientX;
  jWheelLastY = event.clientY;
  jWheelLastTime = eventTime;
  if (deltaX === 0 && deltaY === 0) return;
  jWheelTextureOffset += deltaY;
  const acceleration = rollingBallAcceleration(Math.hypot(velocity.x, velocity.y));
  invalidatePendingSet();
  activeAxis = "j";
  setRealCode(
    "j",
    rollingWheelDelta(
      realCode.j,
      deltaY,
      rect.height,
      ROLLING_BALL_SENSITIVITY,
      acceleration,
    ),
  );
  updatePatchCandidate();
  schedule();
  event.preventDefault();
}
function finishJWheelInteraction(scheduleFinal = true) {
  const wasActive = jWheelMouseTracking || jWheelPointerId !== null;
  const capturedPointer = jWheelPointerId;
  if (capturedPointer !== null) {
    try {
      if (jWheel.hasPointerCapture?.(capturedPointer))
        jWheel.releasePointerCapture(capturedPointer);
    } catch {
      // Synthetic events and browsers without active capture may have no capture.
    }
  }
  jWheelMouseTracking = false;
  jWheelPointerId = null;
  jWheelVelocityX = 0;
  jWheelVelocityY = 0;
  jWheelLastTime = 0;
  jWheel.dataset.tracking = "idle";
  jWheel.classList.remove("is-tracking");
  if (!wasActive) return;
  activeAxis = null;
  jNumber.value = code.j.toFixed(3);
  if (scheduleFinal) schedule();
}
jWheel.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") {
    if (event.button !== 0 || jWheelMouseTracking) return;
    cancelSliceTracking();
    jWheelMouseTracking = true;
    beginJWheelMotion(event, "mouse-active");
    event.stopPropagation();
    event.preventDefault();
    return;
  }
  if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
  finishJWheelInteraction(false);
  cancelSliceTracking();
  jWheelPointerId = event.pointerId;
  beginJWheelMotion(event, "drag-active");
  try {
    jWheel.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic events and browsers without active capture can reject this.
  }
  event.stopPropagation();
  event.preventDefault();
});
jWheel.addEventListener("pointermove", (event) => {
  if (event.pointerId !== jWheelPointerId) return;
  applyJWheelMotion(event);
});
jWheel.addEventListener("pointerup", (event) => {
  if (event.pointerId !== jWheelPointerId) return;
  finishJWheelInteraction();
  event.preventDefault();
});
jWheel.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== jWheelPointerId) return;
  finishJWheelInteraction();
});
document.addEventListener("pointermove", (event) => {
  if (!jWheelMouseTracking || event.pointerType !== "mouse") return;
  applyJWheelMotion(event);
});
document.addEventListener("pointerdown", (event) => {
  if (!jWheelMouseTracking || event.pointerType !== "mouse" || event.button !== 0)
    return;
  jWheelSuppressClick = true;
  window.setTimeout(() => { jWheelSuppressClick = false; }, 300);
  finishJWheelInteraction();
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
document.addEventListener("click", (event) => {
  if (!jWheelSuppressClick) return;
  jWheelSuppressClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
jWheel.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 0.05 : 0.01;
  let delta = 0;
  if (event.key === "ArrowUp") delta = step;
  else if (event.key === "ArrowDown") delta = -step;
  else if (event.key === "Home") delta = -1;
  else if (event.key === "End") delta = 1;
  else return;
  event.preventDefault();
  finishJWheelInteraction(false);
  invalidatePendingSet();
  activeAxis = "j";
  setRealCode("j", event.key === "Home" ? 0 : event.key === "End" ? 1 : realCode.j + delta);
  updatePatchCandidate();
  activeAxis = null;
  schedule();
});

function applyJNumber(format = false) {
  const value = Number(jNumber.value);
  if (!Number.isFinite(value)) {
    if (format) jNumber.value = code.j.toFixed(3);
    return;
  }
  finishJWheelInteraction(false);
  invalidatePendingSet();
  activeAxis = "j";
  setRealCode("j", value);
  updatePatchCandidate();
  activeAxis = null;
  if (format) jNumber.value = code.j.toFixed(3);
  schedule();
}
jNumber.addEventListener("input", () => applyJNumber());
jNumber.addEventListener("change", () => applyJNumber(true));
jNumber.addEventListener("blur", () => {
  jNumber.value = code.j.toFixed(3);
});

function applySlicePointer(event: PointerEvent) {
  const point = slicePoint(event.clientX, event.clientY, gamutSliceImage.getBoundingClientRect());
  invalidatePendingSet();
  activeAxis = "xy";
  setRealCode("x", point.x);
  setRealCode("y", point.y);
  updatePatchCandidate();
  schedule();
}
function cancelSliceTracking() {
  sliceTrackingActive = false;
  plotFrame.classList.remove("slice-tracking");
  plotFrame.dataset.sliceTracking = "idle";
  if (sliceTouchPointerId !== null) {
    try {
      if (plotFrame.hasPointerCapture?.(sliceTouchPointerId)) plotFrame.releasePointerCapture(sliceTouchPointerId);
    } catch { /* capture may already be released */ }
  }
  sliceTouchPointerId = null;
  sliceTouchVelocityX = 0;
  sliceTouchVelocityY = 0;
  sliceTouchLastTime = 0;
  activeAxis = null;
  updatePlotLabel();
}
function commitSliceTracking(event?: PointerEvent) {
  if (!sliceTrackingActive) return;
  if (event && event.target === gamutSliceImage) applySlicePointer(event);
  cancelSliceTracking();
  schedule();
}
plotFrame.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") {
    if (event.button !== 0) return;
    if (!sliceTrackingActive) {
      sliceTrackingActive = true;
      plotFrame.classList.add("slice-tracking");
      plotFrame.dataset.sliceTracking = "active";
      applySlicePointer(event);
    } else {
      commitSliceTracking(event);
    }
    event.stopPropagation();
    event.preventDefault();
    return;
  }
  if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
  // Slice and wheel gestures are mutually exclusive. A touch/pen slice start
  // must terminate any document-level mouse wheel tracking left by a desktop
  // pointer sequence before capturing this pointer.
  finishJWheelInteraction(false);
  cancelSliceTracking();
  sliceTouchPointerId = event.pointerId;
  sliceTouchLastX = event.clientX;
  sliceTouchLastY = event.clientY;
  sliceTouchLastTime = Number.isFinite(event.timeStamp) && event.timeStamp > 0 ? event.timeStamp : performance.now();
  sliceTouchVelocityX = 0;
  sliceTouchVelocityY = 0;
  activeAxis = "xy";
  plotFrame.dataset.sliceTracking = "touch-active";
  plotFrame.classList.add("slice-tracking");
  updatePlotLabel();
  try { plotFrame.setPointerCapture?.(event.pointerId); } catch { /* synthetic events */ }
  event.preventDefault();
});
document.addEventListener("pointermove", (event) => {
  if (!sliceTrackingActive || event.pointerType !== "mouse") return;
  applySlicePointer(event);
});
document.addEventListener("pointerdown", (event) => {
  if (!sliceTrackingActive || event.pointerType !== "mouse" || event.button !== 0)
    return;
  if (event.target !== gamutSliceImage) commitSliceTracking();
});
plotFrame.addEventListener("pointermove", (event) => {
  if ((event.pointerType !== "touch" && event.pointerType !== "pen") || event.pointerId !== sliceTouchPointerId) return;
  const rect = plotFrame.getBoundingClientRect();
  const dx = event.clientX - sliceTouchLastX;
  const dy = event.clientY - sliceTouchLastY;
  const eventTime = Number.isFinite(event.timeStamp) && event.timeStamp > 0 ? event.timeStamp : performance.now();
  const elapsedMs = Math.max(1, eventTime - sliceTouchLastTime);
  const velocity = rollingBallVelocity({ x: sliceTouchVelocityX, y: sliceTouchVelocityY }, dx, dy, rect.width, rect.height, elapsedMs);
  sliceTouchVelocityX = velocity.x;
  sliceTouchVelocityY = velocity.y;
  sliceTouchLastX = event.clientX;
  sliceTouchLastY = event.clientY;
  sliceTouchLastTime = eventTime;
  const acceleration = rollingBallAcceleration(Math.hypot(velocity.x, velocity.y));
  const next = rollingBallDelta(realCode.x, realCode.y, dx, dy, rect.width, rect.height, ROLLING_BALL_SENSITIVITY, acceleration);
  invalidatePendingSet();
  setRealCode("x", next.x);
  setRealCode("y", next.y);
  updatePatchCandidate();
  schedule();
  event.preventDefault();
});
function finishSliceTouch(event: PointerEvent) {
  if (event.pointerId !== sliceTouchPointerId) return;
  try { if (plotFrame.hasPointerCapture?.(event.pointerId)) plotFrame.releasePointerCapture(event.pointerId); } catch { /* synthetic events */ }
  sliceTouchPointerId = null;
  sliceTouchVelocityX = 0;
  sliceTouchVelocityY = 0;
  sliceTouchLastTime = 0;
  plotFrame.dataset.sliceTracking = "idle";
  plotFrame.classList.remove("slice-tracking");
  activeAxis = null;
  updatePlotLabel();
  schedule();
}
plotFrame.addEventListener("pointerup", finishSliceTouch);
plotFrame.addEventListener("pointercancel", finishSliceTouch);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    cancelSliceTracking();
    finishJWheelInteraction();
  }
});
backgroundRange.addEventListener("input", () => {
  invalidatePendingSet();
  if (
    backgroundSnap !== null &&
    Math.abs(Number(backgroundRange.value) - backgroundSnap) <= 0.02
  ) {
    backgroundRange.value = backgroundSnap.toString();
  }
  backgroundValue.textContent = currentBackgroundJ().toFixed(3);
  schedule();
});
backgroundRange.addEventListener("change", () => {
  invalidatePendingSet();
  schedule();
});
preview.addEventListener("click", () => viewMenu.hidden ? openViewMenu() : closeViewMenu());
viewButtons.forEach(button => button.addEventListener("click", () => {
  const view = Number(button.dataset.view) as ViewId;
  if (VIEW_IDS.includes(view)) chooseView(view);
}));
viewMenu.addEventListener("keydown", event => {
  const index = viewButtons.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | undefined;
  if (event.key === "ArrowDown") next = (index + 1) % viewButtons.length;
  if (event.key === "ArrowUp") next = (index + viewButtons.length - 1) % viewButtons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = viewButtons.length - 1;
  if (next !== undefined) { event.preventDefault(); viewButtons[next].focus(); }
  if (event.key === "Escape") { event.preventDefault(); closeViewMenu(true); }
  if (event.key === "Tab") closeViewMenu();
});
document.addEventListener("pointerdown", event => {
  if (!viewMenu.hidden && !viewMenu.contains(event.target as Node) && !preview.contains(event.target as Node)) closeViewMenu();
});
window.addEventListener("resize", () => {
  closeViewMenu();
  updateJWheelVisual();
});
window.addEventListener("pagehide", () => {
  pageClosed = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (sliceUrl) URL.revokeObjectURL(sliceUrl);
});
window.addEventListener("pageshow", () => {
  if (pageClosed) { pageClosed = false; schedule(); }
});
copyValue.addEventListener("click", async () => {
  try {
    await navigator.clipboard?.writeText(encodedValue.value);
  } catch {
    encodedValue.focus();
    encodedValue.select();
  }
});
setValue.addEventListener("click", setFromHex);
encodedValue.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    setFromHex();
  }
});

setAllCode(code);
paintCheckerboard();
drawIndicators();
plotFrame.dataset.sliceTracking = "idle";
jWheel.dataset.tracking = "idle";
jReferenceTick.style.bottom = `${J_REFERENCE_WHITE * 100}%`;
jReferenceTick.title = `100 nits — J\u2032 ${J_REFERENCE_WHITE.toFixed(6)}`;
backgroundRange.value = "0.15";
updateBackground();
requestPatches();
requestEvaluate();
requestRender();
