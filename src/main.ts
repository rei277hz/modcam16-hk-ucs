import "./style.css";
import {
  PATCH_ENTRY_RADIUS,
  backgroundFromSlider as decodeBackgroundSlider,
  backgroundSliderPosition,
  canvasPoint,
  clamp01,
  patchCandidate,
  snapCoordinate,
} from "./picker_math";

const FULL = 512;
const PREVIEW = 64;
const WORKERS = Math.max(1, Math.min(12, navigator.hardwareConcurrency || 2));
const PROFILES = [0, 1, 2, 3, 4] as const;
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
type RenderResponse = {
  kind: "render";
  id: number;
  profile: number;
  width: number;
  height: number;
  yStart: number;
  pixels: Uint8Array;
};
type EvaluateResponse = {
  kind: "evaluate";
  id: number;
  profile: number;
  j: number;
  saturationX: number;
  saturationY: number;
  background: number;
  values: Float64Array;
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
  background?: number;
  backgroundPreserved?: boolean;
};
type WorkerError = {
  kind: "worker-error";
  id: number;
  operation: string;
  profile?: number;
};

const $ = <T extends Element>(selector: string) =>
  document.querySelector<T>(selector)!;
const canvas = $("#gamut-slice") as HTMLCanvasElement;
const indicators = $("#gamut-indicators") as HTMLCanvasElement;
const plotFrame = $(".plot-frame") as HTMLElement;
const plotStatus = $("#plot-status") as HTMLElement;
const profileSelect = $("#profile") as HTMLSelectElement;
const jRange = $("#j-code") as HTMLInputElement;
const xRange = $("#saturation-x") as HTMLInputElement;
const yRange = $("#saturation-y") as HTMLInputElement;
const jNumber = $("#j-number") as HTMLInputElement;
const xNumber = $("#x-number") as HTMLInputElement;
const yNumber = $("#y-number") as HTMLInputElement;
const backgroundRange = $("#background-brightness") as HTMLInputElement;
const backgroundValue = $("#background-brightness-value") as HTMLElement;
const backgroundStick = $("#background-stick") as HTMLElement;
const preview = $("#preview") as HTMLElement;
const previewSurround = $("#preview-surround") as HTMLElement;
const linearLabel = $("#rgb-label") as HTMLElement;
const linearValue = $("#linear-value") as HTMLElement;
const encodedLabel = $("#encoded-label") as HTMLElement;
const encodedValue = $("#encoded-value") as HTMLInputElement;
const copyValue = $("#copy-value") as HTMLButtonElement;
const setValue = $("#set-value") as HTMLButtonElement;
const checkerName = $("#colorchecker-name") as HTMLElement;
const jStick = $("#j-stick") as HTMLElement;
const xStick = $("#x-stick") as HTMLElement;
const yStick = $("#y-stick") as HTMLElement;

function displayP3Context(target: HTMLCanvasElement): CanvasRenderingContext2D {
  try {
    const candidate = target.getContext("2d", { colorSpace: "display-p3" });
    if (candidate) return candidate;
  } catch {
    // Engines predating canvas color-space selection throw here.
  }
  const fallback = target.getContext("2d");
  if (!fallback) throw new Error("A 2D canvas context is required.");
  return fallback;
}

let context = displayP3Context(canvas);
const indicatorContext = displayP3Context(indicators);
let displayP3Canvas = false;
try {
  displayP3Canvas = context.getContextAttributes().colorSpace === "display-p3";
} catch {
  displayP3Canvas = false;
}
let image = new ImageData(FULL, FULL);
let imageKey = "";
let renderId = 0;
let evaluationId = 0;
let checkerId = 0;
let setId = 0;
let currentRender:
  | {
      id: number;
      key: string;
      width: number;
      height: number;
      pixels: Uint8ClampedArray;
      pending: Set<number>;
    }
  | undefined;
let currentPatches: Patch[] = [];
let activePatch: number | null = null;
let activeAxis: "j" | "x" | "y" | null = null;
let retainedLinear: [number, number, number] = [0, 0, 0];
let sliderProfile = 3;
let backgroundSnap: number | null = null;
let canonicalLocked = false;
let framePending = false;
let queuedFullRender = false;

const workers = Array.from(
  { length: WORKERS },
  () =>
    new Worker(new URL("./render_worker.ts", import.meta.url), {
      type: "module",
    }),
);
const checkerWorker = workers[workers.length - 1];

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
function currentCode(): Code {
  return {
    j: clamp01(Number(jRange.value)),
    x: clamp01(Number(xRange.value)),
    y: clamp01(Number(yRange.value)),
  };
}
function currentProfile() {
  const p = Number(profileSelect.value);
  return PROFILES.includes(p as (typeof PROFILES)[number]) ? p : 3;
}
function profileP3(profile = currentProfile()) {
  return profile !== 1 && profile !== 3;
}
function useDisplayP3(profile = currentProfile()) {
  return profileP3(profile) && displayP3Canvas;
}
function directProfile(profile = currentProfile()) {
  return profile === 3;
}
function stateKey(profile: number, code = currentCode()) {
  return `${profile}|${code.j.toFixed(8)}`;
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
function setColor(
  element: HTMLElement,
  values: ArrayLike<number>,
  fallback = values,
) {
  const p3 = Array.from(values, (value) => clamp01(Number(value)));
  const srgb = Array.from(fallback, (value) => clamp01(Number(value)));
  element.style.backgroundColor = `rgb(${srgb.map((value) => Math.round(value * 255)).join(" ")})`;
  if (
    profileP3() &&
    displayP3Canvas &&
    CSS.supports("background-color", "color(display-p3 1 0 0)")
  )
    element.style.backgroundColor = `color(display-p3 ${p3.join(" ")})`;
}
function backgroundFromSlider() {
  return decodeBackgroundSlider(Number(backgroundRange.value));
}
function updateBackground() {
  const value = backgroundFromSlider();
  backgroundValue.textContent = value.toFixed(3);
  const gray = clamp01(backgroundSliderPosition(value));
  setColor(previewSurround, [gray, gray, gray], [gray, gray, gray]);
}
function setCode(axis: keyof Code, value: number) {
  const target = clamp01(value);
  const input = axis === "j" ? jRange : axis === "x" ? xRange : yRange;
  const number = axis === "j" ? jNumber : axis === "x" ? xNumber : yNumber;
  input.value = target.toString();
  if (document.activeElement !== number) number.value = target.toFixed(6);
}
function syncNumbers() {
  const code = currentCode();
  setCode("j", code.j);
  setCode("x", code.x);
  setCode("y", code.y);
}
function drawIndicators() {
  if (imageKey !== stateKey(currentProfile())) return;
  const code = currentCode();
  indicatorContext.clearRect(0, 0, indicators.width, indicators.height);
  const scale = indicators.width;
  const point = (x: number, y: number) => canvasPoint(x, y, scale);
  indicatorContext.save();
  indicatorContext.strokeStyle = "rgb(255 255 255 / 55%)";
  indicatorContext.lineWidth = 2;
  const [cx, cy] = point(code.x, code.y);
  indicatorContext.beginPath();
  indicatorContext.arc(cx, cy, 7, 0, Math.PI * 2);
  indicatorContext.stroke();
  indicatorContext.strokeStyle = "rgb(255 255 255 / 22%)";
  const [nx, ny] = point(0.5, 0.5);
  indicatorContext.beginPath();
  indicatorContext.moveTo(nx - 8, ny);
  indicatorContext.lineTo(nx + 8, ny);
  indicatorContext.moveTo(nx, ny - 8);
  indicatorContext.lineTo(nx, ny + 8);
  indicatorContext.stroke();
  for (const patch of currentPatches) {
    const [px, py] = point(patch.x, patch.y);
    indicatorContext.fillStyle = useDisplayP3()
      ? `color(display-p3 ${patch.p3.join(" ")})`
      : `rgb(${patch.srgb.map((v) => Math.round(clamp01(v) * 255)).join(" ")})`;
    indicatorContext.beginPath();
    indicatorContext.arc(px, py, 3.5, 0, Math.PI * 2);
    indicatorContext.fill();
  }
  if (activePatch !== null && currentPatches[activePatch]) {
    const patch = currentPatches[activePatch];
    const [px, py] = point(patch.x, patch.y);
    indicatorContext.strokeStyle = "rgb(190 220 255 / 38%)";
    indicatorContext.lineWidth = 2;
    indicatorContext.beginPath();
    indicatorContext.arc(px, py, PATCH_ENTRY_RADIUS * scale, 0, Math.PI * 2);
    indicatorContext.stroke();
  }
  indicatorContext.restore();
}
function updatePatchLocators() {
  const patch = activePatch === null ? undefined : currentPatches[activePatch];
  for (const [element, value] of [
    [jStick, patch?.j],
    [xStick, patch?.x],
    [yStick, patch?.y],
  ] as const) {
    element.hidden = value === undefined;
    if (value !== undefined) element.style.left = `${value * 100}%`;
  }
  checkerName.hidden = !patch;
  checkerName.textContent = patch?.name ?? "";
}
function updatePatchCandidate() {
  const code = currentCode();
  activePatch = patchCandidate(code.x, code.y, currentPatches, activePatch);
  updatePatchLocators();
  drawIndicators();
}
function snapAxis(axis: "j" | "x" | "y") {
  updatePatchCandidate();
  if (activePatch === null) return;
  const patch = currentPatches[activePatch];
  const code = currentCode();
  const value = code[axis];
  const target = patch[axis];
  const snapped = snapCoordinate(value, target);
  setCode(axis, snapped);
  if (snapped === target && value !== target) {
    const number = axis === "j" ? jNumber : axis === "x" ? xNumber : yNumber;
    number.value = target.toFixed(6);
  }
  updatePatchCandidate();
}
function displayValues(values: Float64Array) {
  const p3 = profileP3();
  const evaluatedLinear = [values[1], values[2], values[3]] as [
    number,
    number,
    number,
  ];
  const evaluatedFinite = evaluatedLinear.every(Number.isFinite);
  if (!canonicalLocked && evaluatedFinite) retainedLinear = evaluatedLinear;
  const linear =
    canonicalLocked || !evaluatedFinite ? retainedLinear : evaluatedLinear;
  const encoded = canonicalLocked
    ? (linear.map((value) =>
        value <= 0.0031308
          ? 12.92 * value
          : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055,
      ) as [number, number, number])
    : [values[10], values[11], values[12]].every(Number.isFinite)
      ? ([values[10], values[11], values[12]] as [number, number, number])
      : (linear.map((value) =>
          value <= 0.0031308
            ? 12.92 * value
            : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055,
        ) as [number, number, number]);
  const display = (
    p3 ? [values[4], values[5], values[6]] : [values[7], values[8], values[9]]
  ) as [number, number, number];
  const displaySrgb = [values[7], values[8], values[9]] as [
    number,
    number,
    number,
  ];
  linearLabel.innerHTML = directProfile()
    ? "Linear Rec.709 (sRGB)<sup>*</sup>"
    : "ACEScg<sup>*</sup>";
  encodedLabel.textContent = directProfile()
    ? "sRGB Encoded Rec.709 (sRGB)"
    : "sRGB Encoded AP1";
  encodedValue.setAttribute(
    "aria-label",
    directProfile()
      ? "Six sRGB Encoded Rec.709 hexadecimal digits"
      : "Six sRGB Encoded ACEScg AP1 hexadecimal digits",
  );
  linearValue.textContent = formatRgb(linear);
  if (document.activeElement !== encodedValue)
    encodedValue.value = encodeHex(encoded);
  preview.classList.toggle("preview-unavailable", values[0] <= 0.5);
  if (values[0] > 0.5) setColor(preview, display, displaySrgb);
  else preview.style.backgroundColor = "#000";
  const bgP3 = [values[13], values[14], values[15]];
  const bgSrgb = [values[16], values[17], values[18]];
  backgroundValue.textContent = backgroundFromSlider().toFixed(3);
  setColor(previewSurround, bgP3, bgSrgb);
  backgroundSnap = finite(values[19], 0);
  backgroundStick.hidden = false;
  backgroundStick.style.left = `${backgroundSliderPosition(backgroundSnap) * 100}%`;
  drawIndicators();
}
function requestEvaluate() {
  const code = currentCode();
  const id = ++evaluationId;
  workers[0].postMessage({
    kind: "evaluate",
    id,
    profile: currentProfile(),
    j: code.j,
    saturationX: code.x,
    saturationY: code.y,
    background: backgroundFromSlider(),
  });
}
function requestRender() {
  const size = activeAxis === "j" ? PREVIEW : FULL;
  const profile = currentProfile();
  const code = currentCode();
  const key = stateKey(profile, code);
  if (imageKey === key && canvas.width === size) {
    drawIndicators();
    return;
  }
  plotFrame.setAttribute("aria-busy", "true");
  if (currentRender)
    workers.forEach((worker) =>
      worker.postMessage({ kind: "cancel-render", id: currentRender!.id }),
    );
  const id = ++renderId;
  const pending = new Set<number>();
  const pixels = new Uint8ClampedArray(size * size * 4);
  const rows = Math.ceil(size / workers.length);
  currentRender = { id, key, width: size, height: size, pixels, pending };
  workers.forEach((worker, index) => {
    const yStart = Math.min(size, index * rows);
    const yEnd = Math.min(size, yStart + rows);
    if (yStart >= yEnd) return;
    pending.add(index);
    worker.postMessage({
      kind: "render",
      id,
      profile,
      j: code.j,
      width: size,
      height: size,
      yStart,
      yEnd,
      displayP3: useDisplayP3(profile),
    });
  });
}
function schedule(full = false) {
  if (full) {
    activeAxis = null;
    queuedFullRender = true;
  } else if (activeAxis === "j") {
    // A newer J interaction supersedes a full-resolution request queued by
    // an earlier control settlement in the same animation frame.
    queuedFullRender = false;
  }
  updateBackground();
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    if (queuedFullRender) activeAxis = null;
    queuedFullRender = false;
    requestEvaluate();
    requestRender();
  });
}
function parsePatches(values: Float64Array, profile: number) {
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
  updatePatchCandidate();
}
function requestPatches() {
  currentPatches = [];
  activePatch = null;
  updatePatchLocators();
  drawIndicators();
  const id = ++checkerId;
  checkerWorker.postMessage({
    kind: "colorchecker",
    id,
    profile: currentProfile(),
  });
}
function profileSwitch() {
  const target = currentProfile();
  if (target === sliderProfile) return;
  const linear = retainedLinear;
  const id = ++setId;
  const acescg = sliderProfile !== 3;
  workers[0].postMessage({
    kind: "set",
    id,
    profile: target,
    red: linear[0],
    green: linear[1],
    blue: linear[2],
    acescg,
    sourceProfile: sliderProfile,
    linear: true,
    sourceJ: currentCode().j,
    background: backgroundFromSlider(),
  });
  plotStatus.hidden = false;
  plotStatus.textContent = "Converting profile…";
  requestPatches();
}
function setFromHex() {
  const decoded = decodeHex(encodedValue.value);
  if (!decoded) {
    encodedValue.setCustomValidity("Enter exactly six hexadecimal digits.");
    encodedValue.reportValidity();
    return;
  }
  encodedValue.setCustomValidity("");
  const id = ++setId;
  workers[0].postMessage({
    kind: "set",
    id,
    profile: currentProfile(),
    red: decoded[0],
    green: decoded[1],
    blue: decoded[2],
    acescg: currentProfile() !== 3,
  });
}

workers.forEach((worker, workerIndex) => {
  worker.onmessage = (
    event: MessageEvent<
      | RenderResponse
      | EvaluateResponse
      | ColorCheckerResponse
      | SetResponse
      | WorkerError
    >,
  ) => {
    const response = event.data;
    if (response.kind === "worker-error") {
      const current =
        response.profile === currentProfile() &&
        ((response.operation === "render" &&
          response.id === currentRender?.id) ||
          (response.operation === "evaluate" && response.id === evaluationId) ||
          (response.operation === "colorchecker" &&
            response.id === checkerId) ||
          (response.operation === "set" && response.id === setId));
      if (!current) return;
      if (response.operation === "render") {
        currentRender = undefined;
        plotFrame.setAttribute("aria-busy", "false");
      }
      plotStatus.hidden = false;
      plotStatus.textContent = "Color engine error";
      return;
    }
    if (response.kind === "colorchecker") {
      if (response.id === checkerId && response.profile === currentProfile())
        parsePatches(response.points, response.profile);
      return;
    }
    if (response.kind === "set") {
      if (
        response.id !== setId ||
        response.profile !== currentProfile() ||
        response.values.length < 4
      )
        return;
      setCode("j", response.values[1]);
      setCode("x", response.values[2]);
      setCode("y", response.values[3]);
      if (
        response.values.length >= 7 &&
        response.values.slice(4, 7).every(Number.isFinite)
      ) {
        retainedLinear = [
          response.values[4],
          response.values[5],
          response.values[6],
        ];
        canonicalLocked = true;
      }
      if (
        response.background !== undefined &&
        Number.isFinite(response.background)
      )
        backgroundRange.value = backgroundSliderPosition(
          response.background,
        ).toString();
      sliderProfile = response.profile;
      if (response.values[0] > 0.5) updatePatchCandidate();
      else {
        activePatch = null;
        updatePatchLocators();
        drawIndicators();
      }
      schedule(true);
      return;
    }
    if (response.kind === "evaluate") {
      if (response.id !== evaluationId || response.profile !== currentProfile())
        return;
      const code = currentCode();
      if (
        response.j !== code.j ||
        response.saturationX !== code.x ||
        response.saturationY !== code.y ||
        Math.abs(response.background - backgroundFromSlider()) > 1e-12
      )
        return;
      displayValues(response.values);
      return;
    }
    if (response.kind === "render") {
      const render = currentRender;
      if (
        !render ||
        response.id !== render.id ||
        response.profile !== currentProfile() ||
        response.width !== render.width ||
        response.height !== render.height
      )
        return;
      const rows = Math.ceil(render.height / workers.length);
      const expectedStart = workerIndex * rows;
      const expectedLength =
        Math.max(
          0,
          Math.min(render.height, expectedStart + rows) - expectedStart,
        ) *
        render.width *
        4;
      if (
        response.yStart !== expectedStart ||
        response.pixels.length !== expectedLength ||
        !render.pending.delete(workerIndex)
      )
        return;
      render.pixels.set(response.pixels, response.yStart * render.width * 4);
      if (render.pending.size === 0) {
        try {
          image = new ImageData(render.width, render.height, {
            colorSpace: useDisplayP3() ? "display-p3" : "srgb",
          });
        } catch {
          image = new ImageData(render.width, render.height);
          displayP3Canvas = false;
        }
        image.data.set(render.pixels);
        canvas.width = render.width;
        canvas.height = render.height;
        context = displayP3Context(canvas);
        context.putImageData(image, 0, 0);
        imageKey = render.key;
        currentRender = undefined;
        drawIndicators();
        plotFrame.setAttribute("aria-busy", "false");
        plotStatus.hidden = true;
      }
    }
  };
});

function connectRange(
  range: HTMLInputElement,
  number: HTMLInputElement,
  axis: "j" | "x" | "y",
) {
  range.addEventListener("input", () => {
    canonicalLocked = false;
    activeAxis = axis;
    snapAxis(axis);
    schedule(axis === "j" ? false : true);
  });
  range.addEventListener("change", () => {
    activeAxis = null;
    schedule(true);
  });
  number.addEventListener("input", () => {
    if (!number.value.trim()) return;
    const value = Number(number.value);
    if (Number.isFinite(value)) {
      canonicalLocked = false;
      setCode(axis, value);
      activeAxis = axis;
      snapAxis(axis);
      schedule(axis === "j" ? false : true);
    }
  });
  number.addEventListener("change", () => {
    const value = Number(number.value);
    if (Number.isFinite(value)) {
      canonicalLocked = false;
      setCode(axis, value);
    } else syncNumbers();
    activeAxis = null;
    schedule(true);
  });
}
connectRange(jRange, jNumber, "j");
connectRange(xRange, xNumber, "x");
connectRange(yRange, yNumber, "y");
backgroundRange.addEventListener("input", () => {
  if (
    backgroundSnap !== null &&
    Math.abs(backgroundFromSlider() - backgroundSnap) <= 0.02 * 1.2
  ) {
    backgroundRange.value = backgroundSliderPosition(backgroundSnap).toString();
  }
  schedule(false);
});
backgroundRange.addEventListener("change", () => schedule(true));
profileSelect.addEventListener("change", profileSwitch);
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

syncNumbers();
updateBackground();
requestPatches();
requestEvaluate();
requestRender();
