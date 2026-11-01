# modCAM16 HDR Picker for Photoshop

A standalone UXP panel for **32-bit floating-point ACEScg documents managed by
OpenColorIO**, targeting Photoshop 27+ on macOS 26+. It includes a J′ trackwheel,
x′/y′ color plane, 18 ColorChecker indicators, and P3-D65-limited or full Rec.2020
authoring. Saturation remains **s = 75 C / J_A**, with J_HK = 217.2768649129496 J′.

Version **0.1.7** fixes the 203-nit authoring-to-OCIO unit conversion: reference
white now encodes 203 nits and neutral J′ = 1 reaches 1000 nits in both HDR views.
Foreground imports and ColorChecker coordinates use the corrected units.
Normally sized panels avoid a CSS transform, while small panels still scale;
images explicitly allow HDR headroom where supported. Actual HDR output inside
Adobe's WebView still requires Mac acceptance.

The panel separates foreground evaluation from slice rendering and PNG
encoding. Drag requests replace obsolete pending work instead of building a
worker backlog; GPU release reuses an identical slice. New PNGs replace the
previous image only after decoding. The renderer label identifies software
rendering when reported; hover it for adapter and timing details, or save
Diagnostics for the full breakdown. A reported API name alone does not prove
physical GPU execution.

The panel requests Photoshop's native resize grip and leaves its drag
area uncovered below the WebView. The panel has no extension-imposed minimum
size or vertical scrolling. Its compact layout keeps every control and readout
visible, fits a square pad to both dimensions, and scales the whole interface
when necessary. Resize diagnostics record the grip request, recent allocations,
UI scale, and overflow measurements. Actual native handle behavior requires
Photoshop acceptance.

The foreground reader handles the captured Photoshop HSB conversion that returns
ordinary `red/grain/blue` fields. It reads native RGB floats when available;
otherwise it paints the native foreground in a temporary document duplicate
and samples a 32-bit ACEScg pixel. Polling caches successful samples; Sync and
write verification read freshly. Failed writes restore the original native
foreground descriptor. Diagnostics include sampling and cleanup evidence.
Release still waits for the final coordinates, and status stays in the footer.
The new real Photoshop capture verifies eight applied foreground transactions,
including native pixel sampling and HDR float readback. Source preservation,
transient duplicate behavior, performance, and HDR display matching still need
target-host acceptance. The normal pad renders at **256×256**.
See [VALIDATION.md](VALIDATION.md),
[CHECKLIST.md](CHECKLIST.md) for current evidence and
[HOST_VALIDATION.md](HOST_VALIDATION.md) for required host acceptance.

## Build, test, and package

Work from this directory, which is its own Buck2 root. It can be copied outside
the parent repository. Prerequisites: Buck2 (tested revision in toolchains.json),
Rust 1.99.0 through rustup, and Python 3.12+ with venv/pip. An OCIO source-wheel
build may additionally need CMake and a C++ compiler on Python versions without
a published wheel. Node on PATH is not used.

```sh
cd photoshop-uxp
buck2 run //:bootstrap
buck2 build //:plugin --show-output
buck2 test //tests/...
buck2 build //:package --show-output
```

To repeat the fresh-checkout independence check:

```sh
buck2 run //:isolation
```

`//:node` downloads **Node 26.10.0** with per-platform SHA-256 verification.
Bootstrap, esbuild, TypeScript, browser tests, and Adobe packaging all execute
that Buck artifact. Linux x64 and macOS arm64/x64 archives are declared. npm is
used only to provision package-lock.json dependencies; it is never the build,
test, or package entry point. Bootstrap writes local executable paths to the
ignored `.buckconfig.local`, installs the WASM Rust target, and provisions a
Python environment and pinned Playwright Chromium. Network access is required
for initial provisioning; the installed extension is offline.

On a minimal Debian/Ubuntu Linux host, install the browser's shared libraries
**locally, without sudo**, before testing:

```sh
buck2 run //:browser_deps
buck2 test //tests:browser
```

Browser tests explicitly use Chromium's **SwiftShader software GPU** and record
adapter details. Both WebGPU and WebGL2 must execute and agree with WASM; a
missing GPU adapter is a test failure. Another test disables both GPU APIs to
exercise WASM fallback. System library versions are recorded under
`.tools/browser-libs/packages.json`; these are CI system dependencies, not
shipped plugin code.

The plugin target's output contains `plugin/manifest.json`, a directory loadable
in UXP Developer Tool. Its other files (`test-api.mjs`, generated typed source,
WASM, GLSL) are validation artifacts and are excluded from the CCX.

The package target emits `com.modcam16.hdr-picker_PS.ccx` and `packaging.json`.
It invokes the pinned Adobe CLI's unmodified `plugin package` handler with a
local packaging client, which calls Adobe's offline PackageCommand. This avoids
the CLI's native service discovery on Linux. Adobe's package validation runs;
connected-Photoshop manifest validation requires the target host. The build
also verifies the archive's CRCs, complete file list, manifest, and runtime
byte equality. It does not publish or sign a Marketplace submission.

To benchmark a warmed 12-change J′ burst with the shipping panel:

```sh
buck2 run //:benchmark
```

This forces SwiftShader, runs WebGL2 and WebGPU three times each, and saves
`.tools/latency-benchmark.json`. It compares the preserved v0.1.5 build when
`.tools/latency-v0.1.5` exists; `--baseline /path/to/build-output` selects another
baseline, and a fresh checkout measures the current build alone. Timings end at
a decoded-image animation-frame check, not physical display presentation.
Compression is included in PNG totals; GPU wait/readback is not pure transfer
cost. Foreground timing ends at the mock host bridge and excludes Photoshop.

## Install and use

1. Enable Photoshop Developer Mode and restart Photoshop if prompted. In UXP
   Developer Tool, add the built **plugin/manifest.json** and load it.
2. Open a 32-bit ACEScg document using the standard ACES 2.0 OCIO configuration.
   Keep display exposure/gamma at their neutral settings.
3. Open **Plugins → modCAM16 HDR Picker**. Drag the dot to preview, then release
   to set Photoshop's foreground. Drag or scroll the J′ trackwheel to change
   lightness. Numeric fields commit when changed. Arrow keys move by .001;
   Shift changes the step to .01, and Alt bypasses snapping.
4. Photoshop foreground changes, including eyedropper picks, synchronize back
   to the panel. Colors outside its representable domain retain their scene
   preview and hide the coordinate dot until a new picker selection is made.
5. Use **Sync foreground** to discard a local preview and reimport Photoshop's
   current color. A queued release is cancelled; an already active native write
   finishes before the fresh read. The footer shows connection, reading,
   evaluation, and write status. Missing bridge/host replies are reported within
   five seconds. A late reply is accepted only while its request is current.

The panel background follows Photoshop's interface color, including theme
changes. Resize with Photoshop's native panel grip or dock divider. All controls
remain visible without scrolling. The square pad first adjusts to available
width and height; very small allocations then shrink text and controls together.
The extension imposes no minimum size; Photoshop can retain its own limits.
Its preferred docked height of 360 pixels is only an initial size.
The native browser tracks the panel root on show, readiness, root/window resize,
observation, and polling, leaving up to 20 pixels for the native drag area.
Resize cancels active or queued gestures and preserves Photoshop's foreground.
Idle resizing keeps the existing 256×256 PNG and performs no new color render.
To update an installed release, install the newly built v0.1.7 CCX and reload
the plugin (restart Photoshop if it retains the previous panel).

The pad, markers, and selected preview follow these document views:

| View | PNG presentation |
| --- | --- |
| ACES 2.0 - HDR 1000 nits (Rec.2020) | Rec.2020, 16-bit PQ |
| ACES 2.0 - HDR 1000 nits (P3 D65) | P3-D65, 16-bit PQ |
| ACES 2.0 - SDR 100 nits (Rec.709) | sRGB transfer, 8-bit, ICC |
| ACES 2.0 - SDR 100 nits (P3 D65) | sRGB transfer, 8-bit, Display P3 ICC |

Unsupported or undiscoverable views, including Raw, use HDR 1000 nits Rec.2020
and show the fallback reason. The canonical authoring color is independent of
the presentation view. OCIO output linear 1 maps to **100 nits** in the PNG;
there is no additional 2.03 brightness multiplier. The inherited authoring
range and J′ coordinates are preserved. The swatch surround is J′ = .150.

The authoring domain uses 203-nit white: its XYZ is multiplied by 2.03 before
OCIO inverse processing and divided on scene import. The parent instead puts
2.03 at its PNG encoder boundary. This extension's PNGs match the complete
official OCIO PQ view within 16-bit quantization. Same-coordinate selections
produce corrected ACEScg values; existing foreground colors import without
being overwritten. See [HDR_PRESENTATION.md](HDR_PRESENTATION.md) for evidence
and the remaining WebView display checks.
`buck2 build //:hdr_audit --show-output` generates verified 0–1000-nit reference
PNGs, a Safari comparison page, and a reversible panel inspector probe.

## Architecture and limitations

- `color/`: self-contained Rust equations and ACES 2.0 tables, compiled directly
  to WASM by Buck2 with no Rust crate dependencies.
- `web/`: local WebView and separate evaluation, preview/checker PNG, and
  slice-rendering workers with bounded sender queues, WebGPU and WebGL2 fallback.
  GLSL is generated from the shared restricted WGSL functions at build time.
  The normal pad is 256²; WASM uses 128² during gestures and refines to 256².
  PNGs are displayed as images; the selection and marker overlays are separate.
- `host/`: UXP lifecycle, Action Manager foreground transactions, document view
  discovery, native foreground sampling, WebView sizing, and local diagnostics. Writes run inside
  executeAsModal with a one-second acquisition timeout, verify float readback,
  and restore the original native descriptor after a mismatch or uncertain
  write failure. Context reads share the
  transaction queue. Completion does not depend on the modal callback return.
- `references/`, `tests/`: independent NumPy/OCIO oracle, data provenance,
  numerical tests, synthetic bridge tests, and browser interaction tests.

The standard Photoshop RGB DOM is unsuitable for HDR floats. The adapter accepts
explicit `redFloat`, `greenFloat`, and `blueFloat` channels from the native
foreground, then tries the `foregroundColorRGB` property. It also records
Photoshop's [native color conversion](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopcore/#convertcolor)
with RGB model 15 from the [Photoshop color type contract](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/a80f5fb4006291e76ec2fb481461b4b579fc3055/types/photoshop/util/colorTypes.d.ts).
That model permits ordinary RGB output. `grain` is Photoshop's legacy green
alias; neither `green` nor `grain` establishes scene-linear units. The extension
never divides these fields by 255 or applies an assumed transfer curve.

When explicit floats are unavailable, the bridge duplicates the active document
inside a modal scope, verifies 32-bit ACEScg, deselects and crops the owned copy
to 1×1, creates a pixel layer, and fills it with the native foreground. The
Imaging API reads Float32 pixels in the duplicate's native profile; metadata,
opacity, and cleanup are verified before use. The buffer is disposed, the copy
closes without saving, and the original becomes active again. Auto-close is
registered for cancellation. Source pixels, selection, layers, and history are
never edited by this path. The duplicate may briefly appear in Photoshop; its
native behavior and performance on large documents need host acceptance.
Successful samples are cached by document/profile/native-color descriptor for
polling; notifications invalidate the cache, while explicit Sync, transactions,
and diagnostics force fresh reads. These reads share the host queue and reuse
an existing owned modal scope during a transaction.
The current OCIO view is resolved only from an explicitly named current-view
field under an OCIO property, never from the list of available views. These
descriptor shapes must be confirmed on real Photoshop 27. The supplied captures
have no discoverable OCIO view, so the HDR Rec.2020 fallback applies. The latest
capture verifies native sampling and foreground writes; an unsuccessful sample disables
writes and records the failed stages; successful reading does not establish
visual HDR matching.

Diagnostics also include `capabilities.requested` and `capabilities.displayed`
(J′, view, gamut, size and request ID), reported `device` information, and
`performance.history` (last 32 stage records) plus worker queue/drop counters.
`packMs` includes CPU transfer-function/PQ quantization and row packing;
`compressMs` measures IDAT DEFLATE and is included in `pngMs`. `readbackWaitMs`
includes GPU completion wait; optional `gpuMs` measures shader execution when
valid timestamp queries are available. Missing/disjoint timers report null,
and missing device identity is labelled unknown. `decodeMs` ends when PNG
decoding completes, before installing the current image; it does not measure
physical monitor presentation.
Native pixel probes include duplicate/crop/fill/read/close durations and total
sampling time. Existing transaction timestamps distinguish evaluation, host
queueing, foreground write, and fresh readback verification.

Diagnostics schema 4 includes the extension ID/version, bridge handshake and
message observations, native RGB property/conversion results, foreground source,
probe metadata and cleanup, and the last eight host transactions. Each
transaction retains requested floats, native command results/errors, structured
readback/restoration, and its outcome. Browser capabilities
include bridge state, gesture/evaluation state, footer text, and the last eight
client transactions. Click **Diagnostics** after a failed release or Sync;
failed foreground reads are saved as evidence. The validator accepts schemas
1, 2, 3, and 4. Foreground checks can run independently of OCIO-view discovery:

```sh
buck2 run //:validate_host -- --foreground-only host-results/*.json
```

The full `buck2 run //:validate_host -- host-results/*.json` also requires all
four supported views, Raw fallback, and an HDR value in the captures. Neither
validator confirms painting behavior, UI behavior, or displayed luminance.

Layout data includes `layout.panel`, `layout.webview`, `layout.appliedWebview`,
`layout.resizeGrip` (request status/error and native strip height),
`layout.configuration`, and the last eight `layout.recentResizes`.
`capabilities.layout` includes UI scale, logical/displayed size, square-pad and
wheel bounds, and page/main overflow metrics. `capabilities.viewport` and
`capabilities.slice` remain available. An applied grip request means the native
API accepted it; visual confirmation requires Photoshop.
Capture after resizing to compare the allocated root, native browser bounds,
and browser viewport. Sizes are logical pixels; the raster remains 256×256
(128×128 during WASM gestures).

WebGPU falls back to a software adapter when offered, then WebGL2, then WASM.
SwiftShader is a development/test dependency provided by Chromium; a Photoshop
WebView uses adapters exposed by macOS. This extension cannot install a GPU
driver inside Photoshop. HDR image presentation still requires macOS WebView
support and a suitable HDR display.

See [GOAL.md](GOAL.md), [CHECKLIST.md](CHECKLIST.md), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
