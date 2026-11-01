# Photoshop/macOS acceptance

Status: **native foreground evidence received; v0.1.7 HDR presentation, performance and native resizing unconfirmed**.
The 2026-10-09 user capture confirms a 32-bit ACEScg document, an HSB foreground,
and WebGL2 execution. The v0.1.3 capture shows native conversion returning
ordinary `red/grain/blue`, and no discoverable current OCIO view. Version 0.1.4
adds native RGB-property reads, modal duplicate/fill/pixel sampling, native
descriptor rollback, and schema-4 probe/cleanup diagnostics. Linux tests use
actual captured input/conversion descriptors with explicitly synthetic pixel
data; they do not establish native paint semantics or displayed luminance.
The latest real v0.1.4 capture, `modcam16-host-diagnostics2.json`, verifies eight
applied foreground transactions, including six native pixel-sampled readbacks
and two explicit float readbacks, at a 280×180 allocation. It still lacks a
discoverable OCIO view. Version 0.1.5 requests the native resize grip, leaves an
uncovered native strip, removes its own minimum, and fits all controls without
scrolling; actual native grip/drag and visual acceptance remain pending.

## Installation and descriptor capture

1. Build with Buck2 and load the v0.1.7 `plugin/manifest.json` in UXP Developer Tool.
   Reload the plugin or restart Photoshop to ensure the previous version is gone.
   Record OS, Photoshop, UXP, display model, display preset, and HDR settings.
2. Create a 32-bit floating-point ACEScg OCIO document. Set neutral exposure and
   gamma. Select each of the four ACES 2.0 views listed in README.md and then
   Raw. Check the panel follows each view and identifies the Raw fallback.
3. Click **Diagnostics** after each view change and save the captures under
   `host-results/` with distinct filenames. Capture at least one foreground
   with a component above 1. Diagnostics save the raw document descriptor,
   raw foreground descriptor, native RGB conversion result/error when needed,
   resolved context, interface theme colors, host version, renderer information,
   native panel/WebView bounds, browser viewport, and slice dimensions. Schema
   4 also records extension version, host/browser bridge observations, recent
   client and host transactions, native results/errors, structured readback
   and restoration, `foregroundRGBProperty`, `foregroundSource`, and
   `foregroundSample` profile/depth/opacity/cleanup/stages. Check
   `extension.version` is `0.1.7`. Resize evidence also includes grip request
   status/error, native strip height, manifest size configuration, last eight
   resize allocations, UI scale, pad/wheel size, and overflow measurements.
4. Validate the captures:

   ```sh
   buck2 run //:validate_host -- host-results/*.json
   ```

   This checks descriptor discovery and capture coverage, including all four
   views, fallback, and HDR floats. To investigate foreground independently
   while the current OCIO view remains unavailable, use:

   ```sh
   buck2 run //:validate_host -- --foreground-only host-results/*.json
   ```

   Foreground-only checks require readable native floats or a verified ACEScg
   sample and matching applied-transaction readback. They do not require view
   coverage or prove UI behavior, painting, or luminance.
5. If a property is unavailable, record an Action Manager command using
   Photoshop's Plugins → Development → Record Action Commands while setting
   an HDR foreground or changing the OCIO view. Add the actual descriptor as
   a redacted fixture, identify the exact Photoshop version, and adjust
   `host/protocol.ts` / `host/main.ts` to that evidence. Do not relabel the
   synthetic unit tests as captured host fixtures. Capture files may contain
   document names; review them before sharing.

## Foreground transactions and races

- Start with RGB [.18, .18, .18], pick a valid HDR coordinate, and confirm the
  numeric foreground readback has values above 1. Paint with a normal brush
  at full opacity onto an empty layer. Confirm sampled document values equal
  the requested ACEScg floats within floating-point precision.
- During a drag, confirm the preview changes but foreground does not. Confirm
  exactly one commit on release, including release outside the control. Confirm
  the final pointer coordinates are used. Exercise numeric, keyboard, and
  scroll input. Pointer cancellation or a window blur must cancel a gesture.
- While previewing a different color, click **Sync foreground**. Confirm it
  cancels the local preview and reimports the unchanged Photoshop color. Repeat
  after changing Photoshop's foreground and during pending evaluation/write
  work. Check readouts agree with the freshly read native floats.
- Confirm the footer remains visible and reports reading/evaluating/setting,
  success, and native failure. Unchanged polling must not erase a write error.
  A missing bridge/reply must produce a useful message within five seconds.
- Pick with Photoshop's eyedropper; confirm coordinates and preview update
  without another foreground write. Test negative and very bright external
  colors: retain the scene color, report an unavailable coordinate, and do not
  clamp it into the picker domain.
- Switch, close, and reopen documents during gestures and pending modal work.
  Confirm stale releases cannot modify the new document. Hide and reopen the
  panel; confirm polling/listeners resume without duplicate writes.
- If readback differs, confirm the previous foreground is restored and an error
  is shown. An adapter that reads encoded 0–255 fields must not pass this check.
- Capture **Diagnostics** immediately after a failed release or Sync, even
  when foreground reading fails. Compare `capabilities.transactions` with
  `transactions`: a client `released`/`sent` event should have a matching host
  transaction ID. Inspect modal entry, exact float command, native result/error,
  readback, and restoration. This separates bridge failures from native command
  or conversion failures. The original schema-1 capture lacks this evidence.
- Choose a foreground using Photoshop's HSB controls and eyedropper, then
  **Sync foreground**. With ordinary native conversion output, confirm
  `foregroundSource` is `paint-sample` (or `rgb-property` if that exposes explicit
  floats). For a sample, require `sourceDepth` and `componentSize` 32, ACEScg
  source/output profiles, width/height 1, 3 RGB components or opaque 4-component
  RGBA, and all cleanup flags true. Compare the sample against an independently
  painted and sampled document patch, including negative and HDR channels.
- Before sampling, select a nontrivial region, an alpha channel, and a layer
  in a source document with unsaved edits. After Sync, verify source pixels,
  selection, layer/channel state, history, dirty state, and active document are
  unchanged. Repeat on a clean document; no temporary tab should remain. A
  brief owned duplicate may appear during the probe. Check cancellation and
  switching to another document during sampling do not leave copies or steal
  the new document's focus.
- Confirm polling an unchanged native color does not repeatedly duplicate the
  document; explicit Sync and Diagnostics deliberately sample freshly. Measure
  the first read and repeated changes on representative large/layered documents.
  Verify duplicate profile and native foreground Fill semantics under OCIO.
- Exercise a failed or clamped write after an HSB foreground. Check restoration
  uses the captured native HSB descriptor and fresh sampling confirms the
  previous ACEScg values. Preserve native command errors in the saved trace.

## Interface and docking

- In each Photoshop interface theme, confirm the panel and its WebView have
  the same background as surrounding panels. Change themes while the panel
  is open and confirm it follows without requiring a document or reload.
- Confirm Photoshop's native resize grip is visible and accepts dragging in
  its native area below the WebView. An `applied` grip request only confirms
  the API call succeeded. Record floating grip and dock-divider behavior
  separately; browser fixtures cannot verify the native handle.
- Dock below another panel and shrink its height. Confirm the other panel
  remains visible and every picker control/readout fits without scrolling.
  No extension minimum is specified; record any Photoshop-enforced limits.
  At very small allocations the entire interface scales down continuously.
- Switch between docked and floating layouts; verify dragging and numeric
  input still work after resizing, including when the interface is scaled.
- Drag width and height borders/dividers independently, including a wide panel.
  Confirm content follows the moved boundary and the square pad fits both
  dimensions, growing with width or height when the other dimension permits.
  Capture diagnostics after each resize. Compare `layout.panel`,
  `layout.appliedWebview`, `layout.webview`, and `capabilities.viewport`; they
  should agree within one logical pixel after subtracting the reported native
  strip from the panel height. The strip is normally 20 pixels, capped at a
  quarter of very short panel heights. Verify all control and text bounds fit;
  `capabilities.layout` records scale, pad/wheel dimensions, and overflow.
  `capabilities.slice` remains 256×256 independent of idle resizing (128×128
  during WASM gestures). Resizing cancels active or queued gestures; releasing
  afterwards must leave Photoshop's foreground unchanged.

## GPU, PNG, and display matching

The user confirms the parent project's PQ PNGs display HDR in Safari. The
2026-10-10 audit confirms this extension's valid PQ samples match the official
OCIO output, while the parent's encoder applies an additional 2.03. Version
0.1.7 fixes the missing authoring/OCIO conversion: reference white is 203 nits,
and J′ = 1 neutral reaches 1000 nits in both HDR views. Normally sized panels
avoid a CSS transform and images explicitly allow HDR range. These automated
findings do not establish actual WebView HDR presentation.
Build `//:hdr_audit` and follow [HDR_PRESENTATION.md](HDR_PRESENTATION.md) to
compare identical 1000-nit references in Safari and the actual panel, including
RGB/RGBA, range-limit and scaled/unscaled comparisons. Record browser signals
and the visible result separately; CSS support and decoding are not HDR proof.

- Confirm diagnostics report WebGPU or WebGL2 on the target host. Exercise
  fallback/device loss using WebView developer tools; confirm WASM remains
  usable and completion refines the pad to 256².
- Compare swatch and painted document patch in **every** supported view for
  black, neutral gray, reference white, highlights, saturated colors, and
  ColorChecker colors. Use the same surround and neutral exposure/gamma.
- In both HDR views, compare neutral J′ = 100 / 217.2768649129496 (203-nit
  authoring white) and J′ = 1 (1000-nit peak). After committing each, click Sync;
  the coordinate dot must remain neutral and available in both gamut modes.
  Reference-white scene values are approximately [1.96917, 1.96917, 1.96917];
  peak scene values are approximately [511.998, 511.997, 511.998]. Confirm native
  readback and painted document pixels preserve those HDR floats. Existing
  foreground colors must import into corrected coordinates without a write.
- Inspect the actual image PNG: HDR must be 16-bit PQ with correct Rec.2020 or
  P3-D65 cICP metadata; SDR must contain the corresponding ICC profile.
- Confirm the WebView displays HDR luminance, not an SDR-clipped or untagged
  image. Use a calibrated display/instrument when validating absolute nits;
  a screenshot alone cannot establish HDR luminance. OCIO output linear 1 is
  encoded as 100 nits, with no extra 2.03 gain.
- Install the built `.ccx`, reopen Photoshop, and repeat a short smoke test
  including one HDR commit, eyedropper sync, and a view switch.

Record dated results and captures in `host-results/`, then update GOAL.md and
CHECKLIST.md. No actual-host check is complete merely because a mock passes.


## Latency and renderer evidence retained in v0.1.7

- Install v0.1.7, drag J′ rapidly, and release. Confirm the dot responds during
  rendering, the final slice follows the final J′, and one foreground write
  occurs. Repeat x′/y′ drags at fixed J′: the slice should remain unchanged.
- Save Diagnostics after the update. Compare requested/displayed IDs, J′,
  view, gamut and dimensions; settled queues should be empty. The final image
  should be 256 square. Check replacement counters after a fast drag.
- Inspect `capabilities.device`: retain vendor, renderer/architecture, device ID
  and fallback indication. A software label must agree with the reported driver;
  an unavailable identity must stay unknown. WebGPU/WebGL2 names alone do not
  establish physical GPU execution. Hover the renderer label for these details.
- Inspect displayed-frame timings and the bounded performance history. Separate
  evaluation, GPU initialization/submission, GPU execution where available,
  readback wait, CPU PQ/packing, compression and PNG decoding. Compression is
  already included in PNG totals, and readback wait includes GPU completion.
- Compare a small and large ACEScg document. Use native sample `timings` to
  identify duplicate/crop/fill/getPixels/getData/close costs. Fresh verification
  and rollback remain enabled; software-GPU benchmark improvements do not
  establish a reduction in native Photoshop sampling costs.
- Check all four OCIO views and the unsupported-view fallback visually on the
  HDR display. Images must retain their prior appearance and luminance, with
  no stale slice replacing the final selection. Check native grip/resize behavior
  using the existing scenarios above; browser tests do not prove native handles.
