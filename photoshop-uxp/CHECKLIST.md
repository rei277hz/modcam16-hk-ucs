# Working checklist

## v0.1.7 HDR normalization and image presentation (implemented; host HDR acceptance pending)

- [x] Record the audit findings, user-authorized repair and acceptance criteria
  in GOAL.md and this checklist before editing implementation.
- [x] Preserve v0.1.6 and the original host diagnostic files.
- [x] Convert 203-nit authoring XYZ to OCIO units before inverse processing;
  reverse this adjustment on scene import, including AP0 and encoded helpers.
- [x] Apply consistent conversion to surrounds, display-referred helpers,
  ColorChecker coordinates and the shared GPU shader without altering masks.
- [x] Remove avoidable transforms at normal panel sizes, retain small-panel
  fitting, and explicitly allow HDR image range in supported browsers.
- [x] Add independent OCIO/PQ luminance and coordinate regressions, round-trip
  and GPU agreement checks, and fit/presentation regression coverage.
- [x] Run the HDR audit and all Buck2 tests with pinned Node and SwiftShader.
- [x] Package/validate v0.1.7 and replace the root CCX after retaining v0.1.6.
- [x] Repeat a fresh standalone bootstrap, tests and packaging; update usage,
  HDR audit, validation, GOAL.md and this checklist with the final evidence.
- [ ] Confirm identical reference PNGs display HDR inside the actual Photoshop
  WebView, and verify normal picker/document appearance on the user's Mac.

The conversion is implemented in WASM and both GPU entry points. Independent
checks cover physical white/peak PNGs, float32 foreground imports, checker
coordinates and all four OCIO views. The new tests caught WebGL's separate
entry point and peak-white round-off in limited-mode imports; both are repaired.
Numerical black also receives stable neutral coordinates. Readable layouts
use no transform, with the previous scaling retained when needed. All six Buck2
targets pass: 83 Rust, 24 unit, 8 OCIO, 27 browser and 32 host tests (174 total),
plus strict TypeScript. Independent PNG measurements are 202.987-nit white and
1000.002-nit peak in both HDR views. GPU masks agree, with maximum relative RGB
differences 0.003904 WebGPU and 0.003879 WebGL2 on SwiftShader. Evidence:
`.tools/hdr-fix-final-tests.log` and the `//:hdr_audit` report. The validated
1,351,987-byte v0.1.7 CCX is copied to the repository root; SHA-256:
`99522e80107d36d328d6cdc31e3f07d309b9c27ab2ecf5b6c8a632530e560301`.
Evidence: `.tools/hdr-fix-package.log` and `.tools/hdr-fix-package-report.json`.
Version 0.1.6 is retained in `.tools/previous-package-v0.1.6.ccx`; both original
diagnostic hashes match. Fresh standalone bootstrap, all tests, the HDR audit
and packaging pass without copying dependencies or local configuration.
Evidence: `.tools/hdr-fix-isolation.log` and `.tools/isolation-report.json`.
Physical WebView HDR remains a Mac acceptance check.

## HDR PNG presentation and reference-white audit (code/specification checks complete; host display pending)

- [x] Confirm the reported SDR appearance is inside the plugin's embedded panel.
- [x] Inspect PNG encoding: HDR is 16-bit PQ, cICP primaries 9/12 and transfer 16,
  and luminance is encoded as OCIO output × 100 nits without a 2.03 multiplier.
- [x] Verify decoded shipping PNG luminance and the ACES 2.0 OCIO normalization
  using pinned Buck2 tools and independent checks.
- [x] Compare both actual encoders: parent linear 1 → 203 nits, extension → 100
  nits; preserve the user's confirmed Safari HDR observation.
- [x] Check primary Adobe/WebKit documentation and implementation evidence for
  HDR images in macOS UXP/WKWebView, including CSS/compositor restrictions.
- [x] Add standalone `//:hdr_audit` with a complete official PQ display oracle,
  independently decoded reference PNGs, a Safari page, and a reversible panel probe.
- [x] Run the audit assertions, 31 unit/OCIO tests, and Chromium probe controls,
  image decoding and source/style restoration through pinned Buck2 Node.
- [x] Record conclusions, meaningful host checks and any concrete fix justified
  by evidence; update goal, checklist and presentation/validation documentation.
- [ ] Compare identical 1000-nit reference PNGs inside the actual Photoshop
  WebView with Safari; check range limits and the interface transform separately.
- [x] Reconcile inherited 203-nit authoring units at the OCIO conversion boundary
  and on foreground import, then verify masks, round trips and canonical colors.

The pre-fix v0.1.6 audit showed PNG samples matching the complete ACES 2.0 OCIO PQ view
within 16-bit quantization: maximum normalized code error 0.000006888. The
inherited authoring normalization nevertheless limited J′ = 1 neutral to 492.629 nits;
the parent encoder's 2.03 raises that value to 1000 nits. This is a separate
normalization issue, not proof of an SDR-only WebView. Version 0.1.7 fixes that
conversion boundary, with the encoder remaining absolute. A WebKit layer issue is
a testable hypothesis; native HDR output is not established by decoding,
GPU API names, or media queries. See HDR_PRESENTATION.md and VALIDATION.md.

## v0.1.6 bounded rendering and independent foreground evaluation (implemented; host acceptance pending)

- [x] Trace drag, shader/readback, PQ/compression, image decoding, and commit flow.
- [x] Reproduce the shipping WebGL backlog on SwiftShader and record the baseline.
- [x] Record the problem, accepted fix plan, and deliverable in both documents
  before implementation.
- [x] Separate evaluation, preview/checker encoding, and slice rendering workers;
  add typed, correlated replies and bounded dispatch with error/teardown cleanup.
- [x] Send evaluated foreground floats independently of all PNG work; preserve
  current document/activity, release-once, Sync, and cancellation guarantees.
- [x] Quantize distinct preview colors once with identical samples/metadata;
  transfer PNG buffers and eliminate identical GPU slices on drag release.
- [x] Decode candidates before display; reject stale completions, preserve the
  prior image on errors, and clean up Blob URLs.
- [x] Add bounded schema-4 timing/queue/display diagnostics and actual renderer
  identity, optional GPU timers, and native sampling-stage durations.
- [x] Add shipping-worker burst, independently stalled stages, image races,
  failure recovery, PNG equivalence, and fallback/refinement regressions.
- [x] Run the full Buck2 suite with pinned Node and SwiftShader; save repeatable
  before/after timing evidence including decoding.
- [x] Package/validate v0.1.6, preserve v0.1.5, and replace the root CCX.
- [x] Repeat fresh standalone bootstrap, tests, and packaging; update usage,
  validation evidence, GOAL.md, and this checklist with final results.
- [ ] Confirm latency, adapter identity, native sampling costs, and visual HDR
  presentation in Photoshop after installing v0.1.6.

All six Buck2 targets pass: 83 Rust, 23 unit, 8 OCIO, 27 browser, and 32 host
tests (173 total), plus strict TypeScript. Evidence: `.tools/latency-final-tests.log`.
Blocked-stage commits, bounded bursts on all three backends, PNG byte equality,
out-of-order decoding, URL cleanup, and device-info unavailability are covered.
The warmed 12-change panel benchmark includes PNG decoding: median WebGL2
837.1 → 171.0 ms and WebGPU 330.1 → 156.4 ms over three runs each on SwiftShader.
It excludes Photoshop and physical presentation. Evidence:
`.tools/latency-benchmark.json`; reproducible through `buck2 run //:benchmark`.
The validated 1,350,596-byte v0.1.6 CCX is copied to the repository root;
v0.1.5 is preserved in `.tools/previous-package-v0.1.5.ccx`. SHA-256:
`c772cf79077dbed87ee5d370786386085d85744f74b5922b046abfc8069b5b82`.
Evidence: `.tools/latency-package.log` and `.tools/latency-package-report.json`.
Both original diagnostic files retain their recorded hashes. A fresh standalone
copy outside the repository independently bootstraps, passes the same 173 tests
and strict TypeScript, and packages successfully without copying dependencies,
local configuration, or build outputs. Evidence: `.tools/latency-isolation.log`
and `.tools/isolation-report.json` (version 0.1.6). Usage, validation evidence,
the rendering sequence diagram, and native acceptance instructions are current.

Initial diagnostic probe: 12 queued selections plus 12 HDR 256-square slice requests after warmup
on SwiftShader produced 12 WebGL2 PNGs in 896.9 ms versus one WebGPU PNG in
330.2 ms. WebGL2 evaluation took 2.2 ms, preview encoding 243.8 ms, readPixels
wait/readback 317.1 ms, and slice encoding 317.1 ms. PNG totals include DEFLATE;
readPixels includes GPU completion wait. Both backends encoded all 12 previews.
These numbers exclude Photoshop and browser PNG decoding/presentation.

Native foreground verification and rollback are retained; this release measures
their document-dependent sampling cost. GPU resolution/color equations and
existing panel layout requirements remain unchanged. Both supplied diagnostic
files and unrelated parent changes must be preserved byte-for-byte.

## v0.1.5 native resize grip and complete fitted layout (implemented; host acceptance pending)

- [x] Inspect the new diagnostic and confirm eight verified foreground writes;
  identify explicit scrolling, width-driven pad sizing, and the missing grip.
- [x] Update GOAL.md and this checklist before implementation.
- [x] Remove the manifest minimum and request Photoshop's native resize grip
  on show/readiness; preserve an uncovered native drag area and record errors.
- [x] Follow root/window/observer/poll resize paths with bounded history and
  independent WebView bounds; retain lifecycle cleanup.
- [x] Replace the scrolling stack with compact control bands, a square pad,
  and adjacent readouts; fit all content with uniform scaling as needed.
- [x] Use displayed pointer geometry and cancel gestures on allocation changes;
  resizing must not write colors or change PNG rendering/color math.
- [x] Add compatible schema-4 grip/resize/overflow/pad/scale diagnostics and
  redacted evidence from the new real capture.
- [x] Run meaningful native lifecycle, layout, scaled input, resize-race, long
  message, and foreground regression tests through Buck2 with pinned Node.
- [x] Run the full Buck2 suite with SwiftShader; build and validate v0.1.5 CCX,
  retain v0.1.4, and update the repository-root package.
- [x] Repeat independent standalone-copy bootstrap, tests, and packaging.
- [x] Update usage and validation evidence with final results and native checks.
- [ ] Confirm visible native grip, floating drag, and dock-divider resizing in
  Photoshop; record host limits and real all-control fit after installing v0.1.5.

All controls must stay visible without scrolling; no explicit positive minimum
is permitted. Very small allocations may shrink text and controls; Photoshop
can retain its own limits. Real native grip/drag behavior remains unverified.
Both supplied diagnostic files and unrelated parent changes must be preserved.

The native grip request, uncovered strip, lifecycle observation, fitted UI,
scaled pointer geometry, resize cancellation, and expanded diagnostics are
implemented. All six Buck2 targets pass: 83 Rust, 20 unit, 8 OCIO, 19 browser,
and 32 shipping-host tests (162 total), plus strict TypeScript. SwiftShader
executes both GPU paths with zero gamut-mask disagreements. The redacted new
real capture passes eight native foreground-readback checks, including six
pixel-sampling readbacks. Evidence is `.tools/fitted-final-tests.log`.
Buck2 packaging and nine-file archive/runtime validation pass; v0.1.5 is
copied to the repository root and v0.1.4 is retained at
`.tools/previous-package-v0.1.4.ccx`. Evidence is `.tools/fitted-package.log`
and `.tools/fitted-package-report.json`. The 690,967-byte CCX SHA-256 is
`fef7e3d49c56a85e0cee9458fdb47f3161def0025c2a3ef9eeba30908acaebbf`.
A fresh copy outside the repository independently bootstraps, passes the same
162 tests and strict TypeScript, and packages successfully. Evidence is
`.tools/fitted-isolation.log` and `.tools/isolation-report-v0.1.5.json`.
README.md, VALIDATION.md, and HOST_VALIDATION.md record final behavior and
evidence. Both original diagnostics remain byte-identical; unrelated parent
changes are preserved. Implementation and automated delivery are complete;
real Photoshop resize and display acceptance remain pending.

## v0.1.4 native foreground repair (implemented; host acceptance pending)

- [x] Reproduce v0.1.3's rejection of the new real HSB-to-ordinary-RGB result
  with Buck2-pinned Node; distinguish `grain`/`green` aliases from float fields.
- [x] Update GOAL.md and this checklist before implementation.
- [x] Classify ordinary and explicit-float descriptors; read the native
  foregroundColorRGB property without assuming model 15 returns floats.
- [x] Implement modal temporary-duplicate fill and 32-bit ACEScg pixel sampling,
  source-document restoration, cancellation cleanup, and polling cache.
- [x] Retain native descriptors for rollback and verify fresh foreground reads
  after successful, failed, and partially applied writes.
- [x] Add schema-4 read/probe/cleanup diagnostics and backward-compatible
  validation, including a foreground-only host check.
- [x] Add a redacted fixture of the actual new conversion output and tests for
  Sync, release, HDR/negative values, races, failures, and source preservation.
- [x] Run all Buck2 tests with the pinned Node and software GPU.
- [x] Build and validate v0.1.4 plugin and CCX, preserve v0.1.3, and copy the new
  package to the repository root.
- [x] Repeat independent standalone-copy bootstrap, tests, and packaging.
- [x] Update usage and validation evidence with the final results and remaining
  real-Photoshop acceptance checks.

Native Photoshop acceptance is pending: mocks cannot prove native paint/fill
semantics, OCIO/profile preservation in a duplicate, transient-tab behavior,
or performance on large documents. The supplied diagnostic remains untouched.

The reader, native sampling/cache, rollback, and schema-4 validator are
implemented. All six Buck2 targets pass: 83 Rust, 20 unit, 8 OCIO, 16 browser,
and 28 shipping-host tests (155 total), plus strict TypeScript. Browser
integration exercises actual captured ordinary conversion descriptors and
explicitly synthetic native pixels. SwiftShader runs both GPU paths with zero
mask disagreements. Evidence is `.tools/native-foreground-final-tests.log`.
The nine-file v0.1.4 CCX passes archive/manifest/runtime validation and is copied
to the repository root; SHA-256 is
`121923b21c872bddf9241485d6cd8fcf8b17b1e8cb253f8b9c8dbe715802ff32`.
Packaging evidence is `.tools/native-foreground-package.log`; v0.1.3 is
preserved in `.tools/previous-package-v0.1.3.ccx`. A fresh standalone copy outside
the repository independently bootstraps, passes the same six targets and strict
TypeScript, and packages successfully without copied dependencies or local
configuration. Evidence is `.tools/native-foreground-isolation.log` and
`.tools/isolation-report-v0.1.4.json`. Usage, host-validation, and
validation evidence are current. Implementation and automated delivery are
complete; native Photoshop acceptance remains pending.

Status legend: `[ ]` pending, `[x]` complete. Record partial progress and
validation evidence in the notes below. Update this file and GOAL.md whenever
scope, implementation status, or validation results change.

## v0.1.3 foreground synchronization (implemented; host acceptance pending)

- [x] Record the user's release-write and explicit-sync failures and reproduce
  unchanged-color sync, late bridge, hidden status, and masked-error defects.
- [x] Update GOAL.md and this working checklist before implementation changes.
- [x] Add dynamic bridge lookup, acknowledged readiness, bounded retries, and
  five-second reply watchdogs with visible failure feedback.
- [x] Correlate explicit sync responses, force reimport, cancel local gestures
  and queued commits, and preserve requests during busy host refreshes.
- [x] Track active gestures and commit exactly once using final coordinates,
  including outside-control release and unavailable pointer capture.
- [x] Correct the one-second modal timeout and capture callback results
  independently of executeAsModal's return value; retain verified float writes
  and rollback and carry readback in transaction replies.
- [x] Reconcile confirmed host values and preserve pending/failure status
  across polling and stale replies; keep status in the bounded persistent footer.
- [x] Add schema-3 version/bridge/transaction diagnostics and capture failed
  reads; retain validation compatibility with schemas 1 and 2.
- [x] Add meaningful release/sync/bridge/modal/error/diagnostic/layout regression
  coverage, including the shipping host plus embedded browser integration.
- [x] Run all six Buck2 test targets and strict TypeScript with SwiftShader.
- [x] Package v0.1.3 through Buck2, validate the archive, retain v0.1.2, and
  update the repository-root CCX and usage/validation documents.
- [x] Bootstrap, test, and package a fresh v0.1.3 copy outside the repository
  without copying dependencies, Buck output, or local tool configuration.
- [ ] Confirm release writes, explicit Sync, eyedropper updates, and HDR floats
  in real Photoshop/macOS (requires target host; automated mocks cannot verify).

The validated v0.1.3 CCX was the preceding repository-root deliverable. The prior
v0.1.2 CCX is retained in `.tools/previous-package-v0.1.2.ccx`. The original
root diagnostics and unrelated parent-repository changes are preserved.

The final Buck2 run passes all six targets: 83 Rust, 14 unit, 8 OCIO, 15 browser,
and 19 host tests (139 total), plus strict TypeScript. The browser run exercises
SwiftShader on both GPU APIs. Diagnostic review removed a stale reading when
no document is open; that regression and explicit-sync reply timeout/late
recovery pass. Evidence is `.tools/foreground-final-tests.log`. Buck2 packaging
passes archive CRC, nine-file completeness, manifest, and runtime byte checks;
the package is copied to the repository root. Usage and validation documents
are updated. The fresh standalone-copy check passes the same six targets and
packaging after independent bootstrap; evidence is `.tools/foreground-isolation.log`
and `.tools/isolation-report-v0.1.3.json`, which identifies version 0.1.3. Implementation
and automated delivery are complete; target-host acceptance remains pending.

## Foundation

- [x] Create the standalone `photoshop-uxp/` directory.
- [x] Write GOAL.md and CHECKLIST.md before implementation files.
- [x] Confirm macOS 26+, Photoshop 27+, release-only commits, two-way color
  synchronization, document-following previews, and Buck2 requirements.
- [x] Inspect the existing color core, GPU renderer, PNG encoder, reference
  data, and relevant Adobe APIs.
- [x] Establish the independent Buck2 root, rules, toolchains, and dependency
  locks without referencing sibling project directories.
- [x] Copy the required color source, tables, and reference data with
  provenance and license notices.
- [x] Provision Node 26.10.0 with Buck2 and verified per-platform archive hashes;
  use the target for bootstrap, builds, tests, and packaging.

## Color and rendering

- [x] Build the standalone Rust/WASM color core through Buck2.
- [x] Add typed coordinate evaluation and scene-color import interfaces.
- [x] Preserve authoring gamut checks and the two Rec.2020 modes.
- [x] Implement document-view PNG encoding with verified absolute luminance.
- [x] Implement WebGPU slice rendering.
- [x] Implement WebGL2 floating-point fallback and WASM fallback.
- [x] Render the ColorChecker indicators and selected-color preview.
- [x] Handle device loss, render cancellation, stale results, and image errors.

## Panel and Photoshop bridge

- [x] Assemble the UXP manifest, host panel, and bundled local WebView.
- [x] Implement the J′ trackwheel, draggable pad selection, coordinate
  readouts, keyboard interaction, and snapping.
- [x] Implement document-context and supported-view resolution.
- [x] Implement floating-point foreground reads and release-only writes.
- [x] Implement two-way synchronization, feedback suppression, document
  switch handling, and external colors outside the picker domain.
- [x] Add host diagnostics and fixtures that distinguish verified descriptors
  from unverified assumptions.

## Validation and delivery

- [x] Run independent OCIO/numerical checks for all four views, neutrals,
  highlights, saturated colors, boundaries, and ColorChecker references.
- [x] Verify GPU/WASM agreement and PNG sample values and metadata.
- [x] Run interaction, stale-result, foreground-sync, and document-race tests.
- [x] Run manifest, bundle-completeness, and isolation checks through Buck2.
- [x] Build a directory loadable through UXP Developer Tool.
- [x] Build the `.ccx` through a Buck2 packaging target using Adobe’s CLI.
- [x] Write standalone build, test, installation, and host-validation guidance.
- [x] Review changes and report exact automated results and host limitations.

## Mac/Photoshop release acceptance

These checks require the target host and are not completed by mocks or Linux
browser tests.

- [ ] Capture and verify actual OCIO-view and floating-point color descriptors.
- [ ] Verify foreground painting/readback retains values above one.
- [ ] Verify local WebView GPU execution and actual HDR PNG presentation.
- [ ] Verify matching previews in each supported document view and Raw fallback.
- [ ] Verify eyedropper synchronization and document switches in Photoshop.
- [ ] Install and exercise the packaged `.ccx` on macOS.

## 2026-10-09 initial host feedback (v0.1.1)

- [x] Inspect the supplied real-host diagnostics: foreground reads return
  `HSBColorClass`; the document is 32-bit ACEScg; WebGL2 is active.
- [x] Confirm that “background” means Photoshop’s panel/interface color.
- [x] Fix foreground synchronization with the captured descriptor and add
  regression coverage using a redacted fixture.
- [x] Match Photoshop’s interface background and follow theme changes.
- [x] Remove the excessive docked minimum height and contain scrolling within
  the panel; verify a short docked layout.
- [x] Run the relevant Buck2 tests and package the updated extension.
- [x] Update usage/validation documents with the fixes and remaining host checks.

Version 0.1.1 passed all six Buck2 targets: 116 tests plus strict TypeScript.
The HSB input comes from the supplied capture; native conversion responses
are explicitly mocked. The adapter calls `core.convertColor` with RGB model
15 and accepts only floating-point channels. Diagnostics now retain that
conversion result and obtain the Photoshop version from `uxp.host.version`.
Browser checks pass at 380×760, 340×360, 300×280, and 280×180. They verify
bounded panel dimensions, internal scrolling, accessible lower controls, and
exact host background colors in light and dark themes. Buck2 packaging passes
with manifest/runtime/CRC checks. The v0.1.1 CCX was copied to the repository root;
the previous root package is retained at `.tools/previous-package.ccx`.

## v0.1.2 resizing and render cost

- [x] Confirm the actual failure: Photoshop's boundary moves, content stays fixed.
- [x] Confirm the vertical layout should grow with width and normal gamut
  slices should render at 256×256; keep WASM gestures at 128×128.
- [x] Add native root observation and explicit WebView pixel sizing across
  show, ready, resize, hide, and destroy.
- [x] Add panel, applied/measured WebView, viewport, and slice dimensions to
  schema-2 diagnostics.
- [x] Reduce all completed slice paths to 256×256 without changing color math.
- [x] Test native sizing lifecycle, outer-container resizing, wide/short layouts,
  selection positioning, and every renderer's output dimensions.
- [x] Run Buck2 tests with SwiftShader and package v0.1.2.
- [x] Refresh documentation and copy the validated CCX to the repository root.

All six Buck2 targets pass: 120 tests plus strict TypeScript, including
independent dimension changes, hidden/zero-sized panels, duplicate callbacks,
root replacement, missing-observer fallback, and cleanup. The outer-container
test confirms native/embedded dimensions through 1000×800, square-pad growth,
scrolling, aligned selection, and an unchanged neighboring allocation. Output
dimensions pass on all renderer paths and all four views. The combined run is
recorded in `.tools/resizing-final-tests.log`: 83 Rust, 12 unit, 8 OCIO, 6 browser,
and 11 host tests, plus TypeScript. Buck2 packaging validates the nine runtime
files, manifest, CRCs, and byte equality. The v0.1.2 CCX is copied to the repo
root; the v0.1.1 archive is retained at `.tools/previous-package-v0.1.1.ccx`.
README.md, HOST_VALIDATION.md, and VALIDATION.md describe the new sizing and
diagnostics. Actual Photoshop confirmation remains pending; the older notes
below describe v0.1.1.

## Previous implementation and validation notes

- All implementation and automated delivery items above are complete. The six
  Mac/Photoshop release acceptance checks remain pending.
- Node 26.10.0 is a Buck2 download/extraction target with official SHA-256
  values for Linux x64 and both Mac architectures. Every JavaScript tool uses
  that artifact. Buck2 provisions, builds, tests, and packages the extension.
- GOAL.md and this checklist were the first files created in this directory.
  Implementation stays within this standalone directory.
- `buck2 test //tests/...` passes six targets: 83 Rust, 12 unit, 8 OCIO, 5
  browser, and 8 host tests (116 total), plus strict TypeScript.
- SwiftShader is confirmed as the software GPU. WebGPU and WebGL2 each match
  11,424 sampled WASM channels within 0.174% (normalized by max(1, abs(channel))),
  with no mask differences across four views, two gamut modes, and five J′
  levels. Peak-neutral f32 rounding is handled explicitly. Device failure,
  WebGL2 fallback, and WASM fallback tests pass.
- PNG tests verify PQ samples in absolute nits without a 2.03 output uplift,
  HDR cICP metadata, SDR ICC profiles, and alpha. Expanded OCIO tests include
  negative and over-range external colors and the J′ .150 surround. The view
  wrapper applies OCIO's AP1 input range for presentation and preserves the
  original scene floats.
- The shipping host bundle passes synthetic lifecycle, context, HDR modal
  write, stale-document, missing-float, and diagnostics tests. Every foreground
  write verifies readback and restores the previous color on a mismatch.
  The HSB input fixture is redacted from the user's real capture. Native
  conversion responses and the Photoshop transport remain explicitly synthetic.
- The CCX builds through Adobe's offline CLI packaging handler. Archive
  contents, manifest, runtime bytes, and CRCs validate. Connected-host
  manifest validation and actual installation remain unverified.
- A freshly copied extension outside the repository independently bootstrapped
  its dependencies and passed tests and packaging. No sibling project folder,
  node_modules, Buck output, or local tool configuration was copied.
- README.md, HOST_VALIDATION.md, and VALIDATION.md document usage, exact test
  evidence, and remaining host acceptance. Parent source changes and the supplied
  diagnostics are preserved; the root CCX is updated to the new release.
