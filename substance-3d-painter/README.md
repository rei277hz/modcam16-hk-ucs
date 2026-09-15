# modCAM16-HK Substance 3D Painter view

This directory is a standalone release of the unlit
`modcam16_hk_view.glsl` view shader. Its Base Color and Emissive channels carry
normalized `(J', x', y')` modCAM16-HK data; User0 selects a D65 white-balance
point and applies a Base Color `J'` offset.

## Install in Painter

Import the two `.exr` files as ordinary `Texture` resources in the `Textures`
category. They are raw RGB32F OpenEXR data with ZIP16 compression. Disable
gamma conversion, gamut conversion, color management, resampling, mipmaps,
and manual vertical flipping. Keep the dimensions and float32 precision:

| Resource | Dimensions | Payload |
| --- | ---: | --- |
| `whitepoint_cct_duv_lut.exr` | 257 x 257 | CIE 1960 `delta uv` from D65; B is zero |
| `aces2_inverse_tables.exr` | 363 x 12 | four ACES 2.0 profiles, each reach/cusp/hue |

Assign the resources to the shader parameters named
`whitepoint_cct_duv_lut` and `aces2_inverse_tables`. Painter uploads raw EXR
rows vertically reversed; the shader compensates for that layout. Do not
import either file as a `Color LUT`.

## Behavior

Base Color and Emissive encode
`(J', -R(s) sin(h), R(s) cos(h))` around 0.5. The logarithmic radius is

`R(s) = log1p(s / 6.900502700352508) / log1p(160 / 6.900502700352508)`.

The normalized 1000-nit scale is
`J_HK = J' * 217.2768649129496`; the 203-nit reference white is
`J' = 0.4602422813863053`. The shader applies CAT16 white adaptation and the
ACES 2.0 HDR 1000-nit Rec.2020 inverse to produce scene-linear ACEScg.

Out-of-range or non-finite resources fail closed with the shader's diagnostic
colors. A valid zero `J'` remains black.

## ACES table provenance

`source/generate_aces_tables.py` obtains the table payloads from the official
ACES 2.0 OpenColorIO processors. For each of the four shipped views it uses
the documented PyOpenColorIO 2.5 `GPUProcessor.extractGpuShaderInfo()` API:
the reach and cusp arrays come from the returned GPU textures, and the hue
sentinel array comes from the generated OCIO GLSL source. The bundled
`source/cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio` file is the exact
configuration used for extraction.

The numerical oracle is PyOpenColorIO's CPU processor for the corresponding
official ACES `BuiltinTransform`. A previous cusp-index investigation found
that the sentinel convention requires advancing the stored lower index; the
checked-in shader contains that correction and the validation harness
regresses a hue near 98.94 degrees against the OCIO oracle.

## Regenerate and validate

The `source/` directory contains all generation inputs and validation support,
including the CIE 1931 2-degree observer data and the official OCIO config.
From this directory, with Python 3.11 or newer and NumPy, SciPy, OpenEXR,
Moderngl, and PyOpenColorIO 2.5 installed:

```sh
python3 source/generate_whitepoint_lut.py
python3 source/generate_aces_tables.py
python3 source/validate_release.py
```

The generators write the two EXRs and their manifests into this directory.
The validation command checks dimensions, float32/ZIP16 contracts, hashes,
portable manifests, OCIO table extraction, white-balance adaptation, shader
diagnostics, and the cusp regression.

The CIE dataset is the 2019 CIE 1931 2-degree observer (DOI
`10.25039/CIE.DS.xvudnb9b`) and is licensed CC BY-SA 4.0; see
`source/CIE_NOTICE.md`. The bundled OCIO configuration's upstream notice is
in `source/THIRD_PARTY_NOTICES.md`.
