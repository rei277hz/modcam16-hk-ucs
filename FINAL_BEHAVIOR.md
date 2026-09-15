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
203-nit neutral: source P3 = 1, J_HK = 100, J' = 0.4602422813863053
1000-nit neutral: source P3 = 1000/203, J' = 1
```

J' = 0 means J_HK = 0. The 203-nit HDR white is the sole browser ruler
reference and J' snapping target. The former 100-nit locator is not shown or
used for browser snapping; legacy APIs may retain it only for regression
coverage.

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

Background surround J' remains normalized 0..1 with a default of 0.15, but has
no range control or numeric readout. Drag the picked-color preview vertically
to adjust it: desktop click-hold/move/release and mobile touch/pen hold-drag/
release both use relative movement, the shared velocity smoothing and
acceleration profile, clamping, and no overscroll. A click without meaningful
vertical travel opens the view menu. The hollow triangle on the J' ruler is the
only background value indicator. Preserve the existing foreground-matching
background snap band during this gesture.

Its neutral source RGB is derived from `(backgroundJ', 0.5, 0.5)` through the
same fixed inverse HDR P3 and selected forward view. View switches never modify
Background or its marker.

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
  fixed 203-nit locator. Exact ties prefer the patch.
- Display and calculate using snapped values; never overwrite real coordinates.
  Editing J' leaves displayed X/Y unchanged; moving X/Y leaves displayed J'
  unchanged. Neutral supplies no patch J' or ColorChecker name.
- The active patch gets an exact J' wheel locator. The removed rolling pad has
  no residual snap indicator; slice indicators and readouts carry selection.

## Picking controls and responsive layout

Keep a vertical DaVinci-style J' rolling wheel immediately to the left of the
gamut slice at every viewport width. Its surface is a restrained, flat repeating
tick texture with no current-value indicator. A separate static ruler to the
wheel's right carries evenly spaced 0.0..1.0 labels, a white triangle for the
displayed J', the highlighted 203-nit reference, and the active ColorChecker
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
not used for the J' wheel.

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

## Image color locator

The picker has a visible, compact image-locator panel stacked below the picker,
including before an image is loaded. Its empty state contains a Load image
button. The panel never introduces document scrolling: on narrow screens its
controls and viewport shrink so the complete page still fits the 360x645 CSS
pixel/DPR-3 baseline.

The image toolbar places an `Image Options` button immediately beside `Load
image`. Source interpretation controls are contained in an accessible modal
dialog opened by that button; they do not consume normal page layout space
while closed. The dialog closes on its close button, Escape, or an outside
backdrop click and restores focus to the options button.

### Loading and interpretation

Loading uses the same source decoder and interpretation contract as
`/home/rust/workspace/colors/web/decompose.html` and its worker. Supported
formats are DNG, EXR, JPEG/JPG, PNG, HEIC, and HEIF. The worker first inspects
the file and reports dimensions, format, warnings, and embedded interpretation
availability.

Interpretation precedence is strict:

1. A usable embedded ICC profile is preferred.
2. If no usable ICC exists, usable format metadata is used: PNG cICP,
   EXR chromaticities, or HEIF nclx metadata.
3. If neither is usable, assume `sRGB (Rec.709)` primaries plus `sRGB`
   transfer and continue loading; opening Image Options shows a warning that
   this interpretation was assumed.
4. A manually selected Primaries/Transfer pair overrides embedded metadata.
5. DNG always uses its embedded camera calibration and linear ACES2065-1/AP0;
   manual source interpretation is unavailable for DNG.

Manual choices exactly match the reference loader: Rec.709/sRGB, Display
P3/P3-D65, Rec.2020, Adobe RGB, ACEScg, ACES2065-1, Linear, sRGB, Gamma 1.8,
Gamma 2.2, Gamma 2.4/BT.1886, BT.709/BT.2020, PQ/ST 2084, and HLG/BT.2100.
Changing interpretation reuses the retained native raster and re-prepares it;
it never silently downsamples analysis data. The visible image is the same
decoded, interpreted, bounded preview style used by the reference loader.
For image appearance, expose a per-image `scale by 2.03` choice before the
fixed HDR-P3 inverse. It defaults on for SDR-oriented sources and off for
HDR-native EXR/DNG and embedded PQ/HLG sources, and the user may override it.
Confirmed HEIC/HEIF gain-map images default this choice off; explicit user
changes always win. The worker reports gain-map metadata detection separately
from successful auxiliary-image decoding.
The choice re-renders the
loaded image and loupe only; sampling/averaging uses the declared raster units
to recover the same canonical physical authoring path, so equivalent checked
and unchecked representations cannot move the mean, ellipse, or average snap
target.

For image sampling, the Scale ×2.03 choice also declares the units of the
prepared linear raster. When checked, values are interpreted in the picker’s
203-nit source units (P3 peak 10/2.03) and are multiplied by 2.03 before the
fixed HDR inverse. When unchecked, values are interpreted as absolute
100-nit HDR units (P3 peak 10.0); they are divided by 2.03 only when mapped
back to normalized authoring coordinates and are passed unchanged to the HDR
inverse. These two representations of the same physical color must yield the
same ACEScg and J′/x′/y′ result. Bright HDR pixels up to the 10.0 peak are
therefore accepted when the option is unchecked.

### Image coordinates and interaction

The image row is laid out as `loupe | image frame | zoom controls` at every
viewport width. The image preview uses a cover-style 1x base scale (overflow is
allowed so the frame has no intentional black border), with 2x and 5x buttons
selecting larger multiples. Pointer coordinates are mapped through the
transformed image rectangle to native pixel coordinates, clamped to native
bounds, and retained as floating point until the worker rounds the sampling
center to the nearest native pixel.

Panning moves the image opposite pointer/finger motion. The image is moved
first and clamped to its frame bounds; any movement remaining after a bound is
reached moves the crosshair instead. The crosshair remains centered in the
frame whenever the image can still move. Changing zoom preserves the selected
native coordinate where possible and re-clamps the transform.

Image geometry is deterministic: the native crosshair coordinate, image and
viewport dimensions, and zoom factor uniquely determine the rendered image
offset and screen-space crosshair position. There is no separately accumulated
pan or screen-coordinate state. When an image edge reaches the frame edge,
further motion moves the crosshair toward that gesture direction; reversing
direction first brings the crosshair back toward the frame center, then moves
the image again.

The transparent overlay is a crosshair with a small central square.
The square loupe is a sibling panel on the left side of the image frame in the
same row and remains visible at the last sampled location after confirmation.
It shows interpreted source pixels

with nearest-neighbor scaling, `image-rendering: pixelated`, disabled canvas
image smoothing, and sharp square pixel edges.

Startup and replacement invariants:

- ColorChecker dots and their dim rings are painted as soon as ColorChecker
  data arrives; they do not depend on a subsequent picker gesture.
- During image inspection/preparation, the image row and zoom controls remain
  compact/hidden until the replacement raster, native pointer, deterministic
  geometry, and crosshair are ready. The image and crosshair are published
  atomically after off-DOM image decoding.
- The default image zoom is 2x (including after loading a replacement image),
  while the 1x/2x/5x controls remain intrinsic-width controls.

Background preview gestures are live: every newest accepted background J'
state may update the encoded preview during a rapid drag, with stale worker
responses rejected by generation/state tokens.

Normal application text is not selectable. Native editable form controls keep
their normal editing/selecting behavior.

The background J' ruler locator is a hollow triangle with a white outline. The
current picked J' locator remains a solid white triangle and fills the hollow
marker when the two values coincide.

### Image appearance transform performance

Changing the selected display transform or the appearance-only Scale ×2.03
option regenerates the bounded image preview and loupe through a WebGPU-first
pixel pipeline when WebGPU is available. The transform uses the official ACES
2.0 fixed-function equation ordering and original OCIO GPU table payloads
extracted by the `generate_aces_tables.py` workflow; the browser does not use
an approximate curve or the non-official Rust implementation as its oracle.

The GPU path converts prepared linear AP0 pixels through ACEScg, the fixed
HDR 1000-nit P3-D65 inverse, the selected forward view, and selected display
primaries, returning display-linear RGB to the existing SDR/PQ PNG encoder.
The same path is used for the main image and loupe. If WebGPU is unavailable
or fails validation, a fixed pool of two workers performs the identical WASM
conversion in bounded 32,768-pixel chunks with deterministic output ordering.
The bounded AP0 preview raster and GPU device, pipelines, uniform/storage
tables are cached, so view/scale changes do not decode or reinterpret source
pixels again.

While a view or appearance transform is pending, the previous decoded image
and loupe remain visible under a dim layer with an `Applying display
transform…` banner. Only a complete, current-generation PNG replaces them;
superseded or failed work cannot overwrite a newer result. Main-image and
loupe work is coalesced independently to the newest request, and the dim layer
is removed only after both matching replacements are ready.

The transformed locator image and loupe are direct `<img>` elements backed by
the generated PNG bytes. Neither is decoded into or painted through a 2D
canvas. The loupe uses CSS `image-rendering: pixelated` for sharp square source
pixels. The only locator canvas is the transparent crosshair overlay; it requests a
Display-P3 2D context when available, matching the gamut indicator canvas so it
does not force an HDR image stack through an sRGB compositing path. Generated
HDR images request `dynamic-range-limit: no-limit` where the browser supports
that property; downloaded PNG bytes retain their 16-bit PQ and cICP metadata.

For a mouse, the first primary click places the crosshair and arms tracking,
then requests Pointer Lock on the image frame so the system pointer is hidden.
Locked `movementX/Y` uses the same 45 ms velocity smoothing and 1x..4x
acceleration profile as touch/pen, followed by the pan/clamp algorithm above.
A second primary click anywhere confirms, exits Pointer Lock, is consumed, and
ends tracking. Escape or any Pointer Lock exit ends active tracking without
discarding the last confirmed analysis. If Pointer Lock is unavailable or
denied, fall back to the existing visible-pointer document-level click-follow
tracking so the workflow remains usable.

For touch and pen, the initial contact establishes the gesture origin but does
not move the crosshair. Subsequent movement is relative, pointer-captured, and
uses the gamut slice's 45 ms smoothed velocity and 1x..4x acceleration profile.
Horizontal movement changes image x; upward movement changes image y. There is
no inertia.

### Continuous sample analysis

Sampling updates continuously from the latest coalesced pointer location for
both desktop tracking and touch/pen dragging. Worker sample responses carry an
image generation and monotonically increasing sample token; stale responses
are ignored. Confirmation only ends desktop tracking and does not trigger a
different calculation path.

The worker includes every native pixel whose center lies within a circular
radius of exactly 3 px around the rounded pointer center. It reads complete
native rows so edge-clipped neighborhoods preserve source x coordinates.
Non-finite, invalid, negative-source, and above-peak samples are rejected and
reported in the rejected count; rejected samples do not contribute to means or
the ellipse.

Each accepted sample follows the fixed numerical path selected by the image
unit declaration:

1. Decode the selected source interpretation to linear AP0/ACES2065-1.
2. Convert AP0 to ACEScg.
3. If Scale ×2.03 is checked, treat the raster as 203-nit source units and
   multiply XYZ by 2.03; if unchecked, treat it as absolute 100-nit HDR units
   and pass physical XYZ through unchanged. Apply the fixed inverse ACES 2.0
   HDR 1000 nits P3-D65 path, yielding canonical ACEScg.
4. For normalized coordinates, divide unchecked absolute XYZ by 2.03 (the
   checked path is already in source units), then solve canonical J'/x'/y'.

The per-image scale checkbox is deliberately not consulted by this analysis
path. It is applied only while converting AP0 samples to the selected-view
display-linear RGB used for the image and loupe PNGs.

The image status reports native center, accepted/rejected/total counts, and
the arithmetic J'/x'/y' mean. A zero-accepted neighborhood has no ellipse or
average snap target.

### Robust ellipse and average target

For accepted x'/y' points, use deterministic Fast-MCD. Set
`h = max(2, ceil(n/2))` for n >= 2; use a numerical point ellipse for one
sample and no ellipse for zero samples. Sort points lexicographically and
generate at most 32 deterministic evenly distributed h-point seed subsets.
Run at most five C-steps per seed, selecting the h smallest regularized
Mahalanobis distances each step and stopping when the subset is unchanged.
Choose the smallest covariance determinant, with lexicographic tie-breaking.

Use the selected subset's unbiased covariance, a 1e-9 diagonal floor, and the
95% two-dimensional chi-square factor. Draw the covariance eigenvectors as a
rotated ellipse on the gamut slice; clip only at the viewport boundary.

Separately average accepted samples in ACEScg. Convert that mean through the
fixed HDR 1000 nits P3-D65 forward pair, divide by the fixed source scale, and
solve canonical J'/x'/y'. The resulting average marker is independent of the
selected presentation view, is drawn with a persistent dim ring, and is added
to both x'/y' and J' snapping. The image result never automatically moves the
picker; it only adds a visible snap target.

The image panel, interpreted preview, crosshair, loupe, statistics, ellipse,
and average marker persist after confirmation until replacement or reset.
