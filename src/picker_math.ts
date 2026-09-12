export const PATCH_ENTRY_RADIUS = 0.06;
export const PATCH_RELEASE_RADIUS = 0.075;
export const PATCH_SNAP_DISTANCE = 0.015;
export const BACKGROUND_MAX = 1.2;

export type Point = { x: number; y: number };

export function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : minimum;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
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
  active: number | null,
): number | null {
  if (active !== null && patches[active]) {
    const selected = patches[active];
    if (Math.hypot(x - selected.x, y - selected.y) <= PATCH_RELEASE_RADIUS) {
      return active;
    }
  }
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

export function snapCoordinate(value: number, target: number): number {
  return Math.abs(value - target) <= PATCH_SNAP_DISTANCE ? target : value;
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
  return encodeSrgb(clamp(value, 0, BACKGROUND_MAX) / BACKGROUND_MAX);
}

export function backgroundFromSlider(position: number): number {
  return decodeSrgb(clamp01(position)) * BACKGROUND_MAX;
}
