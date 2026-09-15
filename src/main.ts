import "./style.css";
import { VIEW_IDS, VIEW_NAMES, type ViewId } from "./preview_png";
import {
  J_REFERENCE_WHITE,
  J_SNAP_DISTANCE,
  PATCH_ENTRY_RADIUS,
  ROLLING_BALL_SENSITIVITY,
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
  covarianceEllipse,
  ellipsePoint,
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
  | { kind: "patch"; index: number; x: number; y: number; j: number }
  | { kind: "average"; x: number; y: number };
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
const backgroundStick = $("#background-stick") as HTMLElement;
const preview = $("#preview") as HTMLButtonElement;
let previewImage = $("#preview-image") as HTMLImageElement;
const linearValue = $("#linear-value") as HTMLElement;
const encodedValue = $("#encoded-value") as HTMLInputElement;
const copyValue = $("#copy-value") as HTMLButtonElement;
const setValue = $("#set-value") as HTMLButtonElement;
const checkerName = $("#colorchecker-name") as HTMLElement;
const jStick = $("#j-stick") as HTMLElement;
const jImageStick = $("#j-image-stick") as HTMLElement;
const imageFileInput = $("#image-file-input") as HTMLInputElement;
const imagePanel = $("#image-panel") as HTMLElement;
const imagePreview = $("#image-preview") as HTMLImageElement;
const imageViewport = $("#image-viewport") as HTMLElement;
const imageOverlay = $("#image-overlay") as HTMLCanvasElement;
const imageLoupe = $("#image-loupe") as HTMLImageElement;
const imageStatus = $("#image-status") as HTMLElement;
const imageTransformBanner = $("#image-transform-banner") as HTMLElement;
const imageGamutSelect = $("#image-gamut") as HTMLSelectElement;
const imageTransferSelect = $("#image-transfer") as HTMLSelectElement;
const imageScale203 = $("#image-scale-203") as HTMLInputElement;
const imageGamutField = $("#image-gamut-field") as HTMLElement;
const imageTransferField = $("#image-transfer-field") as HTMLElement;
const imageStats = $("#image-stats") as HTMLElement;
const imageLoadButton = $("#image-load") as HTMLButtonElement;
const imageOptionsButton = $("#image-options") as HTMLButtonElement;
const imageOptionsDialog = $("#image-options-dialog") as HTMLDialogElement;
const imageOptionsClose = $("#image-options-close") as HTMLButtonElement;
const imageInterpretationWarning = $("#image-interpretation-warning") as HTMLElement;
const imageZoomButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-image-zoom]"));

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
// Keep this transparent overlay in the same wide-gamut canvas space as the
// gamut indicators. Safari can otherwise flatten an HDR image stack when an
// sRGB canvas is composited over its valid PQ image.
const imageOverlayContext = canvasContext(imageOverlay);
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
let imageAverage: Code | null = null;
type ImageAnalysis = {
  x: number;
  y: number;
  sampleCount: number;
  rejectedCount: number;
  mean: Code;
  meanAcescg: [number, number, number];
  ellipse: ReturnType<typeof covarianceEllipse>;
  loupe?: { x: number; y: number; width: number; height: number };
};
let imageAnalysis: ImageAnalysis | null = null;
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
let backgroundJ = 0.15;
let backgroundTracking = false;
let backgroundPointerId: number | null = null;
let backgroundLastY = 0;
let backgroundLastTime = 0;
let backgroundVelocityX = 0;
let backgroundVelocityY = 0;
let backgroundMoved = false;
let backgroundSuppressClick = false;
let latestValueResponseId = 0;
let latestPreviewResponseId = 0;
let previewDecodeActive = false;
let queuedPreview: PreviewResponse | undefined;

const sliceWorker = new Worker(new URL("./render_worker.ts", import.meta.url), { type: "module" });
const evaluatorWorker = new Worker(new URL("./render_worker.ts", import.meta.url), { type: "module" });
const checkerWorker = evaluatorWorker;
type ImageWorkerRequest = {
  kind: "inspect" | "prepare" | "sample" | "preview";
  id: number;
  generation: number;
  token?: number;
  appearanceToken?: number;
  format: string;
  bytes?: ArrayBuffer;
  gamut?: string | null;
  transfer?: string | null;
  view?: ViewId;
  scale203?: boolean;
  x?: number;
  y?: number;
  radius?: number;
};
type ImageWorkerMessage =
  | { kind: "inspect"; id: number; generation: number; summary: any }
  | { kind: "ready"; id: number; generation: number; width: number; height: number; previewWidth: number; previewHeight: number; summary: any; png: ArrayBuffer; view: ViewId; scale203: boolean; renderer: "webgpu" | "wasm" }
  | { kind: "preview"; id: number; generation: number; appearanceToken: number; width: number; height: number; previewWidth: number; previewHeight: number; png: ArrayBuffer; view: ViewId; scale203: boolean; renderer: "webgpu" | "wasm" }
  | { kind: "sample"; id: number; generation: number; token: number; x: number; y: number; minX: number; minY: number; width: number; height: number; loupe: ArrayBuffer; points: Array<{ j: number; x: number; y: number }>; mean: Code; meanAcescg: [number, number, number]; meanCode: Float64Array; rejected: number; total: number; view: ViewId; scale203: boolean }
  | { kind: "error"; id: number; generation?: number; message: string };
const imageWorker = new Worker(new URL("./image_locator_worker.ts", import.meta.url), { type: "module" });
let imageRequestId = 0;
let imageGeneration = 0;
let imageFile: File | undefined;
let imageFormat = "";
let imageSummary: any;
let imagePrepared = false;
let imageScaleBy203 = true;
let imageScaleUserChanged = false;
let imageWidth = 0;
let imageHeight = 0;
let imagePreviewUrl: string | undefined;
let imageLoupeUrl: string | undefined;
let imagePointerX = 0;
let imagePointerY = 0;
let imagePointerSet = false;
let imageTrackingActive = false;
let imageTouchPointerId: number | null = null;
let imageTouchLastX = 0;
let imageTouchLastY = 0;
let imageTouchLastTime = 0;
let imageTouchVelocityX = 0;
let imageTouchVelocityY = 0;
let imageSampleToken = 0;
let latestImageSampleToken = 0;
let imageZoom = 2;
let imagePointerLockActive = false;
let imagePointerLockFallback = false;
let imageOptionsFocusPending = false;
let imageAppearanceToken = 0;
let pendingImageAppearance:
  | { token: number; view: ViewId; scale203: boolean; previewReady: boolean; sampleToken?: number; loupeReady: boolean }
  | undefined;

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
  return backgroundJ;
}
function updateBackground() {
  backgroundStick.hidden = false;
  backgroundStick.style.bottom = `${clamp01(backgroundJ) * 100}%`;
  backgroundStick.title = `Background J′ ${backgroundJ.toFixed(3)}`;
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
  // Keep enough precision for resize reconstruction and diagnostics; the
  // texture itself remains sub-pixel precise in CSS.
  jWheel.dataset.visualOffset = jWheelTextureOffset.toFixed(9);
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
  if (imageAnalysis?.ellipse) {
    indicatorContext.strokeStyle = "rgb(255 203 93 / 78%)";
    indicatorContext.lineWidth = 2;
    indicatorContext.beginPath();
    for (let step = 0; step <= 96; step += 1) {
      const ellipsePointValue = ellipsePoint(imageAnalysis.ellipse, step / 96 * Math.PI * 2);
      const [ex, ey] = point(ellipsePointValue.x, ellipsePointValue.y);
      if (step === 0) indicatorContext.moveTo(ex, ey);
      else indicatorContext.lineTo(ex, ey);
    }
    indicatorContext.closePath();
    indicatorContext.stroke();
  }
  if (imageAverage) {
    const [ax, ay] = point(imageAverage.x, imageAverage.y);
    drawCircle(indicatorContext, ax, ay, 5, "rgb(255 203 93 / 92%)", 2);
    indicatorContext.fillStyle = "rgb(255 203 93 / 92%)";
    indicatorContext.beginPath();
    indicatorContext.arc(ax, ay, 2, 0, Math.PI * 2);
    indicatorContext.fill();
  }
  if (activeTarget?.kind === "neutral")
    drawCircle(indicatorContext, nx, ny, PATCH_ENTRY_RADIUS * scale, "rgb(245 193 93 / 78%)", 2);
  if (activeTarget?.kind === "average" && imageAverage) {
    const [ax, ay] = point(imageAverage.x, imageAverage.y);
    drawCircle(indicatorContext, ax, ay, PATCH_ENTRY_RADIUS * scale, "rgb(255 203 93 / 96%)", 2);
  }
  plotFrame.dataset.indicatorPatchCount = String(currentPatches.length);
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
  jImageStick.hidden = imageAverage === null;
  if (imageAverage) jImageStick.style.bottom = `${imageAverage.j * 100}%`;
  jCurrentIndicator.style.bottom = `${code.j * 100}%`;
  checkerName.classList.toggle("is-hidden", !patch);
  checkerName.setAttribute("aria-hidden", String(!patch));
  checkerName.textContent = patch?.name ?? "";
}
function updatePatchCandidate(applySnap = true) {
  const real = currentRealCode();
  const patchPoints = currentPatches.map((patch) => ({ x: patch.x, y: patch.y }));
  const candidate = nearestSnapTarget(real.x, real.y, patchPoints, { x: 0.5, y: 0.5 }, imageAverage ? { x: imageAverage.x, y: imageAverage.y } : undefined);
  if (candidate?.kind === "neutral") {
    activeTarget = candidate;
    activePatch = null;
  } else if (candidate?.kind === "average") {
    activePatch = null;
    activeTarget = { kind: "average", x: candidate.x, y: candidate.y };
  } else if (candidate?.kind === "patch") {
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
    J_REFERENCE_WHITE,
    J_SNAP_DISTANCE,
    imageAverage?.j,
  );
  plotFrame.dataset.jSnapTarget = jTarget?.kind ?? "none";
  plotFrame.dataset.colorcheckerRingCount = String(currentPatches.length);
  updatePatchLocators();
  if (applySnap) {
    const projected = projectSnapCode(
      real,
      activeTarget,
      activeTarget?.kind === "patch" ? activeTarget.j : undefined,
      activeAxis,
      code,
      imageAverage?.j,
    );
    setDisplayedCode(projected);
  }
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
  backgroundSnap = finite(values[19], 0);
  updateBackground();
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
    (activeAxis !== null || backgroundTracking || evaluationIsCurrent(response));
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
    if (!responseMayAdvanceDuringGesture(response) || response.id !== latestPreviewResponseId) {
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
  if (response.id < latestPreviewResponseId) return;
  latestPreviewResponseId = response.id;
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
  // The initial canvas was painted before the asynchronous ColorChecker
  // response arrived.  Repaint now so dots and their dim rings are visible
  // without requiring a picker gesture.
  drawIndicators();
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
  if (imageTrackingActive) finishImageTracking();
  selectedView = view;
  preview.title = `${VIEW_NAMES[view]} — click to change view`;
  viewButtons.forEach(button => button.setAttribute("aria-checked", String(Number(button.dataset.view) === view)));
  closeViewMenu(true);
  // No coordinate conversion, marker reload, snap projection, or background edit.
  schedule();
  if (imagePrepared) {
    requestImagePreview();
    requestImageSample();
  }
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

function imageSetStatus(message: string, error = false) {
  imageStatus.textContent = message;
  imageStatus.classList.toggle("callout-error", error);
}

function clearImageLoupe() {
  imageLoupe.removeAttribute("src");
  imageLoupe.alt = "Pixel loupe";
  imageLoupe.style.display = "none";
  if (imageLoupeUrl) URL.revokeObjectURL(imageLoupeUrl);
  imageLoupeUrl = undefined;
}

function setImageTransformBusy(busy: boolean) {
  imagePanel.classList.toggle("image-transforming", busy);
  imageTransformBanner.hidden = !busy;
  imageViewport.setAttribute("aria-busy", String(busy));
  imagePanel.dataset.transforming = String(busy);
  if (!busy) pendingImageAppearance = undefined;
}

function finishImageAppearanceIfReady() {
  const pending = pendingImageAppearance;
  if (pending?.view === selectedView && pending.scale203 === imageScaleBy203 &&
    pending.previewReady && pending.loupeReady) setImageTransformBusy(false);
}

function detectImageFormat(file: File): string | undefined {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".dng") || file.type === "image/x-adobe-dng" || file.type === "image/dng") return "dng";
  if (lower.endsWith(".png") || file.type === "image/png") return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || file.type === "image/jpeg") return "jpeg";
  if (lower.endsWith(".exr") || file.type === "image/x-exr") return "exr";
  if (lower.endsWith(".heic") || file.type === "image/heic") return "heic";
  if (lower.endsWith(".heif") || file.type === "image/heif") return "heif";
  return undefined;
}

function defaultImageScale203(format: string, summary?: any): boolean {
  const normalizedFormat = String(summary?.format ?? format).toLowerCase();
  if (normalizedFormat === "dng" || normalizedFormat === "exr") return false;
  if (summary?.gainmap_confirmed) return false;
  const transfer = String(summary?.transfer ?? "").toLowerCase();
  // PQ and HLG sources already carry an HDR display-referred scale.  Do not
  // apply the SDR-to-HDR 2.03 lift unless the user explicitly opts in.
  if (transfer.includes("pq") || transfer.includes("hlg")) return false;
  return true;
}

function syncImageScaleDefault() {
  if (imageScaleUserChanged) return;
  const selectedTransfer = imageGamutSelect.value === "embedded"
    ? imageSummary?.transfer
    : imageTransferSelect.value;
  imageScaleBy203 = defaultImageScale203(imageFormat, { ...imageSummary, transfer: selectedTransfer });
  imageScale203.checked = imageScaleBy203;
}

function imageSetControlVisibility(summary: any) {
  const isDng = String(summary?.format ?? imageFormat).toLowerCase() === "dng";
  imageGamutField.hidden = isDng;
  imageTransferField.hidden = isDng || imageGamutSelect.value === "embedded";
  imageTransferSelect.disabled = isDng || imageGamutSelect.value === "embedded";
  const embedded = Boolean(summary?.embedded_available ?? summary?.automatic_icc);
  const option = imageGamutSelect.querySelector<HTMLOptionElement>('option[value="embedded"]');
  if (option) {
    option.disabled = !embedded;
    option.textContent = summary?.metadata_source
      ? `Use embedded ${String(summary.metadata_source).replace(/^(PNG|JPEG|HEIF|EXR)\s+/i, "")}`
      : "Use embedded interpretation";
  }
  if (!embedded && !isDng) {
    imageGamutSelect.value = "Rec.709 / sRGB";
    imageTransferSelect.value = "sRGB";
    imageInterpretationWarning.hidden = false;
    imageInterpretationWarning.textContent = "No embedded color profile was found. The image is being interpreted as sRGB (Rec.709) with sRGB transfer; you can override this below.";
  }
}

function imageInterpretationReady() {
  if (String(imageSummary?.format ?? imageFormat).toLowerCase() === "dng") return true;
  if (imageGamutSelect.value === "embedded") return Boolean(imageSummary?.embedded_available ?? imageSummary?.automatic_icc);
  return Boolean(imageGamutSelect.value && imageTransferSelect.value);
}

function updateImageOptionsWarning() {
  const format = String(imageSummary?.format ?? imageFormat).toLowerCase();
  const assumed = format !== "dng" && !Boolean(imageSummary?.embedded_available ?? imageSummary?.automatic_icc) && imageGamutSelect.value === "Rec.709 / sRGB" && imageTransferSelect.value === "sRGB";
  imageInterpretationWarning.hidden = !assumed;
  if (assumed) imageInterpretationWarning.textContent = "No embedded color profile was found. The image is being interpreted as sRGB (Rec.709) with sRGB transfer; you can override this below.";
}

function imageRequestPrepare() {
  if (!imageFile || !imageFormat || !imageInterpretationReady()) {
    if (imageFile) imageSetStatus("Select both Primaries and Transfer to interpret this image.");
    return;
  }
  imagePrepared = false;
  setImageTransformBusy(true);
  if (imageTrackingActive) finishImageTracking();
  // A new interpretation changes every sampled AP0 value.  Drop the old
  // statistics and average snap target immediately; the pointer location is
  // retained and sampled again when the replacement raster is ready.
  imageAnalysis = null;
  imageAverage = null;
  clearImageLoupe();
  imagePanel.dataset.ready = "false";
  imageViewport.dataset.ready = "false";
  updatePatchCandidate(false);
  drawIndicators();
  imageGeneration += 1;
  imageSetStatus("Preparing the native image raster…");
  const id = imageRequestId;
  const embedded = imageGamutSelect.value === "embedded";
  imageWorker.postMessage({
    kind: "prepare", id, generation: imageGeneration, format: imageFormat,
    gamut: embedded || String(imageSummary?.format ?? "").toLowerCase() === "dng" ? null : imageGamutSelect.value,
    transfer: embedded || String(imageSummary?.format ?? "").toLowerCase() === "dng" ? null : imageTransferSelect.value,
    view: selectedView,
    scale203: imageScaleBy203,
  } satisfies ImageWorkerRequest);
}

function imageGeometry() {
  const viewport = imageViewport.getBoundingClientRect();
  const sourceW = Math.max(1, imageWidth), sourceH = Math.max(1, imageHeight);
  const baseScale = Math.max(viewport.width / sourceW, viewport.height / sourceH);
  const scale = baseScale * imageZoom;
  const width = sourceW * scale, height = sourceH * scale;
  const xFraction = imagePointerX / Math.max(1, imageWidth - 1);
  const yFraction = imagePointerY / Math.max(1, imageHeight - 1);
  const desiredLeft = viewport.width / 2 - xFraction * width;
  const desiredTop = viewport.height / 2 - yFraction * height;
  const left = Math.max(viewport.width - width, Math.min(0, desiredLeft));
  const top = Math.max(viewport.height - height, Math.min(0, desiredTop));
  return {
    viewport,
    scale,
    width,
    height,
    left,
    top,
    crosshairX: left + xFraction * width,
    crosshairY: top + yFraction * height,
  };
}

function updateImageGeometry() {
  if (!imageWidth || !imageHeight) return imageGeometry();
  const geometry = imageGeometry();
  imagePreview.style.left = `${geometry.left}px`;
  imagePreview.style.top = `${geometry.top}px`;
  imagePreview.style.width = `${geometry.width}px`;
  imagePreview.style.height = `${geometry.height}px`;
  imageViewport.dataset.zoom = String(imageZoom);
  imageViewport.dataset.panX = geometry.left.toFixed(3);
  imageViewport.dataset.panY = geometry.top.toFixed(3);
  imageViewport.dataset.crosshairX = geometry.crosshairX.toFixed(3);
  imageViewport.dataset.crosshairY = geometry.crosshairY.toFixed(3);
  return geometry;
}

function imageViewportRect() {
  const geometry = updateImageGeometry();
  return {
    left: geometry.viewport.left + geometry.left,
    top: geometry.viewport.top + geometry.top,
    width: geometry.width,
    height: geometry.height,
  };
}

function imageClientToNative(clientX: number, clientY: number) {
  const rect = imageViewportRect();
  return {
    x: clamp01((clientX - rect.left) / Math.max(1, rect.width)) * Math.max(0, imageWidth - 1),
    y: clamp01((clientY - rect.top) / Math.max(1, rect.height)) * Math.max(0, imageHeight - 1),
  };
}

function imageNativeToCanvas(x: number, y: number): [number, number] {
  const geometry = updateImageGeometry();
  const px = geometry.left + (x / Math.max(1, imageWidth - 1)) * geometry.width;
  const py = geometry.top + (y / Math.max(1, imageHeight - 1)) * geometry.height;
  return [
    px / Math.max(1, geometry.viewport.width) * imageOverlay.width,
    py / Math.max(1, geometry.viewport.height) * imageOverlay.height,
  ];
}

function drawImageOverlay() {
  imageOverlayContext.clearRect(0, 0, imageOverlay.width, imageOverlay.height);
  imageLoupe.style.display = imageAnalysis?.loupe ? "block" : "none";
  if (!imagePointerSet) return;
  const geometry = updateImageGeometry();
  const [px, py] = [
    geometry.crosshairX / Math.max(1, geometry.viewport.width) * imageOverlay.width,
    geometry.crosshairY / Math.max(1, geometry.viewport.height) * imageOverlay.height,
  ];
  imageOverlayContext.save();
  imageOverlayContext.strokeStyle = "rgb(255 255 255 / 92%)";
  imageOverlayContext.lineWidth = 2;
  imageOverlayContext.beginPath();
  imageOverlayContext.moveTo(px - 18, py); imageOverlayContext.lineTo(px - 5, py);
  imageOverlayContext.moveTo(px + 5, py); imageOverlayContext.lineTo(px + 18, py);
  imageOverlayContext.moveTo(px, py - 18); imageOverlayContext.lineTo(px, py - 5);
  imageOverlayContext.moveTo(px, py + 5); imageOverlayContext.lineTo(px, py + 18);
  imageOverlayContext.stroke();
  imageOverlayContext.strokeStyle = "rgb(0 0 0 / 85%)";
  imageOverlayContext.lineWidth = 1;
  imageOverlayContext.strokeRect(px - 4, py - 4, 8, 8);
  imageOverlayContext.restore();
}

function requestImageSample() {
  if (!imagePrepared || !imageFile) return;
  const token = ++imageSampleToken;
  latestImageSampleToken = token;
  if (pendingImageAppearance?.view === selectedView && pendingImageAppearance.scale203 === imageScaleBy203) {
    pendingImageAppearance.sampleToken = token;
    pendingImageAppearance.loupeReady = false;
  }
  imageWorker.postMessage({ kind: "sample", id: imageRequestId, generation: imageGeneration, token, format: imageFormat, x: imagePointerX, y: imagePointerY, radius: 3, view: selectedView, scale203: imageScaleBy203 } satisfies ImageWorkerRequest);
}

function requestImagePreview() {
  if (!imagePrepared || !imageFile) return;
  const appearanceToken = ++imageAppearanceToken;
  pendingImageAppearance = { token: appearanceToken, view: selectedView, scale203: imageScaleBy203, previewReady: false, loupeReady: false };
  setImageTransformBusy(true);
  imageWorker.postMessage({ kind: "preview", id: imageRequestId, generation: imageGeneration, appearanceToken, format: imageFormat, view: selectedView, scale203: imageScaleBy203 } satisfies ImageWorkerRequest);
}

function setImagePointer(x: number, y: number, sample = true) {
  imagePointerX = Math.max(0, Math.min(Math.max(0, imageWidth - 1), x));
  imagePointerY = Math.max(0, Math.min(Math.max(0, imageHeight - 1), y));
  imagePointerSet = true;
  updateImageGeometry();
  imageViewport.dataset.pointerX = imagePointerX.toFixed(4);
  imageViewport.dataset.pointerY = imagePointerY.toFixed(4);
  drawImageOverlay();
  if (sample) requestImageSample();
}

function applyImageRelativeDelta(deltaX: number, deltaY: number, sample = true) {
  const geometry = updateImageGeometry();
  // The native selection is the sole gesture state. Centering it and clamping
  // the rendered image gives the unique image/crosshair solution; at a bound,
  // further deltas move the crosshair toward the image edge, and reversal
  // naturally re-centers it before the image begins moving again.
  setImagePointer(imagePointerX + deltaX / Math.max(1e-6, geometry.scale), imagePointerY + deltaY / Math.max(1e-6, geometry.scale), sample);
}

function setImageZoom(value: number) {
  const nextZoom = [1, 2, 5].includes(value) ? value : 2;
  const selectedX = imagePointerX, selectedY = imagePointerY;
  imageZoom = nextZoom;
  imagePointerX = selectedX;
  imagePointerY = selectedY;
  imageZoomButtons.forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.imageZoom) === imageZoom)));
  updateImageGeometry();
  drawImageOverlay();
}

function finishImageTracking() {
  if (document.pointerLockElement === imageViewport) {
    try { document.exitPointerLock(); } catch { /* best effort */ }
  }
  imagePointerLockActive = false;
  imageTrackingActive = false;
  imageTouchPointerId = null;
  imageViewport.classList.remove("image-tracking");
  imageViewport.dataset.tracking = "idle";
  drawImageOverlay();
}

function applyImageDesktopPointer(event: PointerEvent) {
  const point = imageClientToNative(event.clientX, event.clientY);
  setImagePointer(point.x, point.y);
  event.preventDefault();
}

function applyImageLockedMotion(event: MouseEvent) {
  const now = performance.now();
  const elapsed = Math.max(1, now - imageTouchLastTime);
  const dx = event.movementX || 0, dy = event.movementY || 0;
  const velocity = rollingBallVelocity({ x: imageTouchVelocityX, y: imageTouchVelocityY }, dx, dy, imageViewport.clientWidth, imageViewport.clientHeight, elapsed);
  imageTouchVelocityX = velocity.x; imageTouchVelocityY = velocity.y; imageTouchLastTime = now;
  const acceleration = rollingBallAcceleration(Math.hypot(velocity.x, velocity.y));
  applyImageRelativeDelta(dx * acceleration, dy * acceleration);
}

imageWorker.onmessage = async (event: MessageEvent<ImageWorkerMessage>) => {
  const response = event.data;
  if (response.generation !== undefined && response.generation !== imageGeneration) return;
  if (response.id !== imageRequestId) return;
  if (response.kind === "error") {
    imagePrepared = false;
    setImageTransformBusy(false);
    imageSetStatus(response.message, true);
    return;
  }
  if (response.kind === "inspect") {
    imageSummary = response.summary;
    // Inspection establishes the source interpretation controls.  The image
    // viewport remains hidden until the native raster is prepared, but the
    // controls must be available immediately for files without metadata.
    imagePanel.dataset.ready = "inspected";
    imageSetControlVisibility(imageSummary);
    syncImageScaleDefault();
    updateImageOptionsWarning();
    imageTransferField.hidden = String(imageSummary?.format ?? imageFormat).toLowerCase() === "dng" || imageGamutSelect.value === "embedded";
    imageSetStatus(imageInterpretationReady() ? "Preparing the native image raster…" : "Choose a source interpretation to continue.");
    if (imageInterpretationReady()) imageRequestPrepare();
    return;
  }
  if (response.kind === "ready") {
    imageWidth = response.width; imageHeight = response.height;
    // Decode the replacement off-DOM.  Keep the previous row hidden and only
    // expose this generation after the native pointer, geometry, and overlay
    // have all been initialized, preventing an image-without-crosshair gap.
    const generation = imageGeneration;
    const requestId = imageRequestId;
    const url = URL.createObjectURL(new Blob([response.png], { type: "image/png" }));
    const decoded = new Image();
    decoded.src = url;
    try {
      await decoded.decode();
    } catch {
      URL.revokeObjectURL(url);
      imagePrepared = false;
      setImageTransformBusy(false);
      imageSetStatus("Prepared image could not be decoded.", true);
      return;
    }
    if (generation !== imageGeneration || requestId !== imageRequestId) {
      URL.revokeObjectURL(url);
      return;
    }
    const presentationMismatch = response.view !== selectedView || response.scale203 !== imageScaleBy203;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = url;
    imagePreview.src = imagePreviewUrl;
    imagePreview.dataset.renderer = response.renderer;
    imagePreview.alt = `Loaded ${imageFormat.toUpperCase()} image (${imageWidth} × ${imageHeight})`;
    // Make the replacement layout measurable before deriving geometry.  This
    // handler runs to completion before the browser paints, so the ready row,
    // image, and initialized crosshair become visible as one update.
    imagePrepared = true;
    imagePanel.dataset.ready = "true";
    imageViewport.dataset.ready = "true";
    imagePanel.hidden = false;
    imagePointerSet = false;
    setImagePointer(imageWidth / 2, imageHeight / 2, false);
    updateImageGeometry();
    drawImageOverlay();
    imageSetStatus(`${imageWidth} × ${imageHeight} native pixels ready. Click to locate a color.`);
    setImageTransformBusy(false);
    imageStats.textContent = "Move the crosshair to inspect a 3 px neighborhood.";
    if (presentationMismatch) requestImagePreview();
    requestImageSample();
    return;
  }
  if (response.kind === "preview") {
    if (!imagePrepared || response.appearanceToken !== imageAppearanceToken || response.view !== selectedView || response.scale203 !== imageScaleBy203) return;
    const generation = imageGeneration;
    const requestId = imageRequestId;
    const url = URL.createObjectURL(new Blob([response.png], { type: "image/png" }));
    const decoded = new Image();
    decoded.src = url;
    try {
      await decoded.decode();
    } catch {
      URL.revokeObjectURL(url);
      setImageTransformBusy(false);
      imageSetStatus("Display transform could not be decoded; previous image retained.", true);
      return;
    }
    if (generation !== imageGeneration || requestId !== imageRequestId || response.appearanceToken !== imageAppearanceToken || response.view !== selectedView || response.scale203 !== imageScaleBy203) {
      URL.revokeObjectURL(url);
      return;
    }
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = url;
    imagePreview.src = imagePreviewUrl;
    imagePreview.dataset.renderer = response.renderer;
    imagePreview.alt = `Loaded ${imageFormat.toUpperCase()} image (${imageWidth} × ${imageHeight})`;
    if (pendingImageAppearance?.token === response.appearanceToken && pendingImageAppearance.view === response.view && pendingImageAppearance.scale203 === response.scale203) {
      pendingImageAppearance.previewReady = true;
      finishImageAppearanceIfReady();
    }
    return;
  }
  if (response.kind === "sample") {
    if (response.token !== latestImageSampleToken) return;
    if (response.view !== selectedView || response.scale203 !== imageScaleBy203) return;
    imageViewport.dataset.sampleX = String(response.x);
    imageViewport.dataset.sampleY = String(response.y);
    imageViewport.dataset.sampleCount = String(response.points.length);
    imageViewport.dataset.sampleRejected = String(response.rejected);
    const points = response.points.map(point => ({ x: point.x, y: point.y }));
    const ellipse = covarianceEllipse(points);
    const meanCode = response.meanCode;
    void (async () => {
      const url = URL.createObjectURL(new Blob([response.loupe], { type: "image/png" }));
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        URL.revokeObjectURL(url);
        if (pendingImageAppearance?.sampleToken === response.token &&
          pendingImageAppearance.view === response.view && pendingImageAppearance.scale203 === response.scale203) {
          pendingImageAppearance.loupeReady = true;
          finishImageAppearanceIfReady();
        }
        return;
      }
      // Decode off-DOM, then atomically publish the direct image.  Keep the
      // active blob URL alive until the next replacement; revoking it
      // immediately after decode can make Safari discard the HDR resource
      // while it is still being presented.
      if (response.id !== imageRequestId || response.generation !== imageGeneration || response.token !== latestImageSampleToken || response.view !== selectedView || response.scale203 !== imageScaleBy203 || !imagePrepared) {
        URL.revokeObjectURL(url);
        return;
      }
      const previousUrl = imageLoupeUrl;
      imageLoupe.src = url;
      imageLoupe.alt = `Pixel loupe centered at ${response.x}, ${response.y}`;
      imageLoupeUrl = url;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      imageAnalysis = {
        x: response.x, y: response.y, sampleCount: response.points.length,
        rejectedCount: response.rejected, mean: response.mean,
        meanAcescg: response.meanAcescg, ellipse,
        loupe: { x: response.minX, y: response.minY, width: response.width, height: response.height },
      };
      imageAverage = meanCode[0] > 0.5 ? { j: meanCode[1], x: meanCode[2], y: meanCode[3] } : null;
      imageStats.textContent = `Center ${response.x}, ${response.y} · ${response.total} pixels sampled (${response.rejected} unavailable); mean J′ ${response.mean.j.toFixed(4)}, x′ ${response.mean.x.toFixed(4)}, y′ ${response.mean.y.toFixed(4)}`;
      updatePatchCandidate(false);
      drawIndicators();
      drawImageOverlay();
      if (pendingImageAppearance?.sampleToken === response.token &&
        pendingImageAppearance.view === response.view && pendingImageAppearance.scale203 === response.scale203) {
        pendingImageAppearance.loupeReady = true;
        finishImageAppearanceIfReady();
      }
    })();
  }
};

imageWorker.onerror = () => {
  setImageTransformBusy(false);
  imageSetStatus("Image decoder worker failed.", true);
};
imageLoadButton.addEventListener("click", () => imageFileInput.click());
function openImageOptions() {
  updateImageOptionsWarning();
  imageOptionsButton.setAttribute("aria-expanded", "true");
  if (typeof imageOptionsDialog.showModal === "function") imageOptionsDialog.showModal();
  else imageOptionsDialog.setAttribute("open", "");
  imageOptionsFocusPending = true;
  requestAnimationFrame(() => (imageGamutSelect.offsetParent ? imageGamutSelect : imageOptionsClose).focus());
}
function closeImageOptions() {
  if (imageOptionsDialog.open) imageOptionsDialog.close();
  else imageOptionsDialog.removeAttribute("open");
  imageOptionsButton.setAttribute("aria-expanded", "false");
  if (imageOptionsFocusPending) { imageOptionsFocusPending = false; imageOptionsButton.focus(); }
}
imageOptionsButton.addEventListener("click", openImageOptions);
imageOptionsClose.addEventListener("click", event => { event.preventDefault(); closeImageOptions(); });
imageOptionsDialog.addEventListener("click", event => { if (event.target === imageOptionsDialog) closeImageOptions(); });
imageOptionsDialog.addEventListener("cancel", event => { event.preventDefault(); closeImageOptions(); });
imageOptionsDialog.addEventListener("close", () => {
  imageOptionsButton.setAttribute("aria-expanded", "false");
  if (imageOptionsFocusPending) { imageOptionsFocusPending = false; imageOptionsButton.focus(); }
});
imageZoomButtons.forEach(button => button.addEventListener("click", () => setImageZoom(Number(button.dataset.imageZoom))));
imageFileInput.addEventListener("change", async () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;
  const format = detectImageFormat(file);
  if (!format) { imageSetStatus("Unsupported image format. Choose DNG, EXR, JPEG, PNG, HEIC, or HEIF.", true); return; }
  imageGeneration += 1;
  imageRequestId += 1;
  imageFile = file; imageFormat = format; imageSummary = undefined; imagePrepared = false;
  imageOptionsButton.disabled = false;
  imagePointerSet = false; imageAnalysis = null; imageAverage = null;
  imageZoom = 2;
  imageZoomButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.imageZoom === "2")));
  clearImageLoupe();
  imagePanel.hidden = false; imageViewport.dataset.ready = "false";
  imagePanel.dataset.ready = "false";
  setImageTransformBusy(false);
  imagePreview.removeAttribute("src");
  imagePreview.alt = "Loaded source image";
  imageStats.textContent = "";
  updatePatchCandidate(false);
  drawIndicators();
  imageGamutSelect.value = "embedded"; imageTransferSelect.value = "sRGB";
  imageScaleUserChanged = false;
  imageScaleBy203 = defaultImageScale203(format);
  imageScale203.checked = imageScaleBy203;
  imageGamutField.hidden = true;
  imageTransferField.hidden = true;
  imageSetStatus(`Inspecting ${file.name}…`);
  try {
    const bytes = await file.arrayBuffer();
    imageWorker.postMessage({ kind: "inspect", id: imageRequestId, generation: imageGeneration, format, bytes } satisfies ImageWorkerRequest, [bytes]);
  } catch (error) { imageSetStatus(error instanceof Error ? error.message : String(error), true); }
});
imageGamutSelect.addEventListener("change", () => { imageSetControlVisibility(imageSummary); updateImageOptionsWarning(); syncImageScaleDefault(); if (imageInterpretationReady()) imageRequestPrepare(); });
imageTransferSelect.addEventListener("change", () => { updateImageOptionsWarning(); syncImageScaleDefault(); if (imageInterpretationReady()) imageRequestPrepare(); });
imageScale203.addEventListener("change", () => {
  imageScaleUserChanged = true;
  imageScaleBy203 = imageScale203.checked;
  if (imagePrepared) {
    requestImagePreview();
    requestImageSample();
  }
});
imageViewport.addEventListener("pointerdown", event => {
  if (!imagePrepared || event.pointerType === "mouse" && event.button !== 0) return;
  if (event.pointerType === "mouse") {
    if (!imageTrackingActive) {
      imageTrackingActive = true; imagePointerLockFallback = false;
      imageViewport.classList.add("image-tracking"); imageViewport.dataset.tracking = "mouse-active";
      applyImageDesktopPointer(event);
      imageTouchLastTime = performance.now(); imageTouchVelocityX = 0; imageTouchVelocityY = 0;
      try {
        if (typeof imageViewport.requestPointerLock !== "function") {
          imagePointerLockFallback = true;
          imageViewport.dataset.pointerLock = "fallback";
        }
        const result = imageViewport.requestPointerLock?.();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => { imagePointerLockFallback = true; imageViewport.dataset.pointerLock = "fallback"; });
        }
      } catch { imagePointerLockFallback = true; imageViewport.dataset.pointerLock = "fallback"; }
    } else {
      finishImageTracking();
    }
    event.stopPropagation(); event.preventDefault(); return;
  }
  if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
  imageTouchPointerId = event.pointerId; imageTrackingActive = true; imageViewport.classList.add("image-tracking"); imageViewport.dataset.tracking = "touch-active";
  imageTouchLastX = event.clientX; imageTouchLastY = event.clientY; imageTouchLastTime = performance.now(); imageTouchVelocityX = 0; imageTouchVelocityY = 0;
  try { imageViewport.setPointerCapture(event.pointerId); } catch { /* best effort */ }
  event.preventDefault();
});
document.addEventListener("pointermove", event => {
  if (!imageTrackingActive || event.pointerType !== "mouse") return;
  if (!imagePointerLockActive || document.pointerLockElement !== imageViewport) applyImageDesktopPointer(event);
});
// Pointer Lock reports relative movement through `mousemove`, not
// `pointermove`; keep this separate from the visible-pointer fallback above.
document.addEventListener("mousemove", event => {
  if (!imageTrackingActive || !imagePointerLockActive || document.pointerLockElement !== imageViewport) return;
  applyImageLockedMotion(event);
});
document.addEventListener("pointerdown", event => {
  if (imageTrackingActive && event.pointerType === "mouse" && event.button === 0 && !imageViewport.contains(event.target as Node)) {
    finishImageTracking(); event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
document.addEventListener("pointerlockchange", () => {
  imagePointerLockActive = document.pointerLockElement === imageViewport;
  imageViewport.classList.toggle("pointer-lock-active", imagePointerLockActive);
  imageViewport.dataset.pointerLock = imagePointerLockActive ? "active" : (imagePointerLockFallback ? "fallback" : "none");
  if (!imagePointerLockActive && imageTrackingActive && !imagePointerLockFallback) finishImageTracking();
});
document.addEventListener("pointerlockerror", () => {
  if (imageTrackingActive) { imagePointerLockFallback = true; imageViewport.dataset.pointerLock = "fallback"; }
});
imageViewport.addEventListener("pointermove", event => {
  if ((event.pointerType !== "touch" && event.pointerType !== "pen") || event.pointerId !== imageTouchPointerId) return;
  const now = performance.now(); const elapsed = Math.max(1, now - imageTouchLastTime);
  const dx = event.clientX - imageTouchLastX, dy = event.clientY - imageTouchLastY;
  const velocity = rollingBallVelocity({ x: imageTouchVelocityX, y: imageTouchVelocityY }, dx, dy, imageViewport.clientWidth, imageViewport.clientHeight, elapsed);
  imageTouchVelocityX = velocity.x; imageTouchVelocityY = velocity.y; imageTouchLastX = event.clientX; imageTouchLastY = event.clientY; imageTouchLastTime = now;
  const acceleration = rollingBallAcceleration(Math.hypot(velocity.x, velocity.y));
  applyImageRelativeDelta(dx * acceleration, dy * acceleration);
  event.preventDefault();
});
imageViewport.addEventListener("pointerup", event => { if (event.pointerId === imageTouchPointerId) finishImageTracking(); });
imageViewport.addEventListener("pointercancel", event => { if (event.pointerId === imageTouchPointerId) finishImageTracking(); });

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
    if (imageTrackingActive) finishImageTracking();
  }
});
let previewPointerId: number | null = null;
let previewStartX = 0;
let previewStartY = 0;
let previewLastY = 0;
let previewLastTime = 0;
let previewVelocityX = 0;
let previewVelocityY = 0;
let previewDragging = false;
function finishPreviewDrag() {
  if (previewPointerId === null) return;
  try { if (preview.hasPointerCapture?.(previewPointerId)) preview.releasePointerCapture(previewPointerId); } catch { /* best effort */ }
  previewPointerId = null;
  previewDragging = false;
  previewVelocityX = previewVelocityY = 0;
  backgroundTracking = false;
  preview.dataset.tracking = "idle";
}
function applyPreviewDrag(event: PointerEvent) {
  if (previewPointerId === null || event.pointerId !== previewPointerId) return;
  const now = performance.now();
  const elapsed = Math.max(1, now - previewLastTime);
  const dx = event.clientX - previewStartX;
  const dy = event.clientY - previewLastY;
  previewStartX = event.clientX;
  previewLastY = event.clientY;
  const velocity = rollingBallVelocity({ x: previewVelocityX, y: previewVelocityY }, dx, dy, preview.clientWidth || 1, preview.clientHeight || 1, elapsed);
  previewVelocityX = velocity.x; previewVelocityY = velocity.y; previewLastTime = now;
  if (!previewDragging && Math.abs(event.clientY - previewStartY) < 6) return;
  previewDragging = true;
  preview.dataset.tracking = "active";
  const acceleration = rollingBallAcceleration(Math.hypot(velocity.x, velocity.y));
  const next = rollingWheelDelta(backgroundJ, dy, preview.clientHeight || 1, ROLLING_BALL_SENSITIVITY, acceleration);
  backgroundJ = next;
  if (backgroundSnap !== null && Math.abs(backgroundJ - backgroundSnap) <= 0.02) backgroundJ = backgroundSnap;
  invalidatePendingSet();
  updateBackground();
  schedule();
  event.preventDefault();
}
preview.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (previewPointerId !== null) return;
  previewPointerId = event.pointerId;
  backgroundTracking = true;
  previewStartX = event.clientX; previewStartY = event.clientY; previewLastY = event.clientY;
  previewLastTime = performance.now(); previewVelocityX = previewVelocityY = 0; previewDragging = false;
  if (event.pointerType !== "mouse") { try { preview.setPointerCapture(event.pointerId); } catch { /* best effort */ } }
  event.preventDefault();
});
preview.addEventListener("pointermove", applyPreviewDrag);
preview.addEventListener("pointerup", event => {
  if (event.pointerId !== previewPointerId) return;
  const dragged = previewDragging;
  finishPreviewDrag();
  if (dragged) { backgroundSuppressClick = true; window.setTimeout(() => { backgroundSuppressClick = false; }, 300); }
  else if (event.pointerType !== "mouse") openViewMenu();
});
preview.addEventListener("pointercancel", finishPreviewDrag);
document.addEventListener("pointermove", event => {
  if (previewPointerId !== null && event.pointerType === "mouse") applyPreviewDrag(event);
});
preview.addEventListener("click", event => {
  if (backgroundSuppressClick) { event.preventDefault(); event.stopPropagation(); return; }
  openViewMenu();
});
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
  updateImageGeometry();
  drawImageOverlay();
  // Grid track sizes settle after the resize event.  A queued task catches
  // browsers that deliver ResizeObserver after the next layout read.
  window.setTimeout(() => updateJWheelVisual(), 0);
});
// Resize events can fire before the grid has applied its new track size.  The
// observer runs after layout, ensuring the free wheel texture is rescaled to
// the actual companion height rather than the stale pre-resize height.
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => updateJWheelVisual()).observe(jWheel);
}
window.addEventListener("pagehide", () => {
  pageClosed = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (sliceUrl) URL.revokeObjectURL(sliceUrl);
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  if (imageLoupeUrl) URL.revokeObjectURL(imageLoupeUrl);
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
imageViewport.dataset.tracking = "idle";
jReferenceTick.style.bottom = `${J_REFERENCE_WHITE * 100}%`;
jReferenceTick.title = `203 nits HDR white — J\u2032 ${J_REFERENCE_WHITE.toFixed(6)}`;
backgroundJ = 0.15;
updateBackground();
requestPatches();
requestEvaluate();
requestRender();
