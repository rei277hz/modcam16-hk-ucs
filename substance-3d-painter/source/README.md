# Release source and validation

This folder contains the reproducibility inputs for the files in the parent
release directory. It is intentionally separate from the Painter-facing root.

## Generators

- `generate_whitepoint_lut.py` integrates the bundled CIE 1931 2-degree
  observer over Planck spectra, builds the 257 x 257 D65-centered CIE 1960
  delta-`uv` LUT, writes the parent EXR, and writes `lut-manifest.json`.
- `generate_aces_tables.py` loads the bundled official OCIO configuration and
  extracts the four ACES 2.0 inverse profiles through PyOpenColorIO's
  `GPUProcessor.extractGpuShaderInfo()` API. It packs each profile's reach,
  cusp, and hue sentinel arrays into three RGB32F rows and writes the parent
  EXR plus `aces2_inverse_tables-manifest.json`.

Both scripts accept `--output` for a staging EXR. The manifests retain the
release-relative source names, so they never record an absolute checkout path.

## Oracle and validation

`validate_release.py` uses only the bundled OCIO configuration as the ACES
reference. Its regression vectors are checked-in pairs: the first three values
are normalized shader inputs `(J', x', y')`, and the last three are the
corresponding XYZ-D65 decode results precomputed from the maintained
modCAM16-HK decode contract. This fixes the PyOpenColorIO oracle inputs
independently of LUT generation. The harness uploads the canonical EXR
payloads with Painter's row reversal, runs the GLSL shader through Moderngl,
and compares the result with PyOpenColorIO's CPU inverse processor. The test
includes the cusp sentinel regression, white-point CAT16 adaptation,
zero/invalid inputs, and manifest and artifact checks.

Install the required Python packages from the release root with:

```sh
python3 -m pip install -r source/requirements.txt
```

A Mesa EGL OpenGL 4.1 context is required by the shader harness.
