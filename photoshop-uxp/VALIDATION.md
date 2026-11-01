# Validation evidence

Date: 2026-10-10. Environment: Linux x64, Buck2
2026-08-22-c89474de8970db1d3784063e2fb1efb1803bb177, Buck-managed Node 26.10.0,
Rust 1.99.0, OpenColorIO 2.5.0, Playwright 1.63.0 / Chromium 153.0.8010.12.

## v0.1.7 HDR normalization and presentation

`buck2 test //tests/...` passes all six targets: **174 tests** plus strict
TypeScript. Evidence: `.tools/hdr-fix-final-tests.log`.

| Target | Result | Relevant coverage |
| --- | --- | --- |
| `//tests:rust` | 83 passed | Physical neutral endpoints and surround units, existing display/AP0 helpers and appearance tests |
| `//tests:unit` | 24 passed | Independently decoded black/203-nit/1000-nit previews and slices; exact and float32 scene imports in both gamut modes; existing foreground and PNG checks |
| `//tests:ocio` | 8 passed | Independent appearance + official OCIO inverse/forward with the corrected normalization; all 18 ColorChecker coordinates and forward fills |
| `//tests:browser` | 27 passed | Both GPU APIs and gamut masks; actual GPU-to-PNG white/peak samples; normal layout without transforms, small-panel scaling, existing interaction/host/performance regressions |
| `//tests:host` | 32 passed | Existing native foreground, sampling, rollback, Sync and resize guarantees |
| `//tests:typecheck` | Passed | Strict TypeScript |

On SwiftShader, WebGPU and WebGL2 have zero tested mask mismatches against WASM
across all four views and both gamut modes. Maximum relative RGB differences
are **0.003904** and **0.003879**, respectively. Eight GPU luminance anchors per
backend encode white/peak within 0.5 nit. Evidence: `.tools/test-results/gpu.json`.
The tests caught the WebGL entry point's separate conversion and a peak-white
round-trip rejection in limited mode before the completed fix. Numerically
neutral/black imports now have stable coordinates, with the original scene
matching guard retained.

`buck2 build //:hdr_audit //:package --show-output` passes. The shipping PNGs
encode reference white as **202.987 nits** and neutral J′ = 1 as **1000.002 nits**
in both HDR views. Official ACES 2.0 display/PQ agreement remains within 16-bit
quantization: maximum normalized code error **0.000006888**. Evidence:
`.tools/hdr-fix-package.log` and the audit `report.json`.
The nine-file CCX's manifest, CRCs and runtime bytes are validated, and the
1,351,987-byte v0.1.7 package is copied to the repository root. SHA-256:
`99522e80107d36d328d6cdc31e3f07d309b9c27ab2ecf5b6c8a632530e560301`.
Evidence: `.tools/hdr-fix-package-report.json`. Version 0.1.6 is retained in
`.tools/previous-package-v0.1.6.ccx`; both supplied captures retain their hashes.

A fresh standalone copy independently bootstraps tools, passes the same 174
tests and strict TypeScript, builds the HDR audit, and packages outside the
repository without copied dependencies or local configuration. Evidence:
`.tools/hdr-fix-isolation.log` and `.tools/isolation-report.json` (v0.1.7).
Existing scene colors are preserved on import; the same picker coordinates now
produce corrected ACEScg colors. Physical Photoshop WebView HDR remains a Mac
acceptance check. See HDR_PRESENTATION.md for the identical-PNG comparison.

## Pre-fix HDR PNG audit (v0.1.6)

`buck2 build //:hdr_audit --show-output` passes. Its assertions independently
decode the shipping encoder's 16-bit RGB/RGBA PNGs, check CRCs/cICP and opaque
alpha, and verify 0, 18, 50, 100, 203, 500 and 1000-nit patches within 0.1 nit.
For eight ACEScg colors in each HDR view, shipping WASM plus PNG agrees with
the complete official OCIO ACES 2.0 PQ display processor to a maximum normalized
code error of **0.000006888**, within 16-bit quantization. The target emits
`report.json`, reference/neutral PNGs, `probe.html` and `panel-inspector.js`.
Evidence: `.tools/hdr-audit-build.log` and the target's `report.json`.

The actual parent encoder applies 2.03 before PQ and the extension does not.
Both have identical HDR metadata. Independent EOTF decoding finds linear 1
→ 203 versus 100 nits, and linear 10 / 2.03 → 1000 versus 492.629 nits.
The neutral picker at J′ = 1 likewise encodes 492.629 nits. Evidence:
`.tools/hdr-encoder-comparison.json` and the audit report. The parent comparison
is read-only workspace evidence, not a standalone extension dependency.

`buck2 test //tests:unit //tests:ocio` passes **31 tests** (23 unit, 8 OCIO).
Evidence: `.tools/hdr-audit-tests.log`. A Playwright check launched with pinned
Buck2 Node and SwiftShader decodes all four reference images, checks range
buttons, and verifies panel-probe image/style restoration. Evidence:
`.tools/hdr-probe-browser.log`. These checks do not verify physical HDR.
Production color math, panel layout, manifest and v0.1.6 CCX are unchanged;
the earlier full-suite/package results below remain the release evidence.
See HDR_PRESENTATION.md for primary sources, normalization and WebView findings,
the separate authoring fix plan, and the pending Mac presentation comparisons.

## v0.1.6 rendering latency and foreground independence

`buck2 test //tests/...` passes all six targets: **173 tests** plus strict
TypeScript. Evidence: `.tools/latency-final-tests.log`. Both GPU paths execute
on SwiftShader; maximum numerical differences and gamut masks remain as
reported under Software GPU below. The validated v0.1.6 CCX is copied to the
repository root, with v0.1.5 preserved. A fresh standalone copy independently
bootstraps, passes the same 173 tests and strict TypeScript, and packages outside
the repository. Evidence: `.tools/latency-isolation.log` and
`.tools/isolation-report.json` (version 0.1.6).

| Target | Result | Relevant coverage |
| --- | --- | --- |
| `//tests:rust` | 83 passed | Existing appearance/color math |
| `//tests:unit` | 23 passed | Exact preview PNG byte equality in all four views, HDR/nonfinite inputs, queue replacement, priority, stale replies, worker recovery and cleanup |
| `//tests:ocio` | 8 passed | Existing independent four-view oracle |
| `//tests:browser` | 27 passed | Bounded bursts on all three backends, no duplicate GPU release render, WASM refinement, foreground commits while rendering/encoding/decoding stalls, stale decode rejection, failed-image retention and retry, Blob cleanup, device/timer visibility, existing layout/host regressions |
| `//tests:host` | 32 passed | Native sampling timings and all existing fresh-read, preservation, rollback, Sync and resize checks |
| `//tests:typecheck` | Passed | Strict TypeScript including all three generated workers |

The prior worker combined color evaluation, preview PNG encoding, and slices.
Synchronous WebGL `readPixels` and PNG encoding blocked its message handler;
the internal latest-request slot could not see the browser's queued messages.
Every obsolete WebGL slice therefore ran. Selection replies also waited for
preview PNGs, the drag flag triggered a redundant GPU render on release, and
the renderer label changed before the image decoded.

The current flow follows `web/app.ts`, `jobs.ts`, `color_worker.ts`,
`preview_worker.ts`, `worker.ts`, `webgpu.ts`, `webgl.ts`, and `presentation.ts`:

```mermaid
sequenceDiagram
    participant UI as Panel / sender queues
    participant Eval as Evaluation worker
    participant Preview as Preview worker
    participant Slice as Slice worker
    participant GPU as GPU API
    participant Image as Browser image decoder
    participant PS as Photoshop host
    UI->>Eval: Latest selection (one active, replace pending)
    UI->>Slice: Latest distinct J′ / view / gamut / size
    par Color and foreground
        Eval->>Eval: WASM color evaluation
        Eval-->>UI: ACEScg floats + preview colors (no PNG)
        opt Released and still current
            UI->>PS: Commit foreground
            PS->>PS: Fresh read, write, fresh verification / rollback
            PS-->>UI: Verified result + native stage timings
        end
        UI->>Preview: Latest preview colors
        Preview->>Preview: Quantize distinct colors, fill rows, DEFLATE / PNG
        Preview-->>UI: Transfer PNG buffer
        UI->>Image: Decode candidate offscreen
    and Gamut slice
        alt WebGPU
            Slice->>GPU: Submit compute shader and readback copy
            GPU-->>Slice: mapAsync completion + mapped floats
        else WebGL2
            Slice->>GPU: Draw with fragment shader
            Slice->>GPU: readPixels (synchronous completion wait + readback)
            GPU-->>Slice: Float32 pixels
        else WASM fallback
            Slice->>Slice: CPU slice, 128² during gesture / 256² on release
        end
        Slice->>Slice: CPU PQ/SDR packing, DEFLATE, PNG assembly
        Slice-->>UI: Transfer PNG + backend/device/timings
        UI->>Image: Decode candidate offscreen
    end
    Image-->>UI: Decode complete
    UI->>UI: Install only current image; then update displayed status
```

All queues are bounded at the sender: one active job and one replaceable job
per kind. Evaluation takes priority over pending checker evaluation; preview
takes priority over pending checker PNGs. No image work gates foreground
delivery. Rendering keys use actual inputs, effective resolution and backend
generation, so GPU release reuses an identical slice; WASM still refines from
128² to 256². GPU math and 256² resolution are unchanged. The previous displayed
image survives failed decoding, and replaced/cancelled Blob URLs are revoked.

The shipping-panel benchmark uses a warmed, synchronous 12-key J′ burst, three
runs per version/backend, Chromium and SwiftShader. The endpoint is the latest
decoded image checked at an animation frame, not physical display presentation.

| Backend | v0.1.5 median | v0.1.6 median | Slice PNGs per burst, before → after |
| --- | ---: | ---: | ---: |
| WebGL2 | 837.1 ms | 171.0 ms | 12 → 2 |
| WebGPU | 330.1 ms | 156.4 ms | 1 → 2 |

Both backends reduce preview PNGs from twelve to one in this burst. WebGPU's
former asynchronous readback allowed its pending slot to coalesce into one
slice, but still blocked behind twelve preview encodes. The new independent
slice worker starts immediately and processes the initial and latest requests.
Per-run results, device strings and stage timings are saved in
`.tools/latency-benchmark.json`; reproduce with `buck2 run //:benchmark`.
The preserved v0.1.5 build is `.tools/latency-v0.1.5`; a standalone checkout can
benchmark only the current build or accept another baseline via `--baseline`.

`queueMs` measures sender waiting; `transportMs` ends at worker arrival.
`readbackWaitMs` includes GPU completion wait, so it is not a pure memory-copy
measurement. `gpuMs` is a timestamp-query duration where supported and otherwise
null; WebGL queries are polled asynchronously without delaying the PNG.
`packMs` covers CPU sample conversion/row packing, `compressMs` covers IDAT
DEFLATE, and `pngMs` includes both plus assembly (do not add them twice).
`decodeMs` ends at browser decode completion. Requested/displayed frame IDs,
J′ values, device identity, queue counters, and a 32-entry stage history are
available in compatible schema-4 diagnostics. Explicit software adapter
strings identify software execution; masked identity remains unknown.

The benchmark's foreground endpoint is sending to a mock host. It excludes
Photoshop writes and native pixel sampling, and cannot establish the user's
complete five-second delay. Native duplicate/crop/fill/getPixels/getData/close
durations are now recorded without removing fresh reads or rollback. Real
Photoshop latency, HDR appearance and native grip/drag acceptance remain in
`HOST_VALIDATION.md`.

## v0.1.5 resize validation (preceding release, 2026-10-09)

For version 0.1.5, `buck2 test //tests/...` passed all six targets: **162 tests**
plus strict TypeScript. Evidence is `.tools/fitted-final-tests.log`. Buck2
packaging and archive/runtime validation pass. A fresh standalone copy outside
the repository independently passes bootstrap, the same tests and strict
TypeScript, and packaging. Evidence is `.tools/fitted-isolation.log` and
`.tools/isolation-report-v0.1.5.json`.

| Target | Result | Added resize coverage |
| --- | --- | --- |
| `//tests:rust` | 83 passed | Existing color math unchanged |
| `//tests:unit` | 20 passed | Existing conversion, PNG, and native foreground checks |
| `//tests:ocio` | 8 passed | Existing four-view oracle coverage |
| `//tests:browser` | 19 passed | All-control fit, square pad constrained by both dimensions, full error wrapping, scaled pointer distances, active/queued gesture cancellation, no idle resize renders/writes, theme, neighboring allocation, diagnostics |
| `//tests:host` | 32 passed | Grip show/readiness requests, API failure/absence, stale asynchronous requests, root resize events, uncovered native strip, bounded resize history, redacted real capture validation, existing foreground regressions |
| `//tests:typecheck` | Passed | Strict TypeScript |

Version 0.1.5 removes `minimumSize`, retains preferred initial sizes, and uses
a large `maximumSize`. The shipping host requests
`core.suppressResizeGripper({type:'panel', target:'picker', value:false})` on
show/readiness. It leaves a native strip below the separate browser surface:
20 pixels normally, capped at a quarter of very short allocations. Tests
verify native root resize events, observer/window/poll fallbacks, lifecycle
cleanup, unavailable/failed grip API results, and rejection of stale grip
responses. Diagnostics preserve schema 4 and existing bounds fields while
adding grip status/error, size configuration, and the last eight allocations.

Inner-page tests fit all controls at 380×760, 340×360, 300×280, 280×180,
800×180, 180×120, 120×80, and 40×40, including the full status and readouts.
The native harness independently changes allocations through 280×180,
340×360, 800×360, 340×800, 800×800, 1000×800, and 120×40. It confirms the
uncovered native strip, matching browser bounds, a square pad constrained by
both dimensions, and an unchanged 120-pixel neighboring panel. All controls
remain in the viewport with no main/page scroll range. Long error text wraps
completely, with the entire interface scaling when needed. Displayed pad and
wheel geometry produces the same normalized input at normal and reduced
scales. Allocation changes cancel active and queued releases. Idle resizing
does not send render requests or foreground writes; PNGs remain 256×256.

Screenshots are `.tools/test-results/panel-docked-dark.png`,
`panel-short-light.png`, `panel-outer-wide.png`, and
`panel-complete-long-error.png`. They verify layout, not HDR luminance. An
accepted grip API call and browser fixture do not establish visible native
grip or drag behavior. Photoshop acceptance is specified in HOST_VALIDATION.md.

The user's new real capture, `modcam16-host-diagnostics2.json`, passes eight
native readback checks under `--foreground-only`. The redacted fixture
`tests/fixtures/photoshop-resize-foreground.json` retains native foreground,
sample metadata/cleanup, transaction readings, and the 280×180 allocation;
document names, paths, XMP, commands, and timestamps are omitted. Six readbacks
use native 32-bit ACEScg sampling and two use explicit float descriptors,
including values above one. This is real foreground evidence; it does not
establish source preservation, performance, visible native grip/drag behavior,
view discovery, or HDR display matching. The original capture remains untouched.

For the preceding version 0.1.4, `buck2 test //tests/...` passed all **six targets**, with
**155 tests** plus strict TypeScript checking. The final combined run is
`.tools/native-foreground-final-tests.log`. Packaging and the fresh
standalone-copy bootstrap/test/package check pass.

| Target | Result | Coverage |
| --- | --- | --- |
| `//tests:rust` | 83 passed | Appearance math, authoring domains, conversions, reference patches |
| `//tests:unit` | 20 passed | WASM/PNG/views, descriptor units and aliases, native RGB property, actual ordinary conversion fixture, sample metadata/opacity/cleanup, modal transactions, float32/HDR readback, partial-write/native-descriptor rollback and races |
| `//tests:ocio` | 8 passed | All four views; inverse authoring; forward neutrals, highlights, saturated, negative, and over-range inputs; J′ .150 surround; all 18 patches |
| `//tests:browser` | 16 passed | Both GPU paths, native-sampled Sync/release/readback with captured ordinary conversion, final-sample release, bridge/watchdogs, stale replies, native errors, WASM fallback, theme and short/wide sizing |
| `//tests:host` | 28 passed | Shipping bundle, native sampling/cache/fresh Sync, negative/HDR pixels, cleanup/cancellation/profile failures, source preservation, external focus races, partial-write native rollback, structured schema-4 validation, queue/bridge and sizing |
| `//tests:typecheck` | Passed | Strict TypeScript checking of generated and hand-written source |

## Software GPU

The browser reports `vendor: google`, `architecture: swiftshader`. Hardware GPU
access is not needed. Both GPU APIs run actual shaders and floating-point
readbacks; their results are compared with the independent f64 WASM path.

Across four views, two authoring gamut modes, five J′ levels, and 17×17 grids:

- WebGPU: 11,424 compared color channels; maximum normalized difference
  0.001734853; zero mask disagreements.
- WebGL2: 11,424 compared color channels; maximum normalized difference
  0.001736283; zero mask disagreements.

Difference is normalized by `max(1, abs(WASM channel))`; this is a numerical
renderer comparison, not a perceptual error metric. The exact peak-neutral
anchor has an explicit f32 rounding guard. Normal pad renders are 256²;
WASM uses 128² during gestures and returns to 256² on completion.
Browser test artifacts are written under `.tools/test-results/`, including
`gpu.json` and an SDR screenshot of the panel. The screenshot cannot validate
HDR luminance.

Expanded OCIO tests caught the inherited forward wrapper's missing AP1 input
range for negative colors. The extension now applies the official view group's
SDR [0,1024] or HDR [0,4096] input range to **presentation only**, while retaining
the original foreground floats. The oracle tests use the bundled official
config and PyOpenColorIO processors, separate from Rust and shader equations.

## Packaging and independence

`buck2 build //:package` succeeds using Adobe CLI/core 1.2.0's offline packaging
implementation. The action verifies CCX CRCs, the complete file list, the
manifest, and exact runtime byte equality with the plugin directory.
`packaging.json` records the tool versions and states that connected-host
validation has not run.

The v0.1.6 build passes and its 1,350,596-byte, nine-file CCX is copied to the
repository root. SHA-256:
`c772cf79077dbed87ee5d370786386085d85744f74b5922b046abfc8069b5b82`.
Evidence: `.tools/latency-package.log` and `.tools/latency-package-report.json`.
The report verifies manifest semantic equality (Adobe normalizes formatting),
exact runtime bytes, archive CRCs, the root copy, the v0.1.5 backup, and unchanged
hashes for both supplied diagnostic files. The v0.1.5 archive is retained at
`.tools/previous-package-v0.1.5.ccx`.

`buck2 run //:isolation` copied this extension's source into a fresh temporary
Buck2 root, without node_modules, `.tools`, local configuration or build outputs.
The independent bootstrap, full test suite, and package build all passed for
v0.1.6. Evidence: `.tools/latency-isolation.log` and `.tools/isolation-report.json`.

The preceding v0.1.5 build passed; its 690,967-byte, nine-file CCX was copied to
the repository root. SHA-256:
`fef7e3d49c56a85e0cee9458fdb47f3161def0025c2a3ef9eeba30908acaebbf`.
Build evidence is `.tools/fitted-package.log` and `.tools/fitted-package-report.json`.
The preceding v0.1.4 archive
is retained in `.tools/previous-package-v0.1.4.ccx`.

The preceding v0.1.4 build passed; its 689,319-byte, nine-file CCX was copied to the
repository root. SHA-256:
`121923b21c872bddf9241485d6cd8fcf8b17b1e8cb253f8b9c8dbe715802ff32`.
Build evidence is `.tools/native-foreground-package.log`; the preceding v0.1.3
archive is retained in `.tools/previous-package-v0.1.3.ccx`.

The preceding v0.1.3 build passed. Its CCX SHA-256 was:
`6f7e3b894a6ff41fd571789b3b1e33d94b7910930adfc9290701f7289dc2f79f`.
Build evidence is `.tools/foreground-package.log`. The previous v0.1.2 root
archive is retained in `.tools/previous-package-v0.1.2.ccx`.

The preceding v0.1.2 build passed. Its CCX SHA-256 was:
`76ddfad12fc45588b26e7e52b0d4cd0ea427df1f7ef014cef8a3d7543ab746af`.
Build evidence is `.tools/resizing-package.log`; the previous v0.1.1 root
archive is retained in `.tools/previous-package-v0.1.1.ccx`.

The previous v0.1.1 build passed. Its CCX SHA-256 was:
`fb0ac316a6be14607665c7d051ad9decffcce5def28104093710f55490edbe39`.
Build evidence is `.tools/host-fixes-package.log`; the previous root archive is
retained in `.tools/previous-package.ccx`.

For v0.1.4, `buck2 run //:isolation` copied only this extension's source into a
fresh temporary Buck2 root outside the repository, independently bootstrapped
its dependencies, passed the same 155 tests and strict TypeScript, and packaged
successfully. No node_modules, Buck output, `.tools`, or local configuration was
copied. Evidence is `.tools/native-foreground-isolation.log` and
`.tools/isolation-report-v0.1.4.json`.

For v0.1.3, `buck2 run //:isolation` copied only this extension's source to a
new temporary directory outside the repository, bootstrapped its own tool
dependencies, passed the same 139 tests plus strict TypeScript, and packaged
successfully. Neither node_modules nor Buck output nor local configuration was
copied. Evidence is `.tools/foreground-isolation.log` and the versioned report
at `.tools/isolation-report-v0.1.3.json`. The initial release's report is retained at
`.tools/isolation-report-previous.json`.

## Host-feedback regression coverage

The user's 2026-10-09 capture contains a 32-bit ACEScg document and an
`HSBColorClass` foreground. The initial float-only reader rejected it. A
redacted fixture at `tests/fixtures/photoshop-hsb.json` retains the relevant
fields without filenames, paths, or document metadata. The capture also
confirms WebGL2 execution; its document descriptor has no discoverable OCIO
view, so HDR 1000 nits Rec.2020 remains the documented fallback.

The v0.1.1 reader delegated conversion to `core.convertColor` with RGB model 15,
then decoded only native floating-point RGB fields. Tests passed the exact HSB
input into a mock native converter, verify model 15, preserve over-range and
negative mock results, and verified that errors or ordinary RGB results alone
could not enable writes. Those were transport tests, not a measured conversion of that HSB
value. The capture validator supports both original direct-float captures and
schema-2/3 captures with native conversion results. Host version is obtained
from `uxp.host.version`, fixing the missing version in the supplied capture.

The native panel uses Photoshop's theme variables and sends the computed
colors into the WebView. Browser tests verify exact background, text, and
border colors when changing between dark and light themes. Host tests also
verify theme updates without an open document. The v0.1.1 layout tests covered 380×760,
340×360, 300×280, and 280×180: the page stays within its allocated dimensions,
the center scrolled, and lower controls and the fixed footer remained accessible.
Version 0.1.5 replaces that layout with all-control fitting without scrolling.
Screenshots are `.tools/test-results/panel-docked-dark.png` and
`panel-short-light.png`. The full run is `.tools/host-fixes-tests.log`.

## v0.1.2 native resizing and render dimensions

The user's follow-up established that Photoshop's panel boundary moves while
the embedded content stays fixed. The previous browser tests changed only the
inner page's viewport and did not exercise that native boundary.

The shipping host now observes the root supplied by Photoshop and applies
pixel width/height to both native WebView attributes and inline CSS. Tests
verify independent dimension changes, duplicate callback suppression,
zero/nonfinite dimensions, show/ready reapplication, hide/destroy cleanup,
root replacement, and fallback through resize events and existing polling.
A late ready message cannot reactivate a hidden panel.

The v0.1.2 browser harness loaded the shipping host bundle and actual picker page
inside an independently sized panel container, starting with fixed native
bounds. It resizes the container through 280×180, 340×360, 800×360, 800×800,
and 1000×800 while the outer page stays 1400×1100. Native attributes, inline
dimensions, embedded viewport, and diagnostic dimensions agree. The pad uses
the allocated width, stayed square, scrolled internally, and retained aligned
selection coordinates. A neighboring fixture panel keeps its 120-pixel height.
The current `.tools/test-results/panel-outer-wide.png` shows the v0.1.5 fitted layout.

Normal PNGs are 256×256 through WebGPU, WebGL2, and WASM; WASM gesture PNGs
are 128×128 and refine to 256×256 on release. All four view changes preserve
256×256 output in the native sizing harness. The normal slice now contains
65,536 pixels instead of 262,144, one quarter of the previous rendering and
readback pixel count. Coordinate math and PNG color metadata are unchanged.
Schema 2 gains layout bounds and capabilities viewport/slice dimensions;
the existing capture validator remains compatible.

## v0.1.3 foreground synchronization and transaction feedback

The user reported no Photoshop foreground update on release, no visible status,
and an ineffective Sync button. Local probes reproduced unchanged-color sync
being ignored, a bridge reference captured before injection, status inside
scrolled content, and failure feedback overwritten by context messages. The
original schema-1 capture cannot identify the current native write failure.

The WebView now looks up the bridge dynamically, retries readiness with an
acknowledged request ID, and has five-second connection/read/write/evaluation
watchdogs. Explicit sync forces a fresh import, cancels local gestures and
unsent evaluation work, survives a busy host queue, and rejects superseded
replies. Host reads share the foreground transaction queue, so an active write
finishes before sync reads its actual result.

Pointer release uses its final sample and active pointer ID, waits for the
corresponding evaluation, and sends one commit. Window-level release works
when native pointer capture is unavailable. Pointer cancellation, blur, and
stale document/request work do not send a new write. The modal acquisition
timeout is one second; callback results are retained independently of the
documented void return. Readback remains strict and accepts normal float32
rounding without accepting clamped HDR values.

Host replies carry verified/restored foreground floats. The panel reconciles
readouts after success or failure and keeps errors across unchanged polling.
Status moved into the bounded footer and remains visible at 280×180. Missing
replies have distinct feedback; late responses are accepted only while current.
Schema 3 records extension version, bridge observations, the last eight client
and host transactions, exact native commands/results/errors, readback, and
restoration. Failed reads still save; no-document captures cannot reuse old
foreground data. The capture validator accepts schemas 1, 2, and 3 and rejects
applied transactions whose requested floats differ from readback.

The browser integration fixture loads the shipping host bundle and embedded
picker. It verifies synthetic HSB-to-RGB conversion, unchanged-color sync,
HDR native float32 writes, modal errors, rejected native gets, restoration after
clamping, retained failure text, and saved diagnostics. Native conversion and
Photoshop execution are explicitly mocked; these cases verify transport and
state behavior. `.tools/test-results/panel-foreground-error.png` shows the
persistent error footer. Full tests and both SwiftShader GPU comparisons pass.

## v0.1.4 ordinary native RGB and pixel sampling

The new v0.1.3 Photoshop 27.11.0 diagnostic proves the remaining blocker:
`core.convertColor` model 15 returns `_obj: RGBColor` with `red`, `grain`, and
`blue`, not explicit float fields. The captured values are 200.92996108949416,
200.92217898832683, and 38.09338521400778. The reader previously rejected this
output; foreground remained null and the write guard blocked releases.
`tests/fixtures/photoshop-hsb-ordinary-rgb.json` retains only the relevant
actual input/output and host/document information, with explicit provenance.
The supplied root diagnostic is preserved byte-for-byte (SHA-256
`309ee94c6f9b9284caec915dcb11ab628c1cca8eb7f6cf25807273a54155d9e9`).

The reader classifies ordinary and explicit float channels, supports both
`grain` and `green`, checks `foregroundColorRGB` before conversion, and records
ordinary conversion without assigning scene-linear units. Without native
floats, a modal source duplicate is verified as 32-bit ACEScg, cropped to 1×1,
and filled on an owned pixel layer using the native foreground, Normal blend,
100% opacity, and transparency preservation disabled. Imaging returns native
Float32 data with no guessed profile conversion. Sampling requires matching
profile/depth, a 1×1 RGB shape, finite RGB and opaque alpha, disposed image data,
closed duplicate, registered auto-close, and restored source document. Failed
or unverified samples cannot enable writes.

Tests cover polling cache reuse, fresh explicit Sync/diagnostics/transaction
reads, notification invalidation, negative and HDR pixels, source state
preservation, wrong profiles/depth, failures across native probe stages,
cancellation with auto-close, buffer disposal, and external document switches
including a close operation that activates the source. Transactions reuse one
modal scope and restore the original native HSB descriptor after partial writes
or readback failures; traces retain native errors. The embedded shipping picker
imports the sampled color, refreshes an unchanged descriptor from new synthetic
pixels, previews during dragging, and writes exactly once on release with
verified sampled readback. All native pixel values are explicitly synthetic;
the real capture has no 32-bit pixel measurements.

Schema 4 records the chosen foreground source, native RGB property/conversion,
sample metadata/alpha/cleanup/stages, and structured per-transaction readings.
The validator supports schemas 1–4 and requires native readback evidence for
applied schema-4 transactions. `--foreground-only` removes view-coverage gates
while retaining foreground/sample/readback checks; invalid cleanup or tampered
readback fails. Current OCIO-view discovery remains independently unconfirmed.
Full Buck2 tests and strict TypeScript pass with the pinned Node and both
SwiftShader GPU APIs; packaging verifies all nine runtime files. See the
standalone-copy evidence above for that check's current status.

## Not yet verified

No interactive Photoshop or macOS HDR host was available here. The supplied
captures establish the HSB descriptor, ordinary RGB conversion response, and
WebGL2 renderer. They do not establish the new native pixel path or UI behavior.
Updated Photoshop float readback, native Fill semantics, duplicate/profile
preservation, transient-tab behavior and large-document performance, OCIO view
discovery, theme/docking behavior, displayed HDR, visual matching, and v0.1.4
CCX installation need target-host confirmation.
Follow [HOST_VALIDATION.md](HOST_VALIDATION.md). Synthetic transport and Linux
browser results do not establish those properties.
