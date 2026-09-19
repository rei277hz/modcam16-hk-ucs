# Final desired behavior

## Rec.2020 Color-Authoring Model

The picker is authored in HDR Rec.2020-D65 display-linear RGB. The selected
`(J′, x′, y′)` coordinates decode to linear Rec.2020 values. A coordinate is
available only when every Rec.2020 channel is finite and within the configured
Rec.2020 authoring range; when limited mode is active it must also be inside the linear
P3 cube. Unavailable slice pixels are black.

The authored Rec.2020 value is converted to XYZ-D65 and multiplied by the
fixed 2.03 factor that maps the picker’s 203-nit diffuse-white convention to
the ACES output transform’s 100-nit display-linear scale. The result enters
the canonical inverse ACES 2.0 HDR 1000 nits Rec.2020 path and produces the
canonical ACEScg scene-linear value. The selected presentation view then
converts that ACEScg value to the displayed RGB/PNG representation.

## ACES color-space boundaries

ACEScg/AP1 and ACES2065-1/AP0 are scene-reference formats only. They are never
treated as display-referred inputs to an inverse view transform.

Scene-reference ACEScg:

```text
ACEScg/AP1 scene RGB → AP1→AP0 once → selected forward ACES view
```

Scene-reference ACES2065-1:

```text
ACES2065-1/AP0 scene RGB → selected forward ACES view
```

Both paths preserve signed and above-one scene values until the official
forward view transform handles them. Sampling uses the direct scene value and
does not apply the inverse view transform or the display-linear multiplier.

There is exactly one canonical inverse API:

```text
inverse_from_xyz_d65(profile, xyz_d65) → ACEScg
```

It implements the official ACES 2.0 inverse output transform. Any
display-referred RGB source first uses its RGB→XYZ-D65 adapter, then calls this
API. Adapters never duplicate ACES fixed-function code, and there are no
separate ACEScg/AP0/Rec.2020 inverse ACES implementations.

## RAW/DNG interpretation

RAW processing includes DNG decoding, active-area handling, black/white
normalization, demosaicing, supported opcodes, calibration interpolation,
white balance, baseline exposure, and orientation.

The final camera transform is:

```text
camera RGB → XYZ-D50 → CAT02 D50→D65 → linear XYZ-D65
```

The prepared DNG raster is XYZ-D65. It does not round-trip through AP0 or
ACEScg, and negative or above-one XYZ values are not clamped.

The same XYZ-D65 boundary is used for ordinary display-referred PNG/JPEG,
manual RGB overrides, ICC RGB profiles, and HEIC/HEIF (including gain-map)
pixels. ICC XYZ-PCS values are adapted from D50 to D65. ACEScg/AP0 choices are
available only for EXR scene-reference input.

For this application, DNG camera white uses the fixed 203-nit workflow:

```text
prepared XYZ-D65 × 2.03
→ inverse_from_xyz_d65(HDR 1000 nits Rec.2020)
→ ACEScg
```

The image, loupe, and sample analysis use this same path. The image option
`Treat display-linear 1.0 as HDR 203 nits diffuse white` is checked and disabled
for DNG, with helper text explaining that the 2.03 multiplier is mandatory.

## Scene-reference EXR

An EXR identified or manually overridden as ACEScg is decoded as scene ACEScg;
an ACES2065-1 EXR is decoded as scene AP0. Both bypass inverse ACES and the
203-nit multiplier. They are presented through the selected forward view and
sampled directly as scene data.

## Presentation and encoding

The selected view determines the displayed encoding:

- SDR Rec.709: 8-bit RGB PNG with sRGB ICC.
- SDR P3-D65: 8-bit RGB PNG with Display P3 ICC.
- HDR P3-D65: 16-bit PQ RGB PNG with P3-D65 metadata.
- HDR Rec.2020: 16-bit PQ RGB PNG with Rec.2020-D65 metadata.

The gamut slice, ColorChecker layer, picked-color preview, image preview, and
loupe use the selected view’s after-transform display-linear values.

The interactive gamut-slice surface is the **Color trackpad**. The vertical
lightness control is the **J′ trackwheel**. Both use the shared track-motion
velocity and acceleration profile while retaining their respective two-axis
and one-axis coordinate mappings.

## Validation invariants

- CPU/WASM and WebGPU use identical official ACES tables and equations.
- Scene ACES inputs never call the inverse output transform.
- Display-referred RGB inputs always pass through RGB→XYZ-D65 before the one
  canonical inverse API.
- DNG diagnostics and source modes identify XYZ-D65, never AP0.
- DNG analysis uses the prepared XYZ-D65 raster.
