# modCAM16-HK Cartesian Color Picker — Working Checklist

This is a live implementation and verification checklist. Check items only
after verifying them, record material findings under the relevant section, and
update `FINAL_BEHAVIOR.md` if a finding changes the intended contract.

## 1. Project foundation

- [x] Create the feature branch after these two working documents exist.
- [x] Add a self-contained Vite + TypeScript project.
- [x] Add a local Rust `cdylib`/`rlib` WASM color-core crate.
- [x] Add `wasm-pack` build integration and relative production asset paths.
- [x] Transcribe the picker-relevant ACES fixed functions and tables from the
      official ACES 2.0 OCIO-generated processor shader.
- [x] Confirm no source or build step depends on an absolute sibling-workspace
      path.
- [x] Add README setup, build, test, and behavior documentation.
- [x] Add an appropriate `.gitignore` for Node, Vite, Rust, and wasm-pack
      artifacts.

## 2. Numerical core

- [x] Implement profile classification using stable IDs `0..4`.
- [x] Implement distinct SDR and HDR appearance-model configurations matching
      the Painter shader.
- [x] Implement the exact normalized J anchors and scaling constants.
- [x] Implement normalized X/Y decode and encode around `0.5`.
- [x] Verify fixed X/Y preserves hue and revised-HK saturation while J varies.
- [x] Reject non-finite values and X/Y points outside the unit disk.
- [x] Implement direct JHK-to-target-XYZ evaluation.
- [x] Implement exact ACES 2.0 inverse/forward transforms for profiles
      `0`, `1`, `2`, and `4`.
- [x] Implement direct linear Rec.709 for profile `3`.
- [x] Implement cone validity with no positive upper bound:
  - [x] Rec.709-D65
  - [x] P3-D65
  - [x] Rec.2020 with P3-D65 limiting
- [x] Verify negative target channels are invalid before display clipping.
- [x] Return actual, unclipped linear Rec.709/ACEScg values in evaluator data.
- [x] Return separately clipped/encoded display and hex values.
- [x] Return finite boundary coordinates for unrepresentable conversions.

### Findings

- The normalized cone needs its own validity helper: the legacy polar picker
  deliberately limits direct Rec.709 to the encoded unit cube, while this
  picker must accept positive linear target channels above `1.0`.
- PyOpenColorIO 2.5.2 with the checked-in ACES 2.0 config is the independent
  ACES oracle. The Rust/WASM path is tested against it; it is not used as an
  oracle for itself. Matching the OCIO group requires leaving negative AP0
  matrix components unclamped before ACES_OutputTransform20 and clamping the
  target RGB range only immediately before the final XYZ matrix.

## 3. WASM interfaces and workers

- [x] Define flat-array or typed-record contracts for:
  - [x] single-color evaluation
  - [x] rectangular X/Y slice row rendering
  - [x] profile conversion
  - [x] hex Set conversion
  - [x] ColorChecker records
  - [x] background conversion and foreground-neutral marker
- [x] Document every returned array offset if flat arrays are retained.
- [x] Keep Temp/Tint and adapted-coordinate controls out of the browser API.
- [x] Render 512 x 512 settled slices.
- [x] Render 64 x 64 preview slices during J interaction.
- [x] Partition settled and preview rows safely across workers.
- [x] Transfer raster buffers instead of copying them.
- [x] Coalesce evaluator and ColorChecker work.
- [x] Cancel or reject obsolete render generations.
- [x] Validate full state keys before publishing asynchronous results.
- [x] Preserve the last accepted preview/raster on worker failure.

### Findings

- The standalone normalized worker contains no Temp/Tint or white-balance
  state. The Rust crate still retains legacy polar/adaptation exports and
  tests for numerical regression coverage; they are not imported by the
  browser worker.
- The official OCIO parity test runs after the WASM build and uses
  `tests/ocio_oracle.py` plus the checked-in config under `tests/reference/`.

## 4. Profile-state behavior

- [x] Preserve actual linear ACEScg across every ACES-to-ACES switch.
- [x] Re-solve normalized J/X/Y after applying the target forward view.
- [x] Implement ACES-to-direct conversion through the SDR Rec.709 view.
- [x] Implement direct-to-ACES conversion through its inverse.
- [x] Do not use clipped hex/display values as the retained conversion state.
- [x] Preserve finite unavailable coordinates without snapping them to a
      ColorChecker reference.
- [x] Preserve Background's JHK offset through profile switches.
- [x] Keep profile IDs independent of menu positions.

### Findings

- Allowing values above `1.0` requires retaining linear values,
  unlike the reference frontend's encoded/clamped retained state.

## 5. User interface

- [x] Recreate the reference picker's restrained dark responsive layout.
- [x] Add the five profiles in visible order `3`, `1`, `4`, `2`, `0`.
- [x] Add raw `0..1` J, X, and Y range controls and numeric inputs.
- [x] Remove Refl/Hue/Sat polar controls.
- [x] Do not add Temp/Tint or Reset/Store/Recall.
- [x] Retain picked-color preview and unavailable cross treatment.
- [x] Retain actual linear readout; allow values above `1.0`.
- [x] Retain profile-specific encoded hex Copy and Set actions.
- [x] Retain Background surround and foreground-neutral snap marker.
- [x] Add accessible names, input validity, keyboard behavior, and focus styles.
- [x] Verify desktop, narrow portrait, and short-screen layouts.

### Findings

- Initial state: the viewport is display-only; selection is through controls.

## 6. Cartesian viewport and indicators

- [x] Map X left-to-right across `0..1`.
- [x] Map Y bottom-to-top across `0..1`.
- [x] Render the full square, including invalid unit-disk corners.
- [x] Intersect the unit-disk and target-gamut-cone masks.
- [x] Make invalid regions visibly distinct from valid black.
- [x] Draw a neutral reference at `(0.5, 0.5)`.
- [x] Draw the selected-color marker at exact X/Y coordinates.
- [x] Keep indicators on a separate transparent 512 x 512 canvas.
- [x] Publish raster and matching indicators without stale-frame flashes.
- [x] Use Display P3 tagging where supported and explicit sRGB fallback
      otherwise.

## 7. ColorChecker behavior

- [x] Use the official 18 post-2014 Lab/D50 patch measurements.
- [x] Adapt reference measurements to D65 and retain absolute ACEScg anchors.
- [x] Derive exact normalized J/X/Y coordinates per selected workflow.
- [x] Draw every patch at exact X/Y, even when diagnostically unavailable.
- [x] Choose the nearest candidate inside Euclidean distance `0.060`.
- [x] Latch the candidate until distance exceeds `0.075`.
- [x] Draw one dim `0.060` halo around the active patch only.
- [x] Show the active patch name.
- [x] Show exact locator ticks on J, X, and Y while a candidate is active.
- [x] Snap only the coordinate being edited within absolute distance `0.015`.
- [x] Do not change the other two coordinates during a snap.
- [x] Apply identical rules to range and numeric inputs.
- [x] Do not draw the narrow `0.015` snap band in the viewport.
- [x] Do not snap invalid profile-conversion or hex-entry results.

## 8. Automated tests

- [x] Rust: SDR/HDR J anchor tests.
- [x] Rust: normalized X/Y round-trip and fixed-saturation tests.
- [x] Rust: unit-disk boundary tests.
- [x] Rust: cone accepts above-one positive channels.
- [x] Rust: cone rejects each negative-channel case.
- [x] Rust: Rec.2020 P3-limited cases.
- [x] Rust: ACEScg invariance across ACES profile switches.
- [x] PyOpenColorIO oracle: forward/inverse ACES 2.0 parity for profiles
      `0`, `1`, `2`, and `4`.
- [x] Rust: direct Rec.709 bridge round trips.
- [x] Rust: finite unavailable-coordinate fallbacks.
- [x] Rust: Background J-offset preservation.
- [x] Rust: ColorChecker record structure and coordinate bounds.
- [x] TypeScript: X/Y viewport mapping and upward Y orientation.
- [x] TypeScript: `0.060` entry, `0.075` release hysteresis.
- [x] TypeScript: `0.015` one-axis-only snapping.
- [x] TypeScript: profile ID/order stability.
- [x] TypeScript: stale worker-response rejection.
- [x] TypeScript: unclipped linear readout and clipped preview/hex separation.

## 9. Manual acceptance checks

- [x] Install dependencies from a clean checkout.
- [x] Build Rust tests and WASM successfully.
- [x] Build the Vite production bundle successfully.
- [x] Open the production build without console errors.
- [x] Verify all five profiles and exact menu labels.
- [x] Verify J drag preview and settled-resolution promotion.
- [x] Verify X/Y do not unnecessarily rerender the slice.
- [x] Verify unit-disk corners and negative-cone regions are unavailable.
- [x] Find and verify a valid target-gamut value above `1.0`.
- [x] Verify actual linear readout, clipped preview, and clipped hex agree with
      their documented roles.
- [x] Verify ACEScg is unchanged across all ACES profile switches.
- [x] Verify direct Rec.709 bridge behavior in both directions.
- [x] Verify Background foreground snap before and after profile switches.
- [x] Verify ColorChecker halo, hysteresis, locator, and independent snapping.
- [x] Verify keyboard and numeric-input flows.
- [x] Capture and inspect desktop and mobile screenshots.
- [x] Re-read `FINAL_BEHAVIOR.md` against the finished implementation and
      update either code or contract for every mismatch.

## 10. Final hygiene

- [x] Run formatting checks without leaving unintended rewrites.
- [x] Run the complete automated test suite.
- [x] Verify the official PyOpenColorIO oracle is included in `npm test`.
- [x] Review `git diff` for copied-but-unused reference functionality.
- [x] Confirm no Temp/Tint, Reset/Store/Recall, or polar Refl/Hue/Sat remnants
      in the browser UI or normalized worker contract.
- [x] Confirm no generated build artifacts are tracked unintentionally.
- [x] Update all checklist findings and mark only verified items complete.

### Final findings

- The normalized cone required a separate helper because the legacy direct
  Rec.709 path intentionally enforces an encoded unit cube.
- Range controls use `step="any"` so a ColorChecker locator can snap to its
  exact normalized coordinate; numeric inputs use the same independent-axis
  snap path.
- A same-frame X/Y settlement followed by J input must let the newer J event
  win the preview-resolution request. The scheduler now coalesces that case
  explicitly.
- The mobile preview readout wraps within its grid track instead of allowing
  the tuple to widen the action row beyond the viewport.
- The OCIO oracle exposed a saturated-primary discrepancy caused by applying
  range clamps at the wrong points in the ACEScg→ACES2065-1→output group. The
  implementation now follows the official processor composition and passes
  all checked forward/inverse vectors within `3e-5`.
