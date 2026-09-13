# modCAM16-HK Cartesian Color Picker — Final Desired Behavior

This is the living behavior contract for the local browser picker. Update it
alongside IMPLEMENTATION_CHECKLIST.md whenever a finding changes the contract.
The fixed authoring pipeline below supersedes the former five-profile workflow.

## Fixed authoring and independent presentation

(J', x', y') always specifies **linear P3-D65 source display RGB**. One source
unit represents 203 nits. Convert source RGB to D65 XYZ, scale by 2.03 once,
then apply the inverse **ACES 2.0 - HDR 1000 nits (P3 D65)** view transform.
The result is canonical scene-linear ACEScg/AP1.

The selected view applies its forward ACES 2.0 transform to that same scene
value. View changes must leave real and displayed coordinates, canonical
ACEScg, Background, ColorChecker coordinates, active target, and all snapping
locators unchanged. They regenerate both images. The gamut slice is rendered
through the selected view and shows its after-transform display-linear values;
its source authoring coordinates remain fixed.

The browser offers these stable view IDs in this order:

| ID | View | Preview encoding |
| --- | --- | --- |
| 1 | ACES 2.0 - SDR 100 nits (Rec.709) | 8-bit RGB PNG, sRGB transfer, embedded sRGB ICC |
| 4 | ACES 2.0 - SDR 100 nits (P3 D65) | 8-bit RGB PNG, sRGB transfer, embedded Display P3 ICC |
| 2 | ACES 2.0 - HDR 1000 nits (P3 D65) | 16-bit RGB PNG, PQ, P3-D65 cICP |
| 0 | ACES 2.0 - HDR 1000 nits (Rec.2020) | 16-bit RGB PNG, PQ, Rec.2020-D65 cICP |

All four options are always enabled, as explicitly selected in the approved
plan; do not capability-gate the menu. Browser/OS/display support determines
whether an encoded image is actually presented in HDR or wide gamut. The
former direct Rec.709 / No view transform (ID 3) is absent from the browser.

## J' and fitted-radius channels

Keep the common D65 appearance context: reference white 203 nits, adapting
luminance 20.3 nits, background ratio 0.10, complete adaptation, surround
c = 0.525 and Nc = 0.8, HK coefficient 66, z = 1.48 + sqrt(0.10).

J' is linear in J_HK, not in luminance:

```text
J_HK = J' * 217.2768649129496
100-nit neutral: source P3 = 100/203, J_HK = 76.02655940839014
fixed 100-nit locator: J' = 0.34990637148068954
203-nit neutral: source P3 = 1, J_HK = 100, J' = 0.4602422813863053
1000-nit neutral: source P3 = 1000/203, J' = 1
```

J' = 0 means J_HK = 0. The 100-nit locator and the 203-nit appearance
reference are distinct. The old 183.7488220212894 endpoint must not be used by
the browser; legacy APIs retain it only for regression coverage.

The x'/y' encoding and orientation remain:

```text
x = 2*x' - 1
y = 2*y' - 1
R = hypot(x, y)
s = 6.900502700352508 * expm1(3.185803578575629 * R)
h = atan2(-x, y)
u = (0.007 / 0.525) * s
J_A = J_HK^2 / (hypot(J_HK, 33*u) + 33*u)
C = u * J_A
```

At black, define the zero-denominator case as J_A = 0. The valid fitted-radius
domain is R <= 1. Stored channels remain 0..1; (0.5, 0.5) is neutral. Changing
only J' preserves native saturation/hue. Relative to the earlier cos/sin
orientation, the same color migrates as x' = 1 - old y', y' = old x'.

## Source gamut slice and unavailable picks

The viewport is square Cartesian x'/y', x' increasing rightward and y' upward.
Its valid mask intersects the fitted-radius disk, finite appearance inversion,
and the nonnegative P3-D65 source RGB cube up to 1000/203 per channel.
Small floating-point boundary tolerance is allowed; negative/out-of-peak
colors are not silently made valid by clamping the inverse transform.

Above-peak picked colors are unavailable, not inverse-transformed as though
they represented a clipped target. The readout says Unavailable and the preview
shows a red cross. The editable hex field retains the last valid entry, labeled
as such in its tooltip. A valid next pick restores normal output.

The slice is an RGBA PNG using the selected view's transfer, bit depth, and
color metadata. WebGPU computes only the slice pixel field when available,
using the Painter GLSL equation ordering and OCIO-derived parameter tables. A
WASM batch renderer is the deterministic fallback and supplies the same linear
display values. Valid gamut pixels are opaque; invalid pixels are transparent.

Render every WebGPU slice at 512 by 512, including slices generated during J'
interaction. The disposable 64 by 64 interaction path is only a UI-acceleration
fallback after the worker has confirmed that it is rendering with WASM on the
CPU. X/Y and snap-target changes redraw only the overlay canvas; view or J'
changes recompute the PNG. Background does not affect the slice.

## PNG preview and view menu

The gamut viewport is three perfectly aligned layers: a canvas-painted
checkerboard, an RGBA gamut-slice PNG, and a transparent indicator canvas. The
PNG contains only the selected view's after-transform display-linear
`(Rd', Gd', Bd')` values, encoded with the same SDR/HDR transfer, bit depth,
ICC, cICP, and compression rules as the color preview. Its alpha is fully
opaque for valid gamut pixels and transparent elsewhere so the checkerboard
shows through.

The top canvas contains every color-picking overlay: all ColorChecker dots and
dim target rings, the neutral ring/cross, the active ring, and the current
picked-color marker. Both canvases always keep a 512 by 512 backing store,
regardless of renderer or middle-PNG resolution, and all three layers share
the same square CSS bounds. WebGPU PNGs and settled WASM
PNGs remain 512 by 512; only confirmed WASM rendering may use a coalesced 64 by
64 PNG during J' interaction, without changing normalized alignment or canvas
sharpness. The previous decoded slice remains
visible until a matching replacement is decoded, and stale slice results are
rejected by the `(view, J', size)` state key.

During a live J' gesture, slice work is serialized rather than repeatedly
cancelling every in-flight frame: each completed frame may advance the visible
slice, then the latest queued J' state is rendered. This gives progressive
updates under fast pointer input; after release, only the exact settled state
may replace the image.

The whole picked-color/surround composition is one 256 by 256 RGB PNG with a
centered 186 by 186 swatch (35-pixel border). No separately painted CSS color
surface or separate Mode row remains. Clicking the preview opens a compact
four-item view menu, with the active view indicated.

SDR samples apply the sRGB transfer curve to the selected linear RGB and
quantize to 8-bit; both SDR files embed matching, self-contained ICC v2
matrix/shaper profiles with Bradford-adapted D50 colorants and a sampled sRGB
decode curve. They also include matching cICP [1,13,0,1] or [12,13,0,1].

HDR samples apply ST 2084/PQ to the actual absolute luminance then quantize to
16-bit big-endian RGB. P3 uses cICP [12,16,0,1], Rec.2020 [9,16,0,1].
Matrix coefficients are RGB identity and the full-range flag is 1. HDR PNGs
carry no SDR ICC profile. Selected forward-view XYZ/RGB already uses Y=1 at
100 nits: multiply selected RGB by 100 for nits, not by 203 again.

Encode with DEFLATE level 1 in a dedicated evaluator/image worker. Refresh for
J'/x'/y'/Background/view changes. Coalesce queued work while allowing completed
preview frames to advance during fast gestures; the final frame must match the
settled controls. Publish numerical validity independently of PNG decoding so
the unavailable state appears during a gesture. While an invalid PNG is
pending, hide the previous colored image and show one bold cross on black.
Once decoded, show only the PNG's cross over its black swatch—never both
diagnostics together.

Decode a replacement image off-DOM, check the view, generation, and gesture
state again, then atomically replace the previous image. During an active
gesture, a newer completed response may advance the image progressively; after
release, reject anything that does not match the settled controls. Revoke stale
and superseded blob URLs, retain the previous decoded image on ordinary decode
failures, and show an accessible failure message. The unavailable transition is
the exception: hide the old colored swatch until the black diagnostic image is
ready. No claim of HDR hardware presentation is made by decoding alone.

The preview button and menu support keyboard focus, Enter/Space, arrow keys,
Home/End, Escape, Tab, and outside-click dismissal. Menu placement stays within
the viewport on mobile.

## Readouts and hex entry

Always show actual canonical linear ACEScg, which can exceed 1. Displayed
snapped coordinates are the coordinates sent to evaluation. The visible
six-digit hex field is sRGB-transfer encoded scene-linear AP1, not display RGB.
Copy copies those six digits. Set validates exactly six hex digits, decodes
AP1, applies the fixed forward HDR P3 view, and solves authoring coordinates.
Those solved coordinates determine subsequent calculation; do not keep a
hidden imported color that disagrees with the controls.

## Background

The range element and adjacent number both show **surround J' in normalized
0..1**, with three decimals. Default is 0.15. Its neutral source RGB is derived
from `(backgroundJ', 0.5, 0.5)` through the same 2.03 scale, fixed inverse HDR
P3, and selected forward view as foreground. Background J'=1 is the 1000-nit
neutral; there is no sRGB-shaped 0..10 UI mapping or above-peak surround state.

The foreground-matching marker solves the source neutral having the displayed
J_HK. Snap Background within 0.02 normalized slider-position distance of that
marker. Neutral foreground and its matching surround must yield identical PNG
samples in all four views. View switches never modify Background or its marker.

Keep Background label, number, and slider on one horizontal line, with the
slider immediately to the label's right. Keep the existing 0.020 normalized
slider snap band and put the foreground-matching locator at displayed
foreground J'.

The preview PNG remains square and is displayed at exactly the height of the
adjacent ACEScg/linear value/encoded AP1 value/ColorChecker-name stack. Always
reserve the ColorChecker-name row: use visibility and `aria-hidden`, never
`display:none` or the HTML hidden state, when no patch name is shown.
The paired preview/readout row is 110 CSS pixels high; the fixed size prevents
an asynchronous name or image update from moving the gamut slice underneath a
two-click desktop pick.

## ColorChecker and snapping

Use the 18 official post-2014 Lab/D50 patch measurements, CAT02-adapted to D65,
as fixed scene-linear ACEScg anchors. Their fixed HDR-P3 forward values divided
by 2.03 determine authoring coordinates. Never regenerate them for a view
switch. Show each patch at its exact x'/y' position with its name when active.

- The nearest of the 18 patches or neutral cross is a candidate within
  Euclidean normalized x'/y' distance 0.020. Recompute on each X/Y update.
- No candidate hysteresis, sticky capture, or separate release radius.
- Always draw a dim 0.020 ring around each patch and neutral; brighten the
  active candidate's ring. These are candidate halos, not the narrow snap band.
- Keep real pointer coordinates separately. Project x'/y' together onto the
  candidate only within distance 0.005. Release as soon as the real position
  leaves that band, even while still inside the wider halo.
- J' snaps independently within 0.005 to the nearest active patch J' or the
  fixed 100-nit locator. Exact ties prefer the patch.
- Display and calculate using snapped values; never overwrite real coordinates.
  Editing J' leaves displayed X/Y unchanged; moving X/Y leaves displayed J'
  unchanged. Neutral supplies no patch J' or ColorChecker name.
- The active patch gets an exact J' wheel locator. No snap cross is drawn on
  the rolling pad. Slice indicators and readouts carry the selection.

## Picking controls and responsive layout

Keep a vertical DaVinci-style J' rolling wheel immediately to the left of the
gamut slice at every viewport width. Its surface is a restrained, flat repeating
tick texture with no current-value indicator. A separate static ruler to the
wheel's right carries evenly spaced 0.0..1.0 labels, a white triangle for the
displayed J', the highlighted 100-nit reference, and the active ColorChecker
patch locator. Put a three-decimal J' numeric input below the wheel and ruler.
The complete J' companion control is exactly as tall as the gamut viewport.
The rolling-pad/rolling-ball UI remains absent, with no Temp/Tint or
Reset/Store/Recall controls.

Choose X/Y interaction by pointer type. A mouse keeps the desktop click workflow:
the first primary click places the point and arms mouse-follow tracking,
document-level movement follows and clamps to the slice, and the second primary
click commits. Escape, view changes, or hex imports cancel tracking.

Touch and pen swipe directly on the gamut slice using relative movement. Contact
does not jump the point. Normalize subsequent deltas by slice dimensions, smooth
velocity over 45 ms, and multiply quarter-speed movement by
min(4, 1 + 3*(1 - exp(-speed/2.5))). Positive horizontal movement raises x';
upward movement raises y'. Clamp real channels at 0..1, retain the existing
real/displayed snap projection, and use no inertia. Capture the pointer until
release/cancel. The slice has no X/Y keyboard adjustment.

The J' wheel texture follows vertical pointer movement one CSS pixel per pointer
pixel and remains where released. It is a free physical input surface: keyboard,
numeric-input, and hex-import edits do not rotate it. J' uses the same 45 ms
smoothed total-pointer-speed acceleration profile as X/Y, multiplying
`-deltaY / wheelHeight * 0.25` by
`min(4, 1 + 3*(1 - exp(-speed/2.5)))`. Horizontal movement contributes to
speed but never directly changes J'; upward movement raises J'. Clamp real J'
at 0..1 without accumulating endpoint overscroll. The texture keeps following
raw pointer motion at an endpoint, and the first reversed delta moves J' inward.

For a mouse, the first primary click on the wheel arms document-level tracking
without changing J'. The wheel then follows mouse movement without a held
button; the next primary click anywhere confirms, is consumed, and does not
activate the underlying control. Touch and pen retain direct pointer-captured
dragging through release or cancellation. Escape, view changes, and hex imports
cancel active mouse tracking without undoing the current value. Pointer Lock is
not used.

While snapped, the texture continues to follow raw pointer movement; the ruler
triangle, numeric input, ARIA value, calculation, and images use
displayed/snapped J'. The separate real value is retained for accelerated wheel
motion and natural snap escape. Home/End/arrows and focus treatment remain.

J' snaps within 0.005 of the fixed reference-white J' or the currently active
x'/y' ColorChecker patch J'. Choose the nearer target and prefer the patch on
an exact tie. The numeric input uses range 0..1 and step 0.001, displays three
decimals when committed or updated by another control, and follows the same
real/displayed snap projection.

On narrow screens the wheel-plus-slice stage comes first and the preview/details
and Background occupy the row below it. The slice shrinks flexibly to make room
for the wheel. At 360 by 645 CSS pixels with DPR 3, all controls, readouts, and
footer must remain visible without vertical or horizontal page scrolling,
clipping, or row overlap. Both axes are non-scrolling at every viewport size.
The menu remains fixed-positioned to avoid clipping by the mobile layout.

## Numerical authority and maintenance

Python PyOpenColorIO with the checked-in official ACES 2.0 OCIO configuration
is the ACES reference. Rust/WASM is the implementation under test, never its
own oracle. Independent NumPy appearance equations verify the new J scale and
source XYZ; LittleCMS independently validates the embedded SDR ICC profiles.

Preserve official OCIO group order: ACEScg to ACES2065-1, ACES 2.0 view, then
output XYZ. Do not pre-clamp negative AP0 matrix values. Interpret view output
XYZ in 100-nit units. Legacy polar and profile-local normalized Rust exports
may remain for regression tests, but the browser imports only picker_* APIs.
