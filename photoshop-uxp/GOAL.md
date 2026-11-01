# Photoshop modCAM16-HK HDR picker

## Goal

Deliver a standalone Photoshop UXP extension for HDR color picking in a
32-bit floating-point ACEScg document managed by OpenColorIO. Target macOS
26 or newer and Photoshop 27 or newer.

The extension must build, test, and package through **Buck2**. This directory
must contain all project-owned source, build configuration, color tables,
reference data, tests, and documentation needed to develop it independently.
It must not depend on another directory in this repository at build time or
runtime. Third-party dependencies and toolchains must be declared and pinned.
Node.js must be a Buck2-managed, checksum-verified tool target, not a PATH
prerequisite. Pin Node 26.10.0 for all JavaScript build, test, and package work.

## Required behavior

- Preserve the current picker’s modCAM16-HK coordinates: saturation
  `s = 75 C / J_A`, fitted logarithmic radius, existing Cartesian orientation,
  and `J_HK = 217.2768649129496 J′`.
- Provide a vertical J′ trackwheel, an x′/y′ pad with a draggable selection
  dot, numeric coordinate readouts, ColorChecker indicators, and snapping.
- Use the existing 18 chromatic ColorChecker references and neutral/reference
  white indicators.
- Offer `Rec.2020 (P3-D65 limited)` and `Rec.2020` authoring modes, defaulting
  to the limited mode. Reject unavailable selections without clipping them
  into a different foreground color.
- Keep the canonical Rec.2020-authoring-to-ACEScg conversion independent of
  the selected presentation view.
- Render the 256×256 pad background with GPU support. Prefer WebGPU, then
  WebGL2 floating-point rendering, with WASM as the final fallback.
- Use 128×128 during WASM gestures and refine to 256×256 on completion.
  Fit the square pad to both available dimensions independently of PNG size.
- Present generated PNGs directly in image elements, with separate overlays.
  The pad, ColorChecker colors, and selected-color preview follow the active
  document’s supported ACES 2.0 view:
  - SDR 100 nits (Rec.709)
  - SDR 100 nits (P3 D65)
  - HDR 1000 nits (P3 D65)
  - HDR 1000 nits (Rec.2020)
- Use 16-bit PQ PNGs for HDR views and appropriately tagged SDR PNGs for SDR
  views. Check absolute luminance against OCIO’s output; do not copy the
  browser app’s extra 2.03 PNG brightness multiplier.
- Default the panel preview to HDR 1000 nits (Rec.2020) when the document view
  is unsupported, such as Raw, or unavailable. Identify fallback use.
- Preview continuously during gestures and commit Photoshop’s foreground
  color on release. Synchronize changes from Photoshop’s foreground color,
  including its eyedropper, back into the panel.
- Read floating-point ACEScg through explicit native float descriptors or
  native painting and 32-bit pixel sampling in an owned temporary duplicate.
  Preserve negative values and values above one; never infer float units from
  ordinary RGB. Perform mutations inside `executeAsModal` and leave source
  pixels, selection, layers, history, and dirty state unchanged by sampling.
  Auto-close temporary documents on cancellation, restore source focus, cache
  successful polling samples, and force fresh Sync and transaction readings.
  Retain the original native foreground descriptor for verified rollback.
- Reject stale results and commits after document switches; prevent feedback
  loops. Preserve external colors outside the picker’s representable domain
  and identify unavailable coordinates without overwriting Photoshop.
- Use a neutral preview surround at J′ = 0.150. Assume standard supported
  views with neutral exposure/gamma settings.
- Match Photoshop’s panel/interface background and follow its theme changes.
- Fit the allocated panel width and height without vertical scrolling or
  forcing neighboring panels closed. Keep every control and readout visible,
  with a compact layout and uniform UI scaling when the allocation is too small.
  Do not impose a positive minimum panel size; Photoshop may enforce host limits.
- Synchronize native WebView bounds with the Photoshop panel's allocated width
  and height on show, readiness, and resize. Explicitly request the native
  resize grip and reserve native space below the WebView for its drag area.
  Use a square pad, compact control bands, and adjacent color/view readouts.
  Account for displayed scaling in pointer calculations and cancel active
  gestures when the panel allocation changes.
- Recover when the WebView message bridge appears after startup; acknowledge
  connection and explicit sync requests and report missing replies within five
  seconds. An explicit sync must reimport the fresh host foreground even when
  it equals the cached value.
- Complete each release once, including releases outside the control, and wait
  for the final coordinate evaluation. Keep status feedback visible in short
  panels; retain write failures across ordinary polling and reconcile readouts
  with verified Photoshop values.
- Capture diagnostics schema 4 with extension version, bridge observations,
  native readings/errors, sample profile/depth/pixel/cleanup evidence, and the
  last eight foreground transactions, including requested floats, readback,
  and native-descriptor restoration. Preserve validation of older schemas and
  provide a foreground-only check independent of unavailable view discovery.

## Deliverables

- A manifest-v5 UXP panel with a bundled local WebView and a narrow Photoshop
  host bridge; no runtime server or remote UI is required.
- Independent source and declared dependencies under this directory.
- Buck2 build, test, plugin-directory, and `.ccx` package targets, with usage
  and installation instructions. Packaging uses Adobe’s UXP packaging CLI.
- Numerical, renderer, interaction, integration-fixture, and package tests.
  Exercise the GPU APIs on a software GPU when no physical GPU is available.
- A separate Mac/Photoshop host-validation path covering real descriptors,
  HDR foreground round trips, GPU execution, HDR PNG presentation, OCIO view
  tracking, and installation.
- These goal and checklist documents maintained throughout implementation.

## Acceptance and current status

Version 0.1.7 implementation and automated delivery are complete; physical
Photoshop WebView HDR remains unconfirmed. The missing unit conversion is fixed
in WASM and both GPU entry points: 203-nit authoring XYZ is multiplied by 2.03
before the canonical OCIO inverse, with division on scene import. Surrounds,
display-referred helpers and ColorChecker coordinates use consistent units.
The authoring model, J′ domain and gamut bounds are preserved. Numerically
neutral/black imports are stabilized without bypassing the scene round-trip
guard. The change intentionally changes ACEScg foreground values for the same
picker coordinates; existing document colors are preserved and imported using
the corrected coordinates.

In both HDR views, independently decoded reference-white previews measure
202.987 nits and J′ = 1 neutral measures 1000.002 nits (16-bit quantization),
instead of v0.1.6's 100 and 492.629 nits. The PNG encoder still uses absolute
OCIO 100-nit units without another multiplier; it agrees with the complete
official ACES 2.0 PQ view within 16-bit quantization (maximum code error
0.000006888). Readable panel layouts use no CSS transform; small allocations
retain scaling and no-scroll behavior. Images explicitly allow unrestricted
HDR range where supported. This mitigates a possible compositor interaction;
it does not prove that Adobe's native WebView surface presents physical HDR.

All six Buck2 targets pass: 174 tests plus strict TypeScript, including new
physical white/peak PNGs, float32 import round trips, independent checker
coordinates and GPU luminance anchors. Both GPU APIs execute on SwiftShader,
with zero tested mask mismatches and maximum relative RGB differences under
0.004. Packaging and nine-file archive/runtime validation pass; the v0.1.7 CCX
is copied to the repository root and v0.1.6 is retained. A fresh standalone copy
independently bootstraps, passes the same tests and strict TypeScript, builds
the HDR audit, and packages successfully outside the repository. Both original
host captures are preserved. The standalone `//:hdr_audit` target supplies
verified 0–1000-nit references, a Safari comparison page and a reversible panel
probe. See HDR_PRESENTATION.md and VALIDATION.md for evidence and Mac checks.

Version 0.1.6 (preceding release) implementation and automated delivery are complete. All six Buck2 targets pass: 173
tests plus strict TypeScript, including stalled-image commits, bounded bursts,
PNG byte equality, and decode races. Packaging and nine-file archive/runtime
validation pass; v0.1.6 is copied to the repository root and v0.1.5 is retained.
A fresh standalone copy independently bootstraps, passes the same tests and
strict TypeScript, and packages outside the repository. The repaired defects were an
unbounded WebGL message backlog (synchronous readPixels prevents the worker's
pending slot from seeing queued messages), foreground evaluation waiting for
preview PNG encoding, duplicate GPU slices on drag release, and renderer status
being reported before PNG decoding without device identity or stage timings.
A warmed 12-change J′ burst in the shipping panel now reaches the decoded
slice in a median 171.0 ms on SwiftShader WebGL2, down from 837.1 ms in v0.1.5;
WebGPU improves from 330.1 ms to 156.4 ms. Each result is the median of three
runs, including PNG decoding. WebGL2 encodes two slices instead of all twelve.
These Linux software-GPU measurements exclude Photoshop and physical display
presentation; they do not measure the user's complete five-second delay.

The v0.1.6 deliverable separates evaluation, preview/checker encoding, and
slice rendering into bundled workers; bounds outgoing work to active plus latest
pending requests; returns foreground values independently of PNG work; encodes
constant preview colors once; and deduplicates by actual rendering inputs.
GPU output remains 256 square and WASM retains 128-to-256 gesture refinement.
Only current decoded images replace displayed images. Compatible schema-4
diagnostics report queues, requested/displayed slices, actual adapter
information where exposed, stage timings, and native sampling durations.
Fresh native foreground verification and rollback remain required. Validation
includes stalled-work and race regressions, numerical/PNG equality, repeatable
software-GPU measurements, all Buck2 tests, CCX validation, and an independent
standalone-copy build. The v0.1.5 package and both supplied diagnostic captures
are preserved byte-for-byte. See VALIDATION.md for results and timing semantics.
Real Photoshop performance and native resize acceptance remain host checks.

Version 0.1.5 implementation and automated delivery are complete; native
resize acceptance is pending. The user reports no native resize handle and
rejects vertical scrolling and an extension-imposed minimum size. All controls
must remain visible, and the pad must stay square. This release requests
Photoshop's native resize grip, reserves an uncovered native strip, removes the
manifest minimum, and fits a compact interface to both dimensions with scaling
as needed. Those changes and compatible schema-4 grip, resize, overflow, pad,
and UI-scale diagnostics are implemented. All six Buck2 targets pass: 162
tests plus strict TypeScript, with both GPU paths executing on SwiftShader.
Buck2 packaging and nine-file archive/runtime validation pass; v0.1.5 is copied
to the repository root with v0.1.4 retained. A fresh standalone copy outside
the repository independently bootstraps, passes the same tests and strict
TypeScript, and packages successfully. Usage and validation documents are
current. The new real capture modcam16-host-diagnostics2.json passes foreground
validation with eight applied transactions, including native pixel sampling.
Both supplied captures are preserved byte-for-byte. Actual resize-grip and drag
acceptance requires Photoshop; browser mocks cannot prove native handles.

Version 0.1.4 implementation and automated delivery are complete. The new
Photoshop 27.11.0 capture reproduces
the remaining foreground blocker in v0.1.3: native HSB conversion returns
ordinary `red/grain/blue` RGB fields rather than explicit float fields. Model
15 does not guarantee a float descriptor. The repair reads the native
`foregroundColorRGB` property and, when explicit floats are unavailable,
samples Photoshop's foreground by filling a pixel layer in a temporary 1×1
duplicate and reading 32-bit ACEScg pixels. The source document must remain
unchanged; temporary documents must close without saving, including on
cancellation. Successful samples are cached for polling, with fresh reads
for explicit Sync and transaction verification. Original native foreground
descriptors are retained for rollback. Schema-4 diagnostics and real-input
regression fixtures are implemented. All six Buck2 targets pass: 155 tests plus
strict TypeScript, including shipping-host/browser sampling, Sync, release,
rollback, and SwiftShader rendering. Buck2 packaging and nine-file archive
validation pass; v0.1.4 is copied to the repository root, with v0.1.3 retained.
The fresh standalone-copy check also passes: independent bootstrap, the same
155 tests and strict TypeScript, and packaging outside the repository, without
copying dependencies or local configuration. Usage and validation documents
record the final evidence and native acceptance procedure. Native Photoshop
performance, transient duplicate UI behavior, painting/readback, and visual HDR
acceptance remain pending.

Version 0.1.3 implementation and automated delivery completed. It repaired
the gesture, bridge, and status paths after the user's report of unchanged
Photoshop foreground on release, no visible status, and an ineffective Sync
button. It did not handle the ordinary native RGB output later captured in
Photoshop; v0.1.4 addresses that reading blocker.
Read-only probes reproduced ignored unchanged-color sync responses, requests
dropped when the bridge becomes available late, a status line outside short
panel viewports, and failed writes masked by later context messages. The older
host capture could not establish that later native conversion failure. Version
0.1.3 corrected those paths, modal timeout units and callback-result handling,
extended regression coverage, and produced a Buck2-validated CCX. The bridge,
gesture, verified-foreground, persistent-status, and schema-3 diagnostic
changes and their regression cases are written. Final Buck2 validation passes
all six targets: 139 tests plus strict TypeScript, including software-GPU
browser integration. Buck2 packaging and archive validation pass, and v0.1.3
is copied to the repository root with v0.1.2 retained. A fresh standalone v0.1.3
copy outside the repository independently bootstrapped, passed all six test
targets, and packaged successfully. Actual Photoshop/macOS acceptance remains
pending.

The preceding v0.1.2 implementation and automated validation completed. Buck2
built the plugin directory and CCX using its checksum-pinned Node 26.10.0
tool target. All six test targets passed: 120 tests plus strict TypeScript.
SwiftShader exercises WebGPU and WebGL2 with matching sampled gamut masks;
interaction, host-fixture, OCIO, device-failure, and WASM fallback checks pass.
A fresh copy of the initial release outside the repository independently
bootstrapped, tested, and packaged successfully. See VALIDATION.md for evidence
and CHECKLIST.md for the remaining acceptance items. Implementation remains
confined to this directory; the deliverable CCX is also copied to the repo root.

The user supplied a real Photoshop diagnostic capture, confirming an HSB
foreground descriptor and WebGL2 execution. Interactive Photoshop and macOS
HDR-display checks have not run here: mocks cannot establish native conversion
results or actual HDR display correctness. Float verification, painting/readback,
visual view matching, macOS WebView behavior, and installation remain release
acceptance gates, documented in HOST_VALIDATION.md. The bridge reports missing
float data and uses the documented view fallback when discovery fails.

Version 0.1.1 addressed the 2026-10-09 feedback: HSB and other foreground
descriptors are sent to Photoshop's native RGB conversion; float output was
then assumed and mocked in tests, but the new capture disproves that
assumption for this host. The UI
uses the host theme colors; a 180-pixel minimum height and internal scrolling
allow short docked allocations. Regression tests use the captured HSB input
with clearly identified mock conversion responses. That release passed Buck2
packaging; the preceding deliverable was v0.1.3.

Version 0.1.2 addresses the follow-up where Photoshop's panel border moves
while the plugin content stays fixed. Native WebView sizing now follows the
allocated panel root on show, readiness, and resize. Outer-container tests
confirm sizing through 1000×800 and aligned selection coordinates. Diagnostics
include panel/WebView/viewport/slice dimensions. Completed gamut slices are
256×256 on every renderer, with 128×128 WASM gestures. Buck2 packaging passes
and the validated v0.1.2 CCX was copied to the repository root. Target-host
confirmation remains pending.

No Marketplace publication is included in this task.
