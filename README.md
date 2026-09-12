# modCAM16-HK Cartesian Color Picker

This repository contains a local browser picker for normalized
modCAM16-HK/Painter coordinates:

```text
(J_HK, saturation-x, saturation-y) ∈ [0, 1]^3
```

The saturation channels are Cartesian coordinates around `0.5`; the valid
domain is their unit disk. The square viewport displays the target-gamut cone
and unit-disk mask at a fixed normalized J value. ACEScg is retained when
switching among ACES 2.0 profiles, while `Rec.709 / No view transform` remains
the direct linear Rec.709 workflow.

See [FINAL_BEHAVIOR.md](./FINAL_BEHAVIOR.md) for the current behavior contract
and [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) for live
implementation and release checks.

## Requirements

- Node.js 20+ selected with [fnm](https://github.com/Schniz/fnm)
- Rust and the `wasm32-unknown-unknown` target
- `wasm-pack`
- Python 3 with `PyOpenColorIO` 2.5 and NumPy (for the independent ACES oracle)

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
npm test
npm run build
npm run preview
```

The build compiles the local Rust color core and emits a relative-path Vite
bundle. No sibling workspace is required at runtime or build time.

`npm test` runs the official ACES oracle check after building WASM. The check
executes `tests/ocio_oracle.py` with the bundled
`tests/reference/cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio` configuration and
compares the Rust/WASM system under test against PyOpenColorIO's CPU processor.
