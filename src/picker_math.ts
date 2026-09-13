export const PATCH_ENTRY_RADIUS = 0.02;
export const PATCH_SNAP_DISTANCE = 0.005;
export const J_SNAP_DISTANCE = 0.005;
// Background is a normalized J' neutral coordinate.
export const BACKGROUND_MAX = 1.0;
export const J_HK_PEAK = 217.2768649129496;
export const J_REFERENCE_WHITE = 76.02655940839014 / J_HK_PEAK;
export const ROLLING_BALL_SENSITIVITY = 0.25;
export const ROLLING_BALL_MAX_ACCELERATION = 4;
export const ROLLING_BALL_ACCELERATION_SPEED = 2.5;
export const ROLLING_BALL_VELOCITY_SMOOTHING_MS = 45;

export type Point = { x: number; y: number };
export type SnapCandidate =
  | { kind: "neutral"; x: number; y: number }
  | { kind: "patch"; index: number; x: number; y: number };
export type JSnapTarget =
  | { kind: "reference"; value: number }
  | { kind: "patch"; value: number };
export type SnapAxis = "j" | "xy" | null;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : minimum;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function slicePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Point {
  const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 1;
  const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 1;
  return {
    x: clamp01((clientX - rect.left) / width),
    y: clamp01(1 - (clientY - rect.top) / height),
  };
}

export function rollingWheelDelta(
  j: number,
  deltaY: number,
  height: number,
  sensitivity = ROLLING_BALL_SENSITIVITY,
  acceleration = 1,
): number {
  const scale = Number.isFinite(height) && height > 0 ? height : 1;
  const factor = Number.isFinite(sensitivity)
    ? sensitivity
    : ROLLING_BALL_SENSITIVITY;
  const speedFactor = Number.isFinite(acceleration)
    ? Math.max(0, Math.min(ROLLING_BALL_MAX_ACCELERATION, acceleration))
    : 1;
  return clamp01(j - (deltaY / scale) * factor * speedFactor);
}

export function rollingBallDelta(
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
  sensitivity = ROLLING_BALL_SENSITIVITY,
  acceleration = 1,
): Point {
  const scaleX = Number.isFinite(width) && width > 0 ? width : 1;
  const scaleY = Number.isFinite(height) && height > 0 ? height : 1;
  const factor = Number.isFinite(sensitivity) ? sensitivity : ROLLING_BALL_SENSITIVITY;
  const speedFactor = Number.isFinite(acceleration)
    ? Math.max(0, Math.min(ROLLING_BALL_MAX_ACCELERATION, acceleration))
    : 1;
  return {
    x: clamp01(x + (deltaX / scaleX) * factor * speedFactor),
    y: clamp01(y - (deltaY / scaleY) * factor * speedFactor),
  };
}

export function rollingBallAcceleration(normalizedSpeed: number): number {
  const speed = Math.max(0, Number.isFinite(normalizedSpeed) ? normalizedSpeed : 0);
  return Math.min(
    ROLLING_BALL_MAX_ACCELERATION,
    1 + (ROLLING_BALL_MAX_ACCELERATION - 1) *
      (1 - Math.exp(-speed / ROLLING_BALL_ACCELERATION_SPEED)),
  );
}

export function rollingBallVelocity(
  previous: Point,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
  elapsedMs: number,
  smoothingMs = ROLLING_BALL_VELOCITY_SMOOTHING_MS,
): Point {
  const scaleX = Number.isFinite(width) && width > 0 ? width : 1;
  const scaleY = Number.isFinite(height) && height > 0 ? height : 1;
  const elapsed = Math.max(1, Number.isFinite(elapsedMs) ? elapsedMs : 1);
  const smoothing = Math.max(
    1,
    Number.isFinite(smoothingMs)
      ? smoothingMs
      : ROLLING_BALL_VELOCITY_SMOOTHING_MS,
  );
  const alpha = 1 - Math.exp(-elapsed / smoothing);
  const rawX = (deltaX / scaleX) * (1000 / elapsed);
  const rawY = (deltaY / scaleY) * (1000 / elapsed);
  return {
    x: previous.x + (rawX - previous.x) * alpha,
    y: previous.y + (rawY - previous.y) * alpha,
  };
}

export function canvasPoint(
  x: number,
  y: number,
  size: number,
): [number, number] {
  const extent = Math.max(0, size - 1);
  return [clamp01(x) * extent, (1 - clamp01(y)) * extent];
}

export function patchCandidate(
  x: number,
  y: number,
  patches: readonly Point[],
): number | null {
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  patches.forEach((patch, index) => {
    const distance = Math.hypot(x - patch.x, y - patch.y);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearestDistance <= PATCH_ENTRY_RADIUS ? nearest : null;
}

export function nearestPoint(
  x: number,
  y: number,
  points: readonly Point[],
): { index: number; distance: number } | null {
  let nearest: { index: number; distance: number } | null = null;
  points.forEach((point, index) => {
    const distance = Math.hypot(x - point.x, y - point.y);
    if (nearest === null || distance < nearest.distance)
      nearest = { index, distance };
  });
  return nearest;
}

/** Select the nearest ColorChecker/neutral target only while inside the entry halo. */
export function nearestSnapTarget(
  x: number,
  y: number,
  patches: readonly Point[],
  neutral: Point = { x: 0.5, y: 0.5 },
): SnapCandidate | null {
  const nearestPatch = nearestPoint(x, y, patches);
  const neutralDistance = Math.hypot(x - neutral.x, y - neutral.y);
  if (
    neutralDistance <= PATCH_ENTRY_RADIUS &&
    (nearestPatch === null || neutralDistance <= nearestPatch.distance)
  ) {
    return { kind: "neutral", x: neutral.x, y: neutral.y };
  }
  if (nearestPatch && nearestPatch.distance <= PATCH_ENTRY_RADIUS) {
    const patch = patches[nearestPatch.index];
    return {
      kind: "patch",
      index: nearestPatch.index,
      x: patch.x,
      y: patch.y,
    };
  }
  return null;
}

/** Select the nearest J target: the active patch, when present, and reference white. */
export function nearestJSnapTarget(
  j: number,
  patchJ?: number,
  referenceJ = J_REFERENCE_WHITE,
  threshold = J_SNAP_DISTANCE,
): JSnapTarget | null {
  const candidates: JSnapTarget[] = [];
  if (Number.isFinite(patchJ)) candidates.push({ kind: "patch", value: patchJ as number });
  if (Number.isFinite(referenceJ)) candidates.push({ kind: "reference", value: referenceJ });
  let nearest: JSnapTarget | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(j - candidate.value);
    // Keep patch-first ordering on an exact tie.
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest && nearestDistance <= threshold ? nearest : null;
}

export function snapCartesianPoint(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  threshold = PATCH_SNAP_DISTANCE,
): Point {
  return Math.hypot(x - targetX, y - targetY) <= threshold
    ? { x: targetX, y: targetY }
    : { x, y };
}

export function projectSnapCode(
  real: { j: number; x: number; y: number },
  target: SnapCandidate | null,
  patchJ?: number,
  axis: SnapAxis = null,
  previous = real,
): { j: number; x: number; y: number } {
  const projected = axis === null ? { ...real } : { ...previous };
  if (axis === "j") projected.j = real.j;
  else if (axis === "xy") {
    projected.x = real.x;
    projected.y = real.y;
  }
  if (axis !== "xy") {
    const jTarget = nearestJSnapTarget(
      real.j,
      target?.kind === "patch" ? patchJ : undefined,
    );
    if (jTarget) projected.j = jTarget.value;
  }
  if (target && axis !== "j") {
    const snapped = snapCartesianPoint(real.x, real.y, target.x, target.y);
    projected.x = snapped.x;
    projected.y = snapped.y;
  }
  return projected;
}

export function snapCoordinate(
  value: number,
  target: number,
  threshold = PATCH_SNAP_DISTANCE,
): number {
  return Math.abs(value - target) <= threshold ? target : value;
}

export function encodeSrgb(value: number): number {
  const linear = Math.max(0, value);
  return linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055;
}

export function decodeSrgb(value: number): number {
  const encoded = Math.max(0, value);
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

export function backgroundSliderPosition(value: number): number {
  return clamp(value, 0, BACKGROUND_MAX);
}

export function backgroundFromSlider(position: number): number {
  return clamp01(position);
}
