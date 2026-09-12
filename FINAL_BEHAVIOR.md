# modCAM16-HK Cartesian Color Picker — Final Desired Behavior

This document is the working behavior contract for the browser color picker in
this repository. It must be updated whenever implementation findings require a
change to the intended behavior. Color calculation, rendering, picking, and
clipboard entry remain local to the browser.

## Workspace and controls

The page is a single responsive dark workspace based on the picker at
`/home/rust/workspace/colors/web/index.html`. It contains:

- a square gamut-slice raster with a transparent indicator layer;
- a picked-color preview, linear readout, encoded hexadecimal entry, and
  background-surround control;
- a profile selector and three normalized controls: `J_HK`, `Saturation X`,
  and `Saturation Y`;
- ColorChecker markers, the selected patch name, and snapping locators.

Every coordinate control has a range input and numeric input. All three expose
the raw authored channel range `0..1`; they do not use percentage, polar, or
signed presentation mappings. The viewport is informative rather than a
pointer input surface: users select colors with the sliders and numeric inputs.

The former Temp/Tint group and Reset/Store/Recall buttons are not present.

## Profiles and stable identifiers

Profile IDs are implementation identifiers and must not be renumbered:

| ID  | Profile                                                         |
| --- | --------------------------------------------------------------- |
| `0` | Rec.2020 (P3-D65 limited) / ACES 2.0 - HDR 1000 nits (Rec.2020) |
| `1` | Rec.709 / ACES 2.0 - SDR 100 nits (Rec.709)                     |
| `2` | P3-D65 / ACES 2.0 - HDR 1000 nits (P3 D65)                      |
| `3` | Rec.709 / No view transform                                     |
| `4` | P3-D65 / ACES 2.0 - SDR 100 nits (P3 D65)                       |

The visible menu order is `3`, `1`, `4`, `2`, `0`. The source-gamut text
before `/` and the transform text after it are part of the visible contract.

Profiles `0` and `2` use the HDR appearance model and J normalization.
Profiles `1`, `3`, and `4` use the SDR appearance model and J normalization.

## Normalized JHK encoding

The coordinates match the raw channel encoding used by
`/home/rust/workspace/substance-3d-painter-shaders/modcam16-hk-view/`.

For HDR profiles:

```text
J_HK = codeJ * J_HK(1000-nit HDR white)
```

For SDR and direct Rec.709 profiles:

```text
J_CODE_REFERENCE = J_HK(203-nit HDR white) / J_HK(1000-nit HDR white)
J_HK = codeJ * (100 / J_CODE_REFERENCE)
```

The common anchor is approximately `J_CODE_REFERENCE = 0.3679404257`, and the
HDR scale is approximately `360.4750768692`.

Cartesian saturation decodes as:

```text
u = 2 * saturationX - 1
v = 2 * saturationY - 1
saturation = sqrt(u*u + v*v)
hue = atan2(v, u)
C = saturation * J_HK*J_HK / 66
```

Changing only J while holding X and Y fixed preserves revised-HK hue and
saturation. `(0.5, 0.5)` is neutral. The valid authored saturation region is
the unit disk `u*u + v*v <= 1`; all three stored channels remain in `0..1`.

## Cartesian gamut slice

The square viewport maps Saturation X directly from `0` at the left to `1` at
the right. Saturation Y maps from `0` at the bottom to `1` at the top. It is not
a radial Hue/Sat presentation.

The visible valid mask is the intersection of:

1. the Cartesian saturation unit disk;
2. finite, valid modCAM16-HK inversion;
3. the nonnegative target-gamut RGB cone for the selected profile.

The target cone is Rec.709-D65 for profiles `1` and `3`, P3-D65 for profiles
`2` and `4`, and the intersection required by Rec.2020 with its P3-D65 limit
for profile `0`. Positive channels above `1.0` remain valid; there is no upper
unit-cube gamut test. Negative channels are invalid and must not be made valid
by clipping.

Valid pixels show the encoded target color. Display output may clip positive
values above the browser canvas range, but this display clipping does not alter
validity or the retained linear color. Invalid pixels use a visible unavailable
mask rather than a fabricated clipped color.

The settled raster is 512 x 512. During J dragging, a disposable 64 x 64
preview keeps interaction responsive; settling J requests the full raster.
X, Y, Background, and indicator-only changes reuse the current slice.

## Color state and profile switching

For an ACES profile, the selected JHK target is converted through the exact
ACES 2.0 inverse view function to linear ACEScg/AP1. That actual linear ACEScg
value is the canonical value preserved when switching among ACES profiles.
The target profile's forward view is evaluated and all three normalized JHK
coordinates are solved again; coordinates are profile-local and may change.

`Rec.709 / No view transform` is a separate direct-linear-Rec.709 workflow.
Cross-workflow conversion uses the ACES 2.0 Rec.709 SDR 100-nit view as the
explicit bridge:

- ACES to direct evaluates retained ACEScg through that view and derives the
  direct Rec.709 JHK coordinates.
- Direct to ACES applies the inverse bridge to the retained direct linear
  Rec.709 value and derives the selected ACES profile's coordinates.

Positive values above `1.0` are retained as actual linear values during
profile conversion. If a retained value is not representable by a target
profile, conversion returns finite coordinates clamped to the nearest J or
saturation-domain boundary and marks the state unavailable. NaN coordinates
must never be published to controls.

The direct profile shows an actual linear Rec.709 readout. ACES profiles show
an actual linear ACEScg readout. These numeric readouts may exceed `1.0`.
The preview and six-digit hex value are necessarily display-limited.

Hex entry retains the reference picker's profile-specific meaning:

- direct mode uses sRGB-transfer-encoded Rec.709;
- ACES modes use sRGB-transfer-encoded ACEScg/AP1.

`Copy` copies the six digits. `Set` validates exactly six hexadecimal digits,
decodes the selected workflow's value, and derives normalized coordinates.

## Background surround

The Background control remains a linear neutral in the selected target
profile. Its slider may use the reference picker's sRGB-style presentation
curve for useful low-end travel. The foreground snap marker is the neutral
whose JHK equals the currently selected normalized J value.

On a profile switch, Background preserves its JHK offset from the foreground.
If it is at the old foreground marker, it moves to the new profile's marker.

## ColorChecker markers and snapping

The 18 official post-2014 ColorChecker Lab/D50 measurements remain the source
of the markers. They are adapted to D65, converted to absolute ACEScg, and
evaluated for the selected workflow. Each record contains exact normalized J,
X, and Y coordinates, display color, name, and availability.

Every patch dot remains visible at its exact X/Y position, including an
unavailable source preimage. The selected patch name is shown near the preview.

Candidate selection and snapping are deliberately separate:

- When no candidate is active, the nearest patch within Euclidean normalized
  X/Y distance `0.060` becomes active.
- The active candidate remains latched until X/Y leaves distance `0.075`,
  providing hysteresis between nearby patches.
- A dim circle of radius `0.060` is drawn around only the active target dot.
  It represents candidate/locator visibility, not the narrower snap threshold.
- While a candidate is active, exact locator ticks appear on the J, X, and Y
  sliders.
- The slider currently being edited snaps independently when its absolute
  one-dimensional distance from the corresponding patch coordinate is at most
  `0.015`.
- Editing one slider never automatically overwrites either of the other two.
- There is no viewport cue for the narrow `0.015` snap band.

Numeric inputs follow the same candidate and per-coordinate snapping rules as
their corresponding sliders.

## Rendering, compatibility, and failures

Rendering uses local Rust/WASM workers. Expensive work is coalesced to the
newest animation-frame state. All evaluator, profile-conversion,
ColorChecker, and row-render responses are checked against their complete
request state; stale results must not repaint a newer selection.

Display-P3-capable browsers use tagged Display P3 canvas/CSS output for the P3
and Rec.2020-limited modes. Rec.709 modes use sRGB. Browsers without Display P3
canvas support receive explicit sRGB-converted output for every profile.

The official PyOpenColorIO processor built from the checked-in ACES 2.0 OCIO
configuration is the numerical authority for ACES profile behavior. The Rust
implementation is the browser system under test and must remain parity-tested
against that independent oracle; it is not itself an authoritative reference.
The fixed-function equations and reach/cusp payloads are transcribed from the
official OCIO-generated processor shader. The OCIO group composition is also
preserved: ACEScg-to-ACES2065-1 matrix values reach the fixed function without
an intermediate range clamp, while the target RGB range is clamped before the
final XYZ matrix.

A failed or malformed asynchronous response preserves the last accepted
raster and preview. Loading, invalid, and unavailable states must be conveyed
with semantics or geometry in addition to color.

## Responsive and accessible behavior

The page has no card stack or visible title block. On desktop the viewport and
preview occupy the upper workspace with compact controls below. On narrow or
short screens they reflow or scroll without horizontal overflow.

All controls have labels, numeric inputs, keyboard behavior, accessible names,
and visible focus indicators. The raster canvas has an accessible name; the
indicator canvas is decorative.

## Invariants

- Keep profile IDs, order, and labels stable.
- Keep raw normalized controls separate from derived JHK/polar values.
- Preserve actual linear ACEScg across ACES profile changes.
- Keep the direct Rec.709 bridge explicit.
- Never reject a color only because a positive target-gamut channel exceeds
  `1.0`.
- Never accept a negative target-gamut channel through display clipping.
- Never publish NaN control coordinates.
- Keep ColorChecker candidate selection, visible halo, and per-slider snapping
  as distinct behaviors.
- Keep the project buildable without sibling repository paths.
