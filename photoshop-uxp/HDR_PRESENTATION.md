# HDR PNG presentation audit

Date: 2026-10-10. The user confirms that the parent project's PQ PNGs show HDR
in Safari, while this extension appears SDR inside Photoshop's panel. Physical
HDR in the embedded WebView remains unverified.

Version **0.1.7** fixes the missing authoring/OCIO unit conversion. Reference
white now encodes **202.987 nits**, and neutral J′ = 1 encodes **1000.002 nits**
in both HDR views. These measurements include 16-bit quantization. Normal
layouts avoid a CSS transform, and image styles explicitly allow HDR headroom.
The original findings below distinguish encoder units from authoring units.

## Actual encoder comparison

The parent `src/preview_png.ts` applies **2.03 before PQ encoding**:

```ts
encodePq(Math.max(0, Math.min(10, value * 2.03)) * 100)
```

The extension's `web/png.ts` encodes OCIO output in 100-nit units:

```ts
encodePq(Math.max(0, Math.min(10, value)) * 100)
```

Both actual encoders were run, then their 16-bit samples were decoded with an
independent inverse ST 2084 equation. Rounded luminances are:

| Linear input | Parent PNG | Extension PNG |
| ---: | ---: | ---: |
| 1 | 203 nits | 100 nits |
| 2.03 | 412 nits | 203 nits |
| 10 / 2.03 | 1000 nits | 493 nits |
| 10 | 1000 nits | 1000 nits |

Both cap encoded luminance at 1000 nits. The multiplier affects RGB, not alpha.
Both emit identical HDR cICP metadata: `[9,16,0,1]` for Rec.2020 or
`[12,16,0,1]` for P3-D65. These identify PQ, RGB/full range and the primaries.
The extension's 16-bit PNGs have valid CRCs and IHDR, cICP, IDAT, IEND ordering.
An ICC profile is not required when cICP describes the color space; see the
[PNG cICP specification](https://www.w3.org/TR/png-3/#cICP-chunk).
Read-only parent comparison evidence is `.tools/hdr-encoder-comparison.json`;
the standalone extension and its audit target do not depend on parent files.

## OCIO agreement and the authoring repair

`//:hdr_audit` independently runs the complete official ACEScg-to-PQ display
transform through OpenColorIO 2.5.0 and the bundled
`cg-config-v4.0.0_aces-v2.0_ocio-v2.5` config. The two HDR views use their matching
Rec.2100-PQ and ST2084-P3-D65 displays. Eight scene colors per view include
black, gray, bright neutrals, a saturated color and a neutral reaching 1000 nits.
The shipping WASM view followed by this extension's encoder agrees with the
complete OCIO PQ processor to a maximum normalized code error of
**0.000006888**, within 16-bit quantization.

Adding 2.03 at the PNG boundary would brighten the same ACEScg foreground
relative to the official OCIO view. Linear input 2.03 already encodes 203 nits;
PQ does not require that the encoder's input 1 mean 203 nits.

The v0.1.6 authoring path fed 203-nit-relative XYZ directly into OCIO's
100-nit-unit inverse. Neutral J′ = 1 therefore encoded **492.629 nits**, and
reference-white J′ encoded about 100 nits. This limited the neutral range
despite the 1000-nit view; it did not prove SDR-only WebView presentation.

Version 0.1.7 multiplies authoring XYZ by 2.03 before the canonical HDR inverse
and divides the forward HDR XYZ on scene import. WASM, the WebGPU entry point,
and the generated WebGL entry point now agree. Surrounds and display-referred
helpers use the same conversion; ColorChecker coordinates are solved from the
corrected units while preserving their scene targets and forward-view fills.
The existing authoring bound `10 / 2.03`, appearance equations and J′ domain
remain. Numerically neutral/black coordinate imports are stabilized, and the
existing scene-match guard still protects unavailable external colors.

The fix intentionally changes the ACEScg scene color associated with a given
picker coordinate. Existing Photoshop foreground colors are preserved and
imported into corrected coordinates. Independent tests cover all four views,
physical white/peak PNGs, float32 foreground round trips, ColorChecker
coordinates and GPU masks. PNG encoding remains tied to absolute OCIO output.

## Photoshop's embedded presentation path

`panel.html` embeds a UXP WebView. `web/presentation.ts` decodes PNG Blob URLs
into HTML image elements. The GPU worker computes pixels; it does not control
the browser's HDR decoder, compositor or display surface.

Adobe documents [HDR display setup in Photoshop](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/set-up-hdr-display-support-in-photoshop.html)
and identifies macOS WKWebView in the [UXP changelog](https://developer.adobe.com/uxp/uxp-api/changelog).
These do not establish that this plugin's WebView presents PQ PNGs with HDR
headroom. The supplied captures identify Adobe UXP WebView and WebGL2; their
compatibility user agent does not identify the actual macOS or WebKit release.
Successful decoding or GPU rendering does not prove HDR display output.

WebKit documents HDR images and CSS `dynamic-range-limit` in
[Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
Apple describes `no-limit` as the default in its
[HDR image presentation session](https://developer.apple.com/videos/play/wwdc2025/233/).
Version 0.1.7 explicitly requests `no-limit`, with `high` as a spelling accepted
by some engines. Unsupported declarations are ignored. This requests HDR
eligibility rather than proving native HDR output. The evolving
[CSS HDR draft](https://drafts.csswg.org/css-color-hdr/#dynamic-range-limit)
defines the range control; Safari's documented unrestricted spelling is
`no-limit`.

WebKit fixed HDR detection for positioned/transformed layers; see the
[implementation fix](https://github.com/WebKit/WebKit/pull/52982) and
[Safari 26.4 notes](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/).
The reported image case uses JPEG gain maps. Version 0.1.6 always scaled the
interface, even with sufficient space. Version 0.1.7 reserves rounding room
and uses no transform when controls fit, retaining scaling for smaller panels.
`web/style.css` still positions the interface absolutely. A related layer
problem is plausible but **not confirmed for our PQ PNGs or Adobe's WebView**.
Removing only the transform also leaves positioned ancestors; an unchanged
result does not exclude every layer issue.

## Reproducible display probe

From this standalone Buck2 root after bootstrap:

```sh
buck2 build //:hdr_audit --show-output
```

The output includes `report.json`, `probe.html`, `panel-inspector.js`, and
individual PNGs. The page embeds RGB and opaque RGBA references for both HDR
views: **0, 18, 50, 100, 203, 500, 1000 nits** from left to right. Open it in
Safari where the parent PNG works, and compare HDR-allowed versus standard
range. Its CSS white is an SDR interface reference whose brightness follows
the browser/display setting, not an absolute-nits measurement.

Paste `panel-inspector.js` into the **embedded WebView inspector console**,
not the native UXP console. It temporarily replaces the actual pad and preview
with the same references without host messages or foreground writes. Avoid
gestures and resizing while testing so ordinary rendering does not replace
the probe. Use:

```js
modcam16HdrProbe.limit('no-limit') // Use 'high' if only cssHigh is supported.
modcam16HdrProbe.limit('standard')
modcam16HdrProbe.show(2)           // P3-D65; show(0) returns to Rec.2020.
modcam16HdrProbe.limit('no-limit')
modcam16HdrProbe.unscaled()       // Temporarily remove the interface transform.
modcam16HdrProbe.report           // Browser signals and ancestor styles.
modcam16HdrProbe.restore()
```

Restoration returns connected original images to their saved sources/styles
and restores the interface transform. Reload the panel if normal rendering
replaced those elements. Unscaled controls may overflow a small panel during
the comparison; this is not a production layout change.

If identical 1000-nit references show HDR in Safari but remain SDR in the panel,
investigate the native WebView HDR surface/integration. If removing scaling
restores HDR, repair compositor/layout interaction while preserving resizing
and no-scroll behavior. The authoring normalization is repaired in v0.1.7.
Media queries and CSS support are clues, not
proof of physical HDR; absolute-nits acceptance requires display measurement.

Audit assertions and 32 unit/OCIO tests pass through Buck2. Chromium on
SwiftShader also decodes all four probe images and passes controls and inspector
restoration checks. Linux cannot verify Photoshop's WKWebView surface or the
user's physical HDR display.
