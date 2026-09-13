# modCAM16-HK Cartesian Color Picker — Working Checklist

Live implementation and verification record. Update this document and
FINAL_BEHAVIOR.md together when findings change the contract. Older completed
five-profile work is superseded by the fixed HDR-P3 browser pipeline below;
legacy Rust APIs remain covered as regression code only.

## Scope and workspace

- [x] Update both working documents before further implementation inspection.
- [x] Continue on feature/cartesian-jhk-picker, preserving the prior uncommitted
      wheel, acceleration, snapping, and responsive-layout work.
- [x] Use Node 26 from fnm; no unrelated commit, push, or sibling shader edits.
- [x] Keep build/runtime self-contained; no sibling repository dependency.
- [x] Remove contradictory old profile-switch, direct-mode, and CSS-preview
      contracts from the living documents.

## Canonical numerical pipeline

- [x] Implement dedicated picker_* WASM exports in src/wasm/color_core/src/picker.rs.
- [x] Decode J'/x'/y' to fixed linear P3-D65; scale by 2.03 once; inverse HDR P3.
- [x] Selected view changes presentation only, with real Rec.2020 output matrix.
- [x] Keep the 203-nit appearance context and independently derive the physical
      1000-nit J_HK endpoint 217.2768649129496.
- [x] Verify the fixed 100-nit tick J'=0.34990637148068954, distinct from 203-nit
      reference J'=0.4602422813863053.
- [x] Keep x/y orientation (-R sin h, R cos h) and source-fixed ColorChecker.
- [x] Mark negative/over-peak foreground RGB unavailable before inverse clipping.
- [x] Route Background through the same fixed inverse and selected forward view.
- [x] Expose normalized Background J' position in the 0..1 UI.
- [x] Derive the surround from the fixed source path without a separate
      above-peak Background state.
- [x] Verify matching neutral foreground/surround PNG samples in all views.
- [x] Make encoded AP1 imports solve fixed-source coordinates, without hidden
      canonical-lock state that can disagree with displayed values.

## Preview and worker lifecycle

- [x] Build the gamut viewport as checkerboard canvas + RGBA slice PNG +
      transparent overlay canvas with identical CSS bounds.
- [x] Render only selected-view slice pixels with WebGPU, retaining the WASM
      fallback and removing checkerboard/indicator work from the worker.
- [x] Encode valid gamut pixels as opaque and invalid pixels as transparent,
      retaining selected-view SDR/HDR transfer, bit depth, ICC, and cICP.
- [x] Paint checkerboard and every ColorChecker/neutral/marker indicator in the
      two main-thread canvases, whose backing stores remain 512x512 even when
      the middle WASM slice PNG is temporarily 64x64.
- [x] Make X/Y and snap changes canvas-only; key slice work by view, J', and size.
- [x] Keep WebGPU at 512x512 during J' interaction; permit 64x64 only after the
      renderer is confirmed to be the CPU/WASM fallback.
- [x] Preserve stale-image rejection and previous-image retention for slice PNGs.
- [x] Serialize live J' slice frames so rapid desktop/mobile dragging updates
      progressively instead of cancelling every in-flight frame.
- [x] Let coalesced preview frames advance during rapid mobile X/Y movement and
      finish on the exact settled control state.
- [x] Show exactly one bold unavailable cross on black: hide stale colored PNGs
      while pending, then suppress the immediate diagnostic once its PNG lands.
- [x] Verify layer alignment, RGBA metadata/alpha, canvas content, WebGPU parity,
      and view/J-only image replacement.

- [x] Encode 256x256 RGB PNGs with a centered 186x186 swatch.
- [x] SDR: 8-bit sRGB transfer, actual sRGB/Display P3 ICC, matching cICP.
- [x] HDR: 16-bit big-endian actual PQ, P3/Rec.2020 cICP, no SDR ICC.
- [x] Use DEFLATE level 1 and cache the generated matrix/shaper ICC profiles.
- [x] Give evaluation/encoding its own worker, independent of slice raster work.
- [x] Publish numerical validity before decoding; red cross during active input.
- [x] Decode off-DOM and replace atomically after a complete generation/state check.
- [x] Revoke stale/superseded blob URLs; preserve the last image on failures.
- [x] Exercise delayed, out-of-order, and failed decoding in browser tests.
- [x] Regenerate the transformed slice on view-only changes while preserving
      source coordinates, snap state, canonical ACEScg, and canvas alignment.

## UI and interaction checks

- [x] Replace the accelerating/resetting J' roller with a flat persistent wheel
      whose texture moves 1:1 with vertical pointer travel and whose real J'
      changes at the retained 0.25-per-wheel-height sensitivity.
- [x] Add the separate right-hand 0.0..1.0 ruler with displayed-J' triangle,
      reference-white locator, and active ColorChecker locator; reduce J snap to
      0.005 while preserving real J' for natural escape.
- [x] Add a synchronized three-decimal J' numeric input below the wheel/ruler and
      make the complete J' companion exactly match the gamut viewport height.
- [x] Reinterpret Background as neutral authoring J' in 0..1, remove its shaped
      mapping/peak state, and retain its foreground snap behavior.
- [x] Match the preview square to the full adjacent readout-stack height and keep
      the ColorChecker-name row invisibly reserved when inactive.
- [x] Add gesture-speed independence, persistent wheel, snap escape, ruler,
      numeric-input, background-J', preview-sizing, and DPR-3 layout regressions.

- [x] Restore the shared 45 ms, 1x..4x total-speed acceleration profile for J'
      value movement while keeping texture travel raw and 1:1.
- [x] Add desktop click-follow-confirm wheel tracking with a consumed anywhere
      confirmation click; keep touch/pen as pointer-captured dragging.
- [x] Keep the texture moving at clamped endpoints, retain no value overscroll,
      and make the first reversed delta move J' inward.
- [x] Leave the free wheel texture unchanged by keyboard, numeric, and hex edits.
- [x] Replace direct-speed browser regressions with acceleration, raw-texture,
      desktop/mobile interaction, endpoint, snapping, and cancellation checks.

- [x] Remove rolling-pad/rolling-ball markup, styles, state, labels, Pointer Lock,
      and X/Y keyboard handling without changing the numerical picker pipeline.
- [x] Build one wheel-plus-slice stage with J' immediately left of the flexible
      gamut viewport on desktop and mobile.
- [x] Preserve mouse click-place/follow/second-click-confirm behavior by pointer
      type, independent of viewport width.
- [x] Add relative touch/pen swiping directly on the slice using the former pad's
      sensitivity, velocity smoothing, acceleration, clamping, and snapping.
- [x] Move exact real/displayed/snap diagnostic state from the removed pad to the
      plot frame and update browser helpers accordingly.
- [x] Disable horizontal and vertical document scrolling at all sizes and retain
      a complete, non-overlapping 360x645 DPR-3 layout.
- [x] Replace Pointer Lock/pad browser coverage with mouse, touch, pen, rapid
      swipe, snapping, wheel-left geometry, and no-scroll regressions.

- [x] Remove the Mode row and ID 3 from the browser workflow.
- [x] Put four enabled menu choices on the preview button, order 1/4/2/0.
- [x] Add active-choice indication, keyboard menu navigation, focus restoration,
      Escape/Tab/outside dismissal, and mobile-safe positioning.
- [x] Preserve separate real/displayed J'/X'/Y', nearest-target and neutral snapping.
- [x] Preserve fast/slow relative-motion acceleration on direct slice
      swipes; Pointer Lock is intentionally removed.
- [x] Remove the rolling-pad x'/y' readout; exact diagnostics live on the slice
      frame's accessible label and data attributes.
- [x] Preserve mouse click-to-follow and second-click commit at every viewport width.
- [x] Test no page scroll/overlap and visible controls at 360x645 CSS pixels, DPR 3.
- [x] Finish the complete snap-retention/neutral-surround browser regression.
- [x] Visually inspect desktop/mobile production output and menu.

## Independent validation

- [x] Keep PyOpenColorIO 2.5.2 + the official checked-in ACES 2.0 config as oracle.
- [x] Add independent NumPy appearance/RGB equations; compare composed source
      inverse and all four forward views, not just the isolated transforms.
- [x] Verify both positive HDR values and black/100/203/1000-nit neutrals.
- [x] Decode PNG chunks with node:zlib and independently validate CRCs, sample
      bit depth, RGB channel type, cICP bytes, ICC contents, swatch geometry,
      actual foreground/background samples, and invalid-color diagnostic.
- [x] Load both SDR ICCs with Pillow/LittleCMS; verify colorimetry against
      independent matrices.
- [x] Preserve 72 passing native Rust regressions, 18 picker math checks, the
      original OCIO parity check, and 8 PNG/composed-pipeline checks.
- [x] Run the full final npm test, TypeScript check, production build, diff check.
- [x] Verify production resources and browser operation at 10.42.0.144:4173.
- [x] Record final validation results and README details.

### Final validation

- `npm test`: 72 Rust tests, the independent OCIO parity test, 18 picker math
  tests, 8 composed PNG/ICC/PQ tests, and 8 browser tests pass.
- `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass.
- Production LAN verification at `10.42.0.144:4173` passes for desktop and
  360x645 DPR-3 mobile. The PNG view menu produced 8-bit RGB for views 1/4
  and 16-bit RGB for views 2/0. The mobile page remains exactly 645 CSS px
  tall, and the rolling-pad UI is absent.

### Findings and tolerances

- The old J_HK endpoint 183.7488220212894 is not physical 1000-nit white with the
  retained appearance model/scaling. The browser now has a distinct canonical
  endpoint; legacy tests intentionally continue testing their historical API.
- Selected ACES forward XYZ uses Y=1 at 100 nits. PNG PQ encoding therefore
  multiplies view RGB by 100, not by 203 or another 2.03.
- Background J' is normalized directly from 0 to 1; its neutral source reaches
  the fixed 1000-nit endpoint at 1.0.
- A scrollable `overflow: hidden` grid can change `scrollLeft` when a fixed
  descendant menu restores focus. The visuals grid uses non-scrollable clipping,
  and the reserved 110-pixel preview/readout row prevents first/second-click
  coordinate drift when a ColorChecker name changes visibility.
- At exactly 1000-nit neutral, OCIO float32 inverse shoulder/matrix rounding
  gives ACEScg about 512.0153 versus WASM about 511.9975. The endpoint has a
  1e-4 relative scene tolerance; other composed samples use 3e-5 relative
  (with a unit absolute floor). Forward RGB tolerance is 8e-5, and all encoded
  image samples agree within one 8-/16-bit quantization step.
- Browser tests inspect PNG data/metadata and browser decoding, not physical HDR
  luminance. Actual HDR/wide-gamut appearance still requires manual testing on
  the target browser/OS/display. All views intentionally stay selectable.
- A software WebGPU adapter rendered all four view profiles with no validity
  mismatches against the f64 WASM fallback on a 17x17 slice. Maximum linear-RGB
  difference was 0.00034 for SDR and 0.00164 for HDR (expected f32 variation).
