import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_MAX,
  PATCH_ENTRY_RADIUS,
  PATCH_RELEASE_RADIUS,
  PATCH_SNAP_DISTANCE,
  backgroundFromSlider,
  backgroundSliderPosition,
  canvasPoint,
  patchCandidate,
  snapCoordinate,
} from "../src/picker_math.ts";

test("Cartesian canvas mapping keeps Y upward", () => {
  assert.deepEqual(canvasPoint(0, 0, 512), [0, 511]);
  assert.deepEqual(canvasPoint(1, 1, 512), [511, 0]);
  assert.deepEqual(canvasPoint(0.5, 0.5, 513), [256, 256]);
});

test("candidate entry uses 0.060 and release uses 0.075", () => {
  const patches = [
    { x: 0.5, y: 0.5 },
    { x: 0.7, y: 0.5 },
  ];
  assert.equal(
    patchCandidate(0.5 + PATCH_ENTRY_RADIUS - 1e-12, 0.5, patches, null),
    0,
  );
  assert.equal(
    patchCandidate(0.5 + PATCH_ENTRY_RADIUS + 1e-6, 0.5, patches, null),
    null,
  );
  assert.equal(
    patchCandidate(0.5 + PATCH_RELEASE_RADIUS - 1e-12, 0.5, patches, 0),
    0,
  );
  assert.equal(
    patchCandidate(0.5 + PATCH_RELEASE_RADIUS + 1e-6, 0.5, patches, 0),
    null,
  );
});

test("candidate selection chooses the nearest patch", () => {
  const patches = [
    { x: 0.5, y: 0.5 },
    { x: 0.53, y: 0.5 },
  ];
  assert.equal(patchCandidate(0.525, 0.5, patches, null), 1);
});

test("snap band changes only the supplied coordinate", () => {
  assert.equal(snapCoordinate(0.5 + PATCH_SNAP_DISTANCE - 1e-12, 0.5), 0.5);
  assert.equal(snapCoordinate(0.5 + PATCH_SNAP_DISTANCE + 1e-6, 0.5), 0.515001);
});

test("background presentation round trips the full 0..1.2 range", () => {
  for (const value of [0, 0.01, 0.15, 0.5, 1, BACKGROUND_MAX]) {
    assert.ok(
      Math.abs(backgroundFromSlider(backgroundSliderPosition(value)) - value) <
        1e-12,
    );
  }
});
