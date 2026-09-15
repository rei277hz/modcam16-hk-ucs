# modCAM16-HK Cartesian Color Picker

This repository contains a local browser picker for normalized
modCAM16-HK/Painter coordinates:

```text
(J', x', y') ∈ [0, 1]^3
```

The `x'` and `y'` channels are Cartesian coordinates around `0.5`; they encode
the shader's logarithmic saturation radius using
`(x, y) = (-R(s) sin(h), R(s) cos(h))`, and the valid domain is their unit disk.
The square viewport has four aligned layers: a checkerboard canvas, a
selected-view RGBA PNG gamut slice, a transparent 1024x1024 ColorChecker-dot
PNG, and a transparent overlay canvas containing rings, the neutral cross, and
the picked marker. WebGPU computes
only the slice pixel field when available; a WASM batch path provides the
deterministic fallback. Both canvases always use 512x512 backing stores. A
confirmed WebGPU renderer keeps the slice PNG at 512x512; only the CPU/WASM
fallback may use a temporary 64x64 slice during J' interaction. Coordinates
always determine authoring Rec.2020 display-linear RGB, scaled once by 2.03
before the inverse **ACES 2.0 HDR
1000 nits (Rec.2020)** view produces scene-linear ACEScg. The selected forward
view supplies the slice's display-linear pixels and matching PNG encoding. A
view change does not change coordinates, ACEScg, Background, or snapping.

Full Rec.2020 authoring is enabled by default; disabling it adds a P3
`[0, 10 / 2.03]` per-channel cube requirement to authored picker/slice
availability. The Desaturate appearance toggle is available in Full mode and preserves canonical
coordinates, readouts, snapping, and image statistics.
Desaturate clips its reconstructed Rec.2020 appearance RGB to `[0, 10 / 2.03]`
before inverse ACES, so it never changes the availability mask.

Click the preview to select SDR Rec.709, SDR P3-D65, HDR P3-D65, or HDR
Rec.2020. The whole swatch/surround is one locally generated 256×256 PNG:
8-bit with the matching ICC profile for SDR; 16-bit PQ with P3/Rec.2020 cICP
metadata for HDR. All four views are selectable, independently of display
capabilities. Actual HDR appearance depends on the browser, OS, and display.
There is no separate Mode row or direct Rec.709 mode.

The 203-nit appearance context is retained. J' maps linearly as
`J_HK = J' * 217.2768649129496`, ending at physical 1000-nit white. The fixed
100-nit locator is `J' = 0.34990637148068954`; authoring Rec.2020 `(1,1,1)` is 203 nits
and has `J' = 0.4602422813863053`. This intentionally replaces the old shader
endpoint; fitted-radius X/Y orientation and meaning are unchanged.

Background is a normalized surround J' value in `0..1`, shown beside the
label and routed through the same inverse/forward pipeline. The default is
`0.150`; `1.000` is the 1000-nit neutral. Over-peak foreground picks are
marked unavailable.

See [FINAL_BEHAVIOR.md](./FINAL_BEHAVIOR.md) for the current behavior contract
and [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) for live
implementation and release checks.

## Requirements

- Node.js 26 selected with [fnm](https://github.com/Schniz/fnm)
- Rust and the `wasm32-unknown-unknown` target
- `wasm-pack`
- Python 3 with `PyOpenColorIO` 2.5, NumPy, and Pillow with LittleCMS
  (for independent ACES, appearance, and ICC validation)
- Chromium for the Playwright browser checks (`CHROMIUM` can override its path)

## Development

```sh
eval "$(fnm env)"
fnm use 26
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Verification and production build

```sh
eval "$(fnm env)"
fnm use 26
npm test
npx tsc --noEmit
npm run build
npm run preview
```

The build compiles the local Rust color core and emits a relative-path Vite
bundle. No sibling workspace is required at runtime or build time.

`npm test` runs the official ACES oracle check after building WASM. The check
executes `tests/ocio_oracle.py` with the bundled
`tests/reference/cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio` configuration and
compares the Rust/WASM system under test against PyOpenColorIO's CPU processor.
The PNG tests also check the complete fixed-source inverse/selected-view
forward pipeline against that oracle, independently decode image samples and
metadata, and validate SDR ICC colorimetry with LittleCMS. Browser tests cover
snap retention across views, asynchronous decode races and failures, immediate
gamut feedback, mouse follow/commit, direct touch and pen swipes, and mobile
geometry. Legacy Rust exports remain for regression coverage; the browser uses
only the canonical `picker_*` API.

To serve the production build on the LAN:

```sh
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

Snapped coordinates drive the picker marker, its accessible x'/y' values, and
the values sent to evaluation. The unsnapped pointer coordinates are kept
internally only so a gesture can escape a snap. The nearest ColorChecker dot
or neutral cross is selected within a `0.020` halo; projection onto that
target uses a `0.005` whole-vector band. J' snapping uses the same `0.005`
band and chooses the nearest active ColorChecker patch or the fixed 100-nit
reference locator, with patches winning exact ties.

For mouse input at any viewport width, click the gamut slice once to arm live
tracking. The selected point follows the cursor, clamps to the slice edge
outside the square, and a second primary click anywhere commits the point.
Press Escape to cancel. Touch and pen input swipe directly on the slice using
relative movement; contact does not jump the point, and the established
quarter-speed sensitivity, smoothed velocity, acceleration, snapping, and
pointer capture are retained. The J' wheel is a persistent, flat wheel whose
texture follows raw vertical movement one pixel per pixel. Its J' value uses
the same smoothed 1x..4x pointer-speed acceleration as X/Y on top of the base
quarter-J'-per-wheel-height response. Mouse input uses click, document-level
follow, then an anywhere confirmation click; touch and pen drag directly.
Its separate ruler shows the displayed (possibly snapped) J' value, the
100-nit reference, and the active patch.

The narrow layout does not scroll. Its minimum acceptance viewport is `360x645`
CSS pixels at `devicePixelRatio = 3`; overflow checks are performed in CSS
pixels while retaining all readouts and controls.
