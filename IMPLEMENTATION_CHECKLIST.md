# modCAM16-HK Cartesian Color Picker — Working Checklist

Live implementation and verification record. Update this document and
FINAL_BEHAVIOR.md together when findings change the contract. Older completed
five-profile work is superseded by the fixed HDR-Rec.2020 authoring pipeline
below, with independent presentation views;
legacy Rust APIs remain covered as regression code only.

## Scope and workspace

- [x] Update both working documents before further implementation inspection.
- [x] Continue on `feat/rec2020-authoring-gamut`, preserving the prior
      image-locator, wheel, acceleration, snapping, and responsive-layout work.
- [x] Use Node 26 from fnm; no unrelated commit, push, or sibling shader edits.
- [x] Keep build/runtime self-contained; no sibling repository dependency.
- [x] Remove contradictory old profile-switch, direct-mode, and CSS-preview
      contracts from the living documents.

## Canonical numerical pipeline

- [x] Implement dedicated picker_* WASM exports in src/wasm/color_core/src/picker.rs.
- [x] Decode J'/x'/y' to fixed linear Rec.2020-D65 authoring RGB; scale by
      2.03 once; inverse HDR Rec.2020.
- [x] Selected view changes presentation only, with real Rec.2020 output matrix.
- [x] Keep the 203-nit appearance context and independently derive the physical
      1000-nit J_HK endpoint 217.2768649129496.
- [x] Use the 203-nit ruler/snap reference J'=0.4602422813863053; remove the
      former 100-nit browser locator.
- [x] Keep x/y orientation (-R sin h, R cos h) and source-fixed ColorChecker.
- [x] Mark negative/over-peak foreground Rec.2020 authoring RGB unavailable
      before inverse clipping (authored-unit peak `10/2.03`).
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

- [x] Add an `Image Options` button beside `Load image` and move source
      interpretation controls into a modal dialog with Escape/backdrop/close
      handling and focus restoration.
- [x] Allow images without embedded profiles to load using assumed sRGB
      Rec.709 + sRGB, show the assumption warning when Image Options opens, and
      preserve manual overrides.
- [x] Report confirmed HEIC/HEIF gain-map decoding separately and default
      `Scale ×2.03` off for confirmed gain-map files while respecting explicit
      user changes.
- [x] Redesign the image row as loupe | image frame | 1x/2x/5x zoom controls on
      desktop and mobile; implement cover-style zoom, opposite-direction image
      panning, clamped bounds, and crosshair fallback after a bound.
- [x] Add desktop Pointer Lock image tracking with hidden pointer and
      accelerated relative movement; retain click-follow-confirm behavior and
      fall back to visible document-level tracking if lock is denied.
- [x] Add browser regressions for modal behavior, fallback interpretation,
      gain-map defaults, row geometry, zoom/pan/clamp behavior, Pointer Lock,
      and mobile direction.
- [x] Replace accumulated image-pan/crosshair screen state with deterministic
      geometry derived solely from native location, frame/image dimensions, and
      zoom; verify border escape and reverse-direction recentering.
- [x] Keep image title, Load image, and Image Options on one toolbar row at all
      supported widths.

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

## Startup, image replacement, and background-preview fixes

- [x] Redraw ColorChecker dots/rings immediately when checker data arrives;
      verify they are visible before any picker movement.
- [x] Admit active background-J' drag responses to the live preview pipeline;
      coalesce to the newest response without allowing stale responses to win.
- [x] Disable selection for non-editable app content while preserving editing
      and selection in text/number form controls.
- [x] Keep replacement image rows hidden/not-ready until native dimensions,
      pointer, deterministic geometry, overlay, and decoded image are ready;
      publish image and crosshair atomically.
- [x] Keep zoom controls intrinsic-width and hidden during preparation; make
      2x the initial and replacement-image default.
- [x] Render the background J' locator as a hollow white triangle that is
      visually filled by the solid current-J' triangle when coincident.
- [x] Add browser regressions for all of the above, plus compile, diff-check,
      Rust, picker-math, PNG, and OCIO validation.

## Accelerated image appearance transforms

- [x] Use the official OCIO GPU table payload/equation ordering represented by
      `generate_aces_tables.py`; add provenance and numerical parity checks.
- [x] Add a reusable WebGPU AP0 → ACEScg → fixed HDR-Rec.2020 inverse → selected
      forward-view → display-linear RGB backend for image previews and loupes.
- [x] Cache the prepared/bounded AP0 preview input and GPU resources so view
      changes do not repeat source decoding or image interpretation.
- [x] Add a deterministic, bounded multi-worker WASM transform pool as the
      fallback when WebGPU is unavailable or fails validation.
- [x] Supersede/cancel stale transform jobs and publish only complete matching
      generation/view/scale PNGs in row order.
- [x] Show decompose-style dimming plus `Applying display transform…` while
      regeneration is pending, retaining the previous decoded image.
- [x] Add browser and numerical tests for all four views, Scale ×2.03, GPU /
      fallback selection, stale responses, atomic image/loupe replacement, and
      matching image/loupe pixels.
- [x] Keep the main locator preview and loupe as direct PNG-backed `<img>`
      elements; remove the loupe PNG-to-canvas draw path.
- [x] Create the transparent locator crosshair with the Display-P3-aware canvas
      helper and request `dynamic-range-limit: no-limit` for generated images
      where supported.
- [x] Verify HDR locator image/loupe PNG depth, PQ transfer, cICP metadata,
      direct image tags, sharp loupe scaling, and stale URL replacement.
- [x] Make image sampling honor the Scale ×2.03 unit declaration: checked
      203-nit source units use the 10/2.03 peak; unchecked absolute HDR units
      use the 10.0 peak and normalize by 2.03 only for authored coordinates.
- [x] Verify equivalent checked/unchecked physical colors converge to matching
      ACEScg/J′/x′/y′ values and bright unchecked HDR neighborhoods are
      accepted rather than reported entirely unavailable.
- [x] Add desktop click-follow-confirm wheel tracking with a consumed anywhere
      confirmation click; keep touch/pen as pointer-captured dragging.
- [x] Keep the texture moving at clamped endpoints, retain no value overscroll,
      and make the first reversed delta move J' inward.
- [x] Leave the free wheel texture unchanged by keyboard, numeric, and hex edits.
- [x] Replace direct-speed browser regressions with acceleration, raw-texture,
      desktop/mobile interaction, endpoint, snapping, and cancellation checks.

- [x] Remove rolling-pad/rolling-ball markup, styles, state, labels, and X/Y
      keyboard handling without changing the numerical picker pipeline. Pointer
      Lock remains intentionally limited to the image locator desktop gesture.
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
- [x] Cover mouse, touch, pen, rapid swipe, snapping, wheel-left geometry,
      image Pointer Lock/fallback, and no-scroll regressions.

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
- [x] Preserve 74 passing native Rust regressions, 22 picker math checks, the
      original OCIO parity check, and 8 PNG/composed-pipeline checks.
- [x] Run the full final npm test, TypeScript check, production build, diff check.
- [x] Verify production resources and browser operation at 10.42.0.144:4173.
- [x] Record final validation results and README details.

### Final validation

- `npm test`: 74 Rust tests, the independent OCIO parity test, 22 picker math
  tests, 8 composed PNG/ICC/PQ tests, and 13 browser tests pass.
- `npx tsc --noEmit`, the production Vite build, and `git diff --check` pass.
- Production LAN verification at `10.42.0.144:4173` passes for desktop and
  360x645 DPR-3 mobile, both before and after loading a PNG locator image. The
  PNG view menu produced 8-bit RGB for views 1/4 and 16-bit RGB for views 2/0.
  The mobile page remains exactly 645 CSS px tall, and the rolling-pad UI is
  absent.

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

## Image color locator

- [x] Create `feat/image-color-locator` from `main` and update both living
      documents before implementation inspection.
- [x] Record the resolved product contract: continuous sampling, interpreted
      preview, visible bottom stack, fit-all mobile sizing, persistent loupe,
      fixed HDR-Rec.2020 average mapping, and average J'/XY snapping.
- [x] Keep the image panel visible in an empty state with a Load image action;
      stack it below the picker without document scrolling.
- [x] Reuse the decompose decoder behavior for DNG, EXR, JPEG/JPG, PNG, HEIC,
      and HEIF, including DNG calibration and HEIF native decoding.
- [x] Implement embedded ICC, CICP/chromaticity/nclx, and manual
      Primaries/Transfer precedence exactly as the reference loader.
- [x] Retain the complete native prepared raster in a dedicated worker; allow
      only the visible interpreted preview to use the reference bounded size.
- [x] Define generation-safe `inspect`, `prepare`, and `sample` worker messages;
      reject stale image generations and continuous-sample tokens.
- [x] Add contain-letterbox native coordinate mapping and a transparent
      crosshair with a central square.
- [x] Implement desktop click-follow-confirm tracking with document movement
      and consumed anywhere-confirm clicks.
- [x] Implement touch/pen relative dragging with pointer capture and the exact
      existing 45 ms smoothing, acceleration, clamping, and no-inertia rules.
- [x] Render a persistent nearest-neighbor loupe with disabled image smoothing
      and sharp square pixel edges.
- [x] Continuously sample native pixels in the exact circular 3 px neighborhood;
      report accepted, rejected, and total counts.
- [x] Convert every accepted sample through interpreted linear AP0, ACEScg,
      fixed inverse HDR Rec.2020-D65, and canonical J'/x'/y'.
- [x] Add the per-image scale-by-2.03 override (default on for SDR, off for
      EXR/DNG and embedded PQ/HLG sources), applying it only to image/loupe
      appearance while keeping analysis fixed.
- [x] Encode loaded-image and loupe appearance as selected-view PNG using the
      existing SDR ICC/PQ HDR metadata rules, with nearest-neighbor loupe
      rendering.
- [x] Correct mobile image-locator vertical direction so the crosshair follows
      the finger visually.
- [x] Replace the Background slider/readout with accelerated vertical preview
      dragging and a hollow J' ruler marker.
- [x] Implement deterministic Fast-MCD: h=ceil(n/2), max 32 deterministic
      seeds, five C-steps, determinant selection, tie-breaks, covariance floor,
      and 95% chi-square ellipse.
- [x] Compute the ACEScg arithmetic mean, map it through fixed HDR Rec.2020-D65
      forward, solve canonical J'/x'/y', and add it to XY and J' snapping.
- [x] Keep image analysis independent of picker movement; persist panel,
      loupe, crosshair, ellipse, statistics, and average marker after confirm.
- [x] Add decoder, worker, statistics, stale-response, loupe, interaction, and
      desktop/mobile browser regressions.
- [x] Validate absolute-HDR (unchecked Scale ×2.03) PNG samples against a 10.0
      Rec.2020 authoring peak with 1e-4 coordinate/5e-5 RGB boundary tolerance for f32/PQ
      rounding; generated HDR Rec.2020-authoring slices at J′=0.8 sample 29
      accepted pixels
      instead of reporting 29 unavailable.
- [x] Replace every canonical authoring-validity matrix with XYZ→Rec.2020,
      including picker evaluation, slice CPU/GPU masks, ColorChecker
      availability, encoded imports, and image-locator analysis/mean solving.
- [x] Preserve the fixed HDR-Rec.2020 inverse, selected presentation transforms,
      PNG metadata, and all UI behavior; only the authoring path changes.
- [x] Add regression colors that are outside P3 but inside Rec.2020 and colors
      outside Rec.2020, asserting valid/black behavior and CPU/GPU mask parity.

## Full Rec.2020 and appearance controls

- [x] Update both working documents before implementation (this execution).
- [x] Add a default-on Full Rec.2020 toggle above the gamut slice.
- [x] Add a Desaturate toggle disabled while Full Rec.2020 is off, retaining
      its checked state for restoration.
- [x] Keep Full-off authored validity inside both the Rec.2020 and linear P3
      cubes: every channel must be finite and within `[0, 10 / 2.03]`.
- [x] Keep image analysis, accepted samples, ACEScg means, image targets, and
      ColorChecker availability Rec.2020-based regardless of Full mode.
- [x] Make HDR Rec.2020 view (ID 0) the initial presentation view.
- [x] Apply appearance-only center-relative 0.75 x'/y' scaling for Desaturate
      to slice, preview, ColorChecker fills, image preview, and loupe.
- [x] Clip desaturated intermediate Rec.2020 RGB to `[0, 10 / 2.03]` before
      inverse ACES in every colored appearance path; never let this clipping
      change the canonical availability mask.
- [x] Regress ACEScg `(25.2811, 29.6013, 0.0422)`: it remains available and
      visibly non-black after Desaturate, with matching WASM/WebGPU alpha.
- [x] Keep the original authored validity mask, snapping, readouts, and UI
      overlays unchanged under Desaturate; only non-finite appearance inputs
      are black.
- [x] Render selected-view/desaturated ColorChecker fills as a transparent
      1024x1024 RGBA PNG layer above the slice and below the overlay canvas.
- [x] Extend worker messages, cache keys, stale-response checks, WASM wrappers,
      and WebGPU uniforms for Full/Desaturate flags.
- [x] Add Rust, PNG, WebGPU/WASM parity, and browser regressions for all flag
      combinations and the 360x645 DPR-3 layout.
