//! Fixed HDR-Rec.2020 authoring. View IDs affect presentation only.
//! Legacy normalized/polar exports in lib.rs remain for regression coverage.
use super::*;

const SOURCE_SCALE: f64 = 2.03;
const SOURCE_PEAK: f64 = 10.0 / SOURCE_SCALE;
const SOURCE_BACKGROUND_MAX: f64 = 1.0;
// modCAM16-HK of neutral source Rec.2020 = 1000/203, independently checked in Python.
const PICKER_J_PEAK: f64 = 217.2768649129496;
// Inverse of the decomposition module's D65-XYZ -> ACES2065-1 matrix.
// Prepared image pixels are linear AP0, so this recovers source display XYZ
// before the fixed HDR-Rec.2020 inverse is applied.
const AP0_TO_XYZ_D65: [[f64; 3]; 3] = [
    [0.938279841815694, -0.004451445665284, 0.016627526998033],
    [0.337368891456768, 0.729521570671540, -0.066890458295250],
    [0.001173949539939, -0.003710705591141, 1.091594511691737],
];
#[cfg(test)]
const XYZ_D65_TO_AP0: [[f64; 3]; 3] = [
    [1.0634955, 0.00640891, -0.01580679],
    [-0.49207413, 1.3682234, 0.09133709],
    [-0.00281646, 0.00464417, 0.91641857],
];

fn source_valid(rgb: [f64; 3]) -> bool {
    finite3(rgb) && min3(rgb) >= -1.0e-8 && max3(rgb) <= SOURCE_PEAK + 1.0e-7
}

fn authored_valid(xyz: [f64; 3], full_rec2020: bool) -> bool {
    let rec2020 = mat(&XYZ_TO_REC2020, xyz);
    let p3 = mat(&XYZ_TO_P3, xyz);
    source_valid(rec2020) && (full_rec2020 || source_valid(p3))
}

fn source_valid_with_peak(rgb: [f64; 3], peak: f64) -> bool {
    // Prepared rasters are f32 and may have passed through a 16-bit PQ
    // round-trip plus two color-space matrices. Allow the resulting few ulps
    // of upper-bound overshoot while still rejecting negative or genuinely
    // above-peak source values.
    finite3(rgb) && min3(rgb) >= -1.0e-8 && max3(rgb) <= peak + 5.0e-5
}

fn source_sample_mode(code: [f64; 3], full_rec2020: bool) -> Sample {
    let xyz = match decode_scaled_jhk(code, PICKER_J_PEAK) {
        Some((j, c, h)) => modcam_to_xyz(normalized_model(2), j, c, h),
        None => [f64::NAN; 3],
    };
    let source_rgb = mat(&XYZ_TO_REC2020, xyz);
    let valid = finite3(xyz) && authored_valid(xyz, full_rec2020);
    // Never present a clipped inverse as the scene value of an invalid pick.
    let acescg = if valid {
        aces_output::inverse(0, xyz.map(|v| v * SOURCE_SCALE))
    } else {
        [f64::NAN; 3]
    };
    Sample {
        xyz,
        source_rgb,
        acescg,
        valid: valid && finite3(acescg),
    }
}

#[cfg(test)]
fn source_sample(code: [f64; 3]) -> Sample {
    source_sample_mode(code, true)
}

fn desaturated_code(code: [f64; 3]) -> [f64; 3] {
    [
        code[0],
        0.5 + 0.75 * (code[1] - 0.5),
        0.5 + 0.75 * (code[2] - 0.5),
    ]
}

fn clipped_appearance_acescg(code: [f64; 3]) -> Option<[f64; 3]> {
    let (j, chroma, hue) = decode_scaled_jhk(code, PICKER_J_PEAK)?;
    let xyz = modcam_to_xyz(normalized_model(2), j, chroma, hue);
    if !finite3(xyz) {
        return None;
    }
    let clipped_source = mat(&XYZ_TO_REC2020, xyz).map(|value| value.clamp(0.0, SOURCE_PEAK));
    if !finite3(clipped_source) {
        return None;
    }
    let clipped_xyz = mat(&REC2020_TO_XYZ, clipped_source);
    let acescg = aces_output::inverse(0, clipped_xyz.map(|value| value * SOURCE_SCALE));
    finite3(acescg).then_some(acescg)
}

fn appearance_acescg(code: [f64; 3], desaturate: bool) -> Option<[f64; 3]> {
    if desaturate {
        clipped_appearance_acescg(desaturated_code(code))
    } else {
        let sample = source_sample_mode(code, true);
        sample.valid.then_some(sample.acescg)
    }
}

fn view_rgb(view: u32, acescg: [f64; 3]) -> [f64; 3] {
    let matrix = match view {
        0 => &XYZ_TO_REC2020,
        2 | 4 => &XYZ_TO_P3,
        _ => &XYZ_TO_REC709,
    };
    // OCIO view XYZ is Y=1 at 100 nits, including HDR views.
    mat(matrix, aces_output::forward(view, acescg))
}

fn neutral_source(j: f64) -> f64 {
    let xyz = modcam_to_xyz(normalized_model(2), j * PICKER_J_PEAK, 0.0, 0.0);
    xyz[1].clamp(0.0, SOURCE_PEAK)
}

/// Layout (all floating point):
/// 0 valid; 1..3 canonical ACEScg; 4..6 source-preview display P3;
/// 7..9 source-preview sRGB; 10..12 sRGB-transfer-encoded AP1;
/// 13..18 reserved; 19 foreground-matching normalized J';
/// 20..22 authored J'/x'/y'; 23..25 linear authoring Rec.2020 (203-nit units);
/// 26..28 picked view linear RGB (100-nit units);
/// 29..31 surround view linear RGB (100-nit units); 32 reserved.
#[wasm_bindgen]
pub fn picker_evaluate_mode(
    view: u32,
    j: f64,
    x: f64,
    y: f64,
    background_j: f64,
    full_rec2020: bool,
    desaturate: bool,
) -> Vec<f64> {
    let sample = source_sample_mode([j, x, y], full_rec2020);
    let requested_background_j = if background_j.is_finite() {
        background_j.clamp(0.0, SOURCE_BACKGROUND_MAX)
    } else {
        0.0
    };
    let background_source = neutral_source(requested_background_j);
    let background_xyz = mat(&REC2020_TO_XYZ, [background_source * SOURCE_SCALE; 3]);
    let background_scene = aces_output::inverse(0, background_xyz);
    let mut out = vec![if sample.valid { 1.0 } else { 0.0 }];
    out.extend(sample.acescg);
    out.extend(display_xyz_f64(sample.xyz, &XYZ_TO_P3));
    out.extend(display_xyz_f64(sample.xyz, &XYZ_TO_REC709));
    out.extend(encode_extended_rgb(sample.acescg));
    out.extend([0.0; 6]);
    out.extend([j, j, x, y]);
    out.extend(sample.source_rgb);
    out.extend(if sample.valid {
        appearance_acescg([j, x, y], desaturate)
            .map(|value| view_rgb(view, value))
            .unwrap_or([0.0; 3])
    } else {
        [0.0; 3]
    });
    out.extend(view_rgb(view, background_scene));
    out.push(0.0);
    out
}

#[wasm_bindgen]
pub fn picker_evaluate(view: u32, j: f64, x: f64, y: f64, background_j: f64) -> Vec<f64> {
    picker_evaluate_mode(view, j, x, y, background_j, true, false)
}

/// Import sRGB-transfer encoded AP1 and solve coordinates in fixed HDR Rec.2020.
/// The caller evaluates the solved coordinates again: they determine ACEScg.
#[wasm_bindgen]
pub fn picker_from_encoded_mode(red: f64, green: f64, blue: f64, full_rec2020: bool) -> Vec<f64> {
    let scene = [red, green, blue].map(decode_srgb);
    let xyz = aces_output::forward(0, scene).map(|v| v / SOURCE_SCALE);
    let (code, domain_valid) = scaled_jhk_from_xyz(xyz, PICKER_J_PEAK);
    let valid = domain_valid && authored_valid(xyz, full_rec2020);
    vec![if valid { 1.0 } else { 0.0 }, code[0], code[1], code[2]]
}

#[wasm_bindgen]
pub fn picker_from_encoded(red: f64, green: f64, blue: f64) -> Vec<f64> {
    picker_from_encoded_mode(red, green, blue, true)
}

/// Convert one prepared ACES2065-1/AP0 sample to the canonical ACEScg value
/// and normalized J'/x'/y' coordinates used by the image locator. Prepared
/// image rasters from the reference decoder are already linear AP0, so this
/// is numerically the same fixed HDR-Rec.2020 inverse path used for authored picker
/// coordinates without reinterpreting the source a second time.
///
/// Return layout: [valid, ACEScg R/G/B, J', x', y'].
#[wasm_bindgen]
pub fn picker_analyze_ap0(red: f64, green: f64, blue: f64) -> Vec<f64> {
    // Analysis is canonical and independent of the appearance-only scale
    // toggle.  The fixed authoring path always applies 2.03; the worker uses
    // `scale203` only when rendering image/loupe display pixels.
    picker_analyze_ap0_scaled(red, green, blue, true)
}

/// Analyze a prepared AP0 sample, optionally applying the 2.03 SDR-to-HDR
/// source scale before the fixed HDR-Rec.2020 inverse.
#[wasm_bindgen]
pub fn picker_analyze_ap0_scaled(red: f64, green: f64, blue: f64, scale203: bool) -> Vec<f64> {
    let ap0 = [red, green, blue];
    // Prepared image rasters are either in the picker source unit (203 nits
    // per Rec.2020 unit) or absolute HDR/100-nit units. Normalize the latter back
    // to the canonical source unit for J'/x'/y' and validity, while passing
    // physical 100-nit XYZ unchanged to the fixed HDR inverse.
    let raster_xyz = mat(&AP0_TO_XYZ_D65, ap0);
    let source_xyz = if scale203 {
        raster_xyz
    } else {
        raster_xyz.map(|v| v / SOURCE_SCALE)
    };
    let raster_rgb = mat(&XYZ_TO_REC2020, raster_xyz);
    let source_peak = if scale203 { SOURCE_PEAK } else { 10.0 };
    let (code, domain_valid) =
        super::scaled_jhk_from_xyz_with_tolerance(source_xyz, PICKER_J_PEAK, 1.0e-4);
    let acescg = if finite3(raster_xyz) && source_valid_with_peak(raster_rgb, source_peak) {
        let inverse_xyz = if scale203 {
            raster_xyz.map(|v| v * SOURCE_SCALE)
        } else {
            raster_xyz
        };
        aces_output::inverse(0, inverse_xyz)
    } else {
        [f64::NAN; 3]
    };
    let valid = finite3(ap0)
        && finite3(raster_xyz)
        && finite3(acescg)
        && domain_valid
        && source_valid_with_peak(raster_rgb, source_peak);
    let mut out = Vec::with_capacity(7);
    out.push(if valid { 1.0 } else { 0.0 });
    out.extend(acescg);
    out.extend(code);
    out
}

/// Convert prepared AP0 into selected-view display-linear RGB. This is the
/// appearance-only path used by loaded-image and loupe previews.
#[wasm_bindgen]
pub fn picker_display_rgb_ap0_mode(
    red: f64,
    green: f64,
    blue: f64,
    view: u32,
    scale203: bool,
    desaturate: bool,
) -> Vec<f64> {
    let source_xyz = mat(&AP0_TO_XYZ_D65, [red, green, blue]);
    let scale = if scale203 { SOURCE_SCALE } else { 1.0 };
    let acescg = aces_output::inverse(0, source_xyz.map(|v| v * scale));
    if !desaturate {
        return view_rgb(view, acescg).to_vec();
    }
    let source_peak = if scale203 { SOURCE_PEAK } else { 10.0 };
    let source_rgb = mat(&XYZ_TO_REC2020, source_xyz);
    if !source_valid_with_peak(source_rgb, source_peak) {
        return vec![0.0; 3];
    }
    let normalized_xyz = if scale203 {
        source_xyz
    } else {
        source_xyz.map(|value| value / SOURCE_SCALE)
    };
    let (code, domain_valid) =
        scaled_jhk_from_xyz_with_tolerance(normalized_xyz, PICKER_J_PEAK, 1.0e-4);
    if !domain_valid {
        return vec![0.0; 3];
    }
    appearance_acescg(code, true)
        .map(|value| view_rgb(view, value).to_vec())
        .unwrap_or_else(|| vec![0.0; 3])
}

#[wasm_bindgen]
pub fn picker_display_rgb_ap0(
    red: f64,
    green: f64,
    blue: f64,
    view: u32,
    scale203: bool,
) -> Vec<f64> {
    picker_display_rgb_ap0_mode(red, green, blue, view, scale203, false)
}

/// Batch appearance conversion for image previews and loupes.  The optional
/// 2.03 multiplier belongs exclusively to this display path; callers doing
/// image statistics should continue to use `picker_analyze_ap0` so changing
/// the appearance toggle cannot change the sampled-color result.
#[wasm_bindgen]
pub fn picker_display_rgb_ap0_batch_mode(
    pixels: &[f32],
    view: u32,
    scale203: bool,
    desaturate: bool,
) -> Vec<f32> {
    if pixels.len() % 3 != 0 {
        return Vec::new();
    }
    let mut output = Vec::with_capacity(pixels.len());
    for pixel in pixels.chunks_exact(3) {
        let rgb = picker_display_rgb_ap0_mode(
            pixel[0] as f64,
            pixel[1] as f64,
            pixel[2] as f64,
            view,
            scale203,
            desaturate,
        );
        output.extend(rgb.into_iter().map(|v| v as f32));
    }
    output
}

#[wasm_bindgen]
pub fn picker_display_rgb_ap0_batch(pixels: &[f32], view: u32, scale203: bool) -> Vec<f32> {
    picker_display_rgb_ap0_batch_mode(pixels, view, scale203, false)
}

/// Solve canonical normalized J′/x′/y′ coordinates from an averaged ACEScg
/// scene-linear colour.  Image-locator averages are intentionally performed
/// in ACEScg before this nonlinear forward solve.
#[wasm_bindgen]
pub fn picker_code_from_acescg(red: f64, green: f64, blue: f64) -> Vec<f64> {
    let acescg = [red, green, blue];
    let xyz = aces_output::forward(0, acescg);
    let source_xyz = xyz.map(|v| v / SOURCE_SCALE);
    let source_rgb = mat(&XYZ_TO_REC2020, source_xyz);
    let (code, domain_valid) = scaled_jhk_from_xyz(source_xyz, PICKER_J_PEAK);
    let valid = finite3(acescg) && finite3(xyz) && domain_valid && source_valid(source_rgb);
    let mut out = Vec::with_capacity(4);
    out.push(if valid { 1.0 } else { 0.0 });
    out.extend(code);
    out
}

/// Fixed source slice: view switches never alter the mask or its coordinates.
#[wasm_bindgen]
pub fn picker_render_rows(
    j: f64,
    width: u32,
    height: u32,
    y_start: u32,
    y_end: u32,
    display_p3: bool,
) -> Vec<u8> {
    let width = width.max(1) as usize;
    let height = height.max(1) as usize;
    let start = (y_start as usize).min(height);
    let end = (y_end as usize).min(height).max(start);
    let mut output = vec![0; (end - start) * width * 4];
    for y in start..end {
        for x in 0..width {
            let sx = if width == 1 {
                0.5
            } else {
                x as f64 / (width - 1) as f64
            };
            let sy = if height == 1 {
                0.5
            } else {
                1.0 - y as f64 / (height - 1) as f64
            };
            // Raster needs source validity, not the expensive ACES inverse.
            let xyz = decode_scaled_jhk([j, sx, sy], PICKER_J_PEAK)
                .map(|(jh, c, h)| modcam_to_xyz(normalized_model(2), jh, c, h))
                .unwrap_or([f64::NAN; 3]);
            let rgb = if source_valid(mat(&XYZ_TO_REC2020, xyz)) {
                display_rgb(
                    xyz,
                    if display_p3 {
                        &XYZ_TO_P3
                    } else {
                        &XYZ_TO_REC709
                    },
                )
            } else {
                let shade = if ((x / 7) + (y / 7)) % 2 == 0 { 22 } else { 15 };
                [shade, shade + 2, shade + 5]
            };
            let offset = ((y - start) * width + x) * 4;
            output[offset..offset + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
        }
    }
    output
}

/// Render selected-view display-linear RGB for one Cartesian slice row range.
///
/// Each pixel is `[R, G, B, valid]`. This is the deterministic fallback for
/// the WebGPU slice renderer and follows the same fixed authoring pipeline as
/// [`picker_evaluate`]: modCAM16-HK -> Rec.2020-D65 authoring linear -> fixed inverse
/// fixed Rec.2020 ACES 2.0 inverse -> selected forward ACES 2.0 view.
#[wasm_bindgen]
pub fn picker_render_linear_rows_mode(
    view: u32,
    j: f64,
    width: u32,
    height: u32,
    y_start: u32,
    y_end: u32,
    full_rec2020: bool,
    desaturate: bool,
) -> Vec<f32> {
    let width = width.max(1) as usize;
    let height = height.max(1) as usize;
    let start = (y_start as usize).min(height);
    let end = (y_end as usize).min(height).max(start);
    let mut output = vec![0.0_f32; (end - start) * width * 4];
    for y in start..end {
        for x in 0..width {
            let sx = if width == 1 {
                0.5
            } else {
                x as f64 / (width - 1) as f64
            };
            let sy = if height == 1 {
                0.5
            } else {
                1.0 - y as f64 / (height - 1) as f64
            };
            let sample = source_sample_mode([j, sx, sy], full_rec2020);
            let index = ((y - start) * width + x) * 4;
            if sample.valid {
                let rgb = appearance_acescg([j, sx, sy], desaturate)
                    .map(|value| view_rgb(view, value))
                    .unwrap_or([0.0; 3]);
                output[index] = rgb[0] as f32;
                output[index + 1] = rgb[1] as f32;
                output[index + 2] = rgb[2] as f32;
                output[index + 3] = 1.0;
            }
        }
    }
    output
}

#[wasm_bindgen]
pub fn picker_render_linear_rows(
    view: u32,
    j: f64,
    width: u32,
    height: u32,
    y_start: u32,
    y_end: u32,
) -> Vec<f32> {
    picker_render_linear_rows_mode(view, j, width, height, y_start, y_end, true, false)
}

/// ACES fixed-function parameters and reach/cusp tables for the WGSL slice
/// implementation. Values originate in the checked-in official OCIO config;
/// the Painter GLSL defines the GPU equation ordering used by the shader.
#[wasm_bindgen]
pub fn picker_gpu_parameters() -> Vec<f32> {
    aces_output::gpu_parameter_blob()
}

/// Fixed 18 seven-float records: canonical J'/x'/y', selected-view display
/// linear RGB for the dot fill, and always-available.
#[wasm_bindgen]
pub fn picker_colorchecker_mode(view: u32, desaturate: bool) -> Vec<f64> {
    let mut output = Vec::with_capacity(126);
    for lab in COLORCHECKER_LAB_D50 {
        let scene = mat(
            &XYZ_D65_TO_ACESCG,
            mat(&D50_TO_D65_CAT02, lab_d50_to_xyz(lab)),
        );
        let xyz = aces_output::forward(0, scene).map(|v| v / SOURCE_SCALE);
        let (code, _domain_valid) = scaled_jhk_from_xyz(xyz, PICKER_J_PEAK);
        output.extend(code);
        output.extend(
            appearance_acescg(code, desaturate)
                .map(|value| view_rgb(view, value))
                .unwrap_or([0.0; 3]),
        );
        output.push(1.0);
    }
    output
}

#[wasm_bindgen]
pub fn picker_colorchecker() -> Vec<f64> {
    let mut output = Vec::with_capacity(180);
    for lab in COLORCHECKER_LAB_D50 {
        let scene = mat(
            &XYZ_D65_TO_ACESCG,
            mat(&D50_TO_D65_CAT02, lab_d50_to_xyz(lab)),
        );
        let xyz = aces_output::forward(0, scene).map(|v| v / SOURCE_SCALE);
        let (code, domain_valid) = scaled_jhk_from_xyz(xyz, PICKER_J_PEAK);
        output.extend(code);
        output.extend(display_xyz_f64(xyz, &XYZ_TO_P3));
        output.extend(display_xyz_f64(xyz, &XYZ_TO_REC709));
        output.push(if domain_valid && source_valid(mat(&XYZ_TO_REC2020, xyz)) {
            1.0
        } else {
            0.0
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn views_share_coordinates_scene_and_background_marker() {
        let base = picker_evaluate(2, 0.38, 0.86, 0.62, 0.15);
        for view in [0, 1, 2, 4] {
            let other = picker_evaluate(view, 0.38, 0.86, 0.62, 0.15);
            assert_eq!(&other[..26], &base[..26]);
        }
    }

    #[test]
    fn physical_white_endpoints_and_neutral_surround_match() {
        for (nits, j) in [
            (0.0, 0.0),
            (100.0, 76.02655940839014 / PICKER_J_PEAK),
            (1000.0, 1.0),
        ] {
            for view in [0, 1, 2, 4] {
                let value = picker_evaluate(view, j, 0.5, 0.5, j);
                assert_eq!(value[0], 1.0);
                for channel in 0..3 {
                    assert!((value[23 + channel] * 203.0 - nits).abs() < 1e-5);
                    assert!((value[26 + channel] - value[29 + channel]).abs() < 1e-7);
                }
            }
        }
    }

    #[test]
    fn background_j_is_normalized_and_invalid_picks_have_no_scene() {
        let zero = picker_evaluate(2, 0.3, 0.5, 0.5, 0.0);
        let peak = picker_evaluate(2, 0.3, 0.5, 0.5, 1.0);
        assert_eq!(zero[32], 0.0);
        assert_eq!(peak[32], 0.0);
        assert!(peak[29..32].iter().all(|v| v.is_finite()));
        assert!(peak[29] > zero[29]);
        let invalid = picker_evaluate(2, 0.9, 0.01, 0.01, 0.15);
        assert_eq!(invalid[0], 0.0);
        assert!(invalid[1..4].iter().all(|v| v.is_nan()));
    }

    #[test]
    fn authoring_validity_uses_rec2020_instead_of_p3() {
        let sample = source_sample([0.2, 0.21, 0.53]);
        let p3 = mat(&XYZ_TO_P3, sample.xyz);
        let rec2020 = mat(&XYZ_TO_REC2020, sample.xyz);
        assert!(min3(p3) < -1.0e-4, "sample should be outside P3: {p3:?}");
        assert!(
            source_valid(rec2020),
            "sample should be inside Rec.2020: {rec2020:?}"
        );
        assert!(sample.valid, "Rec.2020-valid authored sample was rejected");

        let outside = source_sample([0.2, 0.0, 0.0]);
        assert!(!source_valid(mat(&XYZ_TO_REC2020, outside.xyz)));
        assert!(
            !outside.valid,
            "Rec.2020-invalid authored sample was accepted"
        );
    }

    #[test]
    fn full_off_requires_the_p3_authoring_cube() {
        let code = [0.2, 0.21, 0.53];
        let full = picker_evaluate_mode(0, code[0], code[1], code[2], 0.0, true, false);
        let restricted = picker_evaluate_mode(0, code[0], code[1], code[2], 0.0, false, false);
        assert_eq!(full[0], 1.0);
        assert_eq!(restricted[0], 0.0);

        let above_p3_peak = [0.61, 0.97, 0.59];
        let sample = source_sample(above_p3_peak);
        let p3 = mat(&XYZ_TO_P3, sample.xyz);
        assert!(
            sample.valid,
            "sample must remain valid in full Rec.2020 mode"
        );
        assert!(
            min3(p3) >= 0.0 && max3(p3) > SOURCE_PEAK,
            "expected P3 upper-cube violation: {p3:?}"
        );
        let restricted = picker_evaluate_mode(
            0,
            above_p3_peak[0],
            above_p3_peak[1],
            above_p3_peak[2],
            0.0,
            false,
            false,
        );
        assert_eq!(restricted[0], 0.0);

        let neutral = picker_evaluate_mode(0, 0.8, 0.5, 0.5, 0.0, false, false);
        assert_eq!(neutral[0], 1.0);
        assert!(neutral[23..26].iter().all(|value| *value > 1.0));
    }

    #[test]
    fn desaturation_changes_appearance_but_not_canonical_results() {
        let normal = picker_evaluate_mode(0, 0.38, 0.72, 0.63, 0.15, true, false);
        let desaturated = picker_evaluate_mode(0, 0.38, 0.72, 0.63, 0.15, true, true);
        assert_eq!(&normal[..26], &desaturated[..26]);
        assert_eq!(&normal[29..], &desaturated[29..]);
        assert!(normal[26..29]
            .iter()
            .zip(&desaturated[26..29])
            .any(|(a, b)| (a - b).abs() > 1.0e-5));
    }

    #[test]
    fn desaturation_clips_out_of_cube_intermediates_without_changing_availability() {
        let code = picker_code_from_acescg(25.2811, 29.6013, 0.0422);
        assert_eq!(code[0], 1.0);
        let normal = picker_evaluate_mode(0, code[1], code[2], code[3], 0.15, true, false);
        let desaturated = picker_evaluate_mode(0, code[1], code[2], code[3], 0.15, true, true);
        assert_eq!(normal[0], 1.0);
        assert_eq!(desaturated[0], 1.0);
        assert_eq!(&normal[..26], &desaturated[..26]);
        assert!(desaturated[26..29].iter().all(|value| value.is_finite()));
        assert!(desaturated[26..29].iter().any(|value| value.abs() > 1.0e-9));

        let source = source_sample([code[1], code[2], code[3]]);
        let ap0 = mat(&XYZ_D65_TO_AP0, source.xyz);
        let image = picker_display_rgb_ap0_mode(ap0[0], ap0[1], ap0[2], 0, true, true);
        assert!(image.iter().all(|value| value.is_finite()));
        assert!(image.iter().any(|value| value.abs() > 1.0e-9));
    }

    #[test]
    fn colorchecker_mode_retains_every_patch() {
        let points = picker_colorchecker_mode(0, true);
        assert_eq!(points.len(), 18 * 7);
        assert!(points.chunks_exact(7).all(|record| {
            record[6] == 1.0
                && record[3..6].iter().all(|value| value.is_finite())
                && record[3..6].iter().any(|value| value.abs() > 1.0e-9)
        }));
    }

    #[test]
    fn desaturation_preserves_the_cpu_slice_availability_mask() {
        let normal = picker_render_linear_rows_mode(0, 0.9999989, 65, 65, 0, 65, true, false);
        let desaturated = picker_render_linear_rows_mode(0, 0.9999989, 65, 65, 0, 65, true, true);
        assert_eq!(normal.len(), desaturated.len());
        for index in (3..normal.len()).step_by(4) {
            assert_eq!(normal[index], desaturated[index], "alpha index {index}");
        }
    }

    #[test]
    fn image_scale_changes_display_only_and_not_canonical_analysis() {
        let ap0 = [0.18, 0.07, 0.03];
        let analysis = picker_analyze_ap0(ap0[0], ap0[1], ap0[2]);
        let scaled_analysis = picker_analyze_ap0_scaled(ap0[0], ap0[1], ap0[2], true);
        assert_eq!(analysis, scaled_analysis);
        assert_eq!(
            analysis,
            picker_analyze_ap0_scaled(ap0[0], ap0[1], ap0[2], true)
        );
        // The two flags describe different raster units.  Feeding the
        // corresponding physical representations must recover the same
        // canonical color (the raw AP0 value above is the checked 203-nit
        // representation; the unchecked representation is divided by 2.03).
        let unscaled_physical = ap0.map(|v| v * SOURCE_SCALE);
        let unscaled_physical_analysis = picker_analyze_ap0_scaled(
            unscaled_physical[0],
            unscaled_physical[1],
            unscaled_physical[2],
            false,
        );
        for i in 1..7 {
            assert!(
                (scaled_analysis[i] - unscaled_physical_analysis[i]).abs() < 2.0e-8,
                "analysis channel {i}: {} vs {}",
                scaled_analysis[i],
                unscaled_physical_analysis[i]
            );
        }
        assert_eq!(analysis, scaled_analysis);
        let scaled = picker_display_rgb_ap0(ap0[0], ap0[1], ap0[2], 4, true);
        let unscaled = picker_display_rgb_ap0(ap0[0], ap0[1], ap0[2], 4, false);
        assert!(scaled
            .iter()
            .zip(unscaled.iter())
            .any(|(a, b)| (a - b).abs() > 1.0e-6));
    }

    #[test]
    fn unchecked_hdr_white_is_valid_but_above_peak_is_rejected() {
        // AP0 encoding of absolute Rec.2020 white at the HDR 1000-nit peak. The
        // unchecked raster uses absolute 100-nit units, so 10.0 is the valid
        // upper bound rather than the legacy 10/2.03 source-unit bound.
        let rec2020_white = [10.0; 3];
        let ap0_white = mat(&XYZ_D65_TO_AP0, mat(&REC2020_TO_XYZ, rec2020_white));
        let valid = picker_analyze_ap0_scaled(ap0_white[0], ap0_white[1], ap0_white[2], false);
        assert_eq!(valid[0], 1.0);
        // The decomposition path stores AP0 as f32.  This rounded white
        // models the small matrix/PQ boundary error seen in prepared PNGs.
        let rounded = picker_analyze_ap0_scaled(9.999999, 10.0, 9.999999, false);
        assert_eq!(rounded[0], 1.0);
        let above = ap0_white.map(|v| v * 1.001);
        let invalid = picker_analyze_ap0_scaled(above[0], above[1], above[2], false);
        assert_eq!(invalid[0], 0.0);
    }

    #[test]
    fn linear_slice_center_matches_picker_evaluation_in_every_view() {
        for view in [0, 1, 2, 4] {
            let rows = picker_render_linear_rows(view, 0.38, 3, 3, 1, 2);
            let center = &rows[4..8];
            let evaluated = picker_evaluate(view, 0.38, 0.5, 0.5, 0.15);
            assert_eq!(center[3], 1.0);
            for channel in 0..3 {
                assert!((center[channel] as f64 - evaluated[26 + channel]).abs() < 2.0e-6);
            }
        }
    }
}
