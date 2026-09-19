# Implementation checklist

## Documentation and contracts

- [x] Documentation defines display sources and RAW preparation at the XYZ-D65 boundary.
- [x] Document ACEScg/AP0 as scene-reference-only formats.
- [x] Document `inverse_from_xyz_d65` as the sole canonical inverse entry.
- [x] Document RGB→XYZ-D65 adapters and the mandatory DNG 2.03 policy.
- [x] Use Color trackpad and J′ trackwheel consistently for the related
      track-motion controls.

## ACES source conversion

- [x] ACEScg preparation performs AP1→AP0 exactly once.
- [x] Preserve ACES2065-1/AP0 identity conversion.
- [x] AP0 is never interpreted as XYZ-D65.
- [x] Add regression coverage for primaries and neutral XYZ-D65 conversion.

## Canonical inverse and scene paths

- [x] The canonical inverse implementation is `inverse_from_xyz_d65` and
      matches the official numerical behavior.
- [x] Supported display-referred RGB sources have RGB→XYZ-D65 adapters.
- [x] No inverse-from-ACEScg, inverse-from-AP0, or inverse-from-Rec.2020 entry
      points exist.
- [x] Direct scene-reference ACEScg and AP0 forward paths are available.
- [x] Ensure ACEScg uses one AP1→AP0 conversion and AP0 uses no round trip.
- [x] Mirror these boundaries in WebGPU/WGSL.
- [x] Verify CPU/WASM/WebGPU parity for display-image and scene-forward paths.

## RAW/DNG

- [x] RAW decoding includes calibration, demosaicing, opcodes, and orientation.
- [x] DNG output uses camera→XYZ-D50→CAT02→XYZ-D65 directly.
- [x] Preserve signed and above-one XYZ-D65 values without clamping.
- [x] Diagnostics, metadata, and source modes identify XYZ-D65.
- [x] Apply the fixed ×2.03 multiplier before inverse HDR Rec.2020 processing.
- [x] Force the DNG 203-nit option checked and disabled.
- [x] Show helper text explaining the mandatory multiplier.
- [x] Use the same XYZ-D65 path for preview, loupe, and sampling.

## Image and EXR routing

- [x] Route ACEScg EXR through direct scene-reference ACEScg presentation.
- [x] Route ACES2065-1 EXR through direct scene-reference AP0 presentation.
- [x] Ensure scene-reference EXR bypasses inverse ACES and the 2.03 multiplier.
- [x] Route display-referred RGB images through RGB→XYZ-D65 adapters.
- [x] Production display and analysis routing uses the XYZ-D65 boundary.

## Tests

- [x] ACEScg conversion regression (no erroneous XYZ-D65 round trip).
- [x] Canonical inverse and adapter equivalence tests.
- [x] Scene-reference EXR tests proving inverse bypass.
- [x] DNG camera-neutral XYZ-D65 test.
- [ ] DNG signed/above-one preservation test.
- [x] DNG mandatory ×2.03 test and disabled-control UI test.
- [ ] End-to-end DNG preview, loupe, sampling, and availability tests.
- [x] CPU/WASM/WebGPU numerical parity tests.

## Consistency

- [x] Comments, names, and documents describe DNG as XYZ-D65.
- [x] Production inverse API names and source-mode strings match current routing.
- [x] Run Rust, WASM, TypeScript/build, OCIO, and the full browser/image-worker
      suite using Node from fnm.
