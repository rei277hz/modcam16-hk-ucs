//! Fixed HDR-P3 authoring. View IDs affect presentation only.
//! Legacy normalized/polar exports in lib.rs remain for regression coverage.
use super::*;

const SOURCE_SCALE: f64 = 2.03;
const SOURCE_PEAK: f64 = 10.0 / SOURCE_SCALE;
const SOURCE_BACKGROUND_MAX: f64 = 1.0;
// modCAM16-HK of neutral source P3 = 1000/203, independently checked in Python.
const PICKER_J_PEAK: f64 = 217.2768649129496;

fn source_valid(rgb: [f64; 3]) -> bool {
    finite3(rgb) && min3(rgb) >= -1.0e-8 && max3(rgb) <= SOURCE_PEAK + 1.0e-7
}

fn source_sample(code: [f64; 3]) -> Sample {
    let xyz = match decode_scaled_jhk(code, PICKER_J_PEAK) {
        Some((j, c, h)) => modcam_to_xyz(normalized_model(2), j, c, h),
        None => [f64::NAN; 3],
    };
    let source_rgb = mat(&XYZ_TO_P3, xyz);
    let valid = finite3(xyz) && source_valid(source_rgb);
    // Never present a clipped inverse as the scene value of an invalid pick.
    let acescg = if valid {
        aces_output::inverse(2, xyz.map(|v| v * SOURCE_SCALE))
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
/// 0 valid; 1..3 canonical ACEScg; 4..6 source encoded P3;
/// 7..9 source encoded sRGB; 10..12 sRGB-transfer-encoded AP1;
/// 13..18 reserved; 19 foreground-matching normalized J';
/// 20..22 authored J'/x'/y'; 23..25 linear source P3 (203-nit units);
/// 26..28 picked view linear RGB (100-nit units);
/// 29..31 surround view linear RGB (100-nit units); 32 reserved.
#[wasm_bindgen]
pub fn picker_evaluate(view: u32, j: f64, x: f64, y: f64, background_j: f64) -> Vec<f64> {
    let sample = source_sample([j, x, y]);
    let requested_background_j = if background_j.is_finite() {
        background_j.clamp(0.0, SOURCE_BACKGROUND_MAX)
    } else {
        0.0
    };
    let background_source = neutral_source(requested_background_j);
    let background_xyz = mat(&P3_TO_XYZ, [background_source * SOURCE_SCALE; 3]);
    let background_scene = aces_output::inverse(2, background_xyz);
    let mut out = vec![if sample.valid { 1.0 } else { 0.0 }];
    out.extend(sample.acescg);
    out.extend(display_xyz_f64(sample.xyz, &XYZ_TO_P3));
    out.extend(display_xyz_f64(sample.xyz, &XYZ_TO_REC709));
    out.extend(encode_extended_rgb(sample.acescg));
    out.extend([0.0; 6]);
    out.extend([j, j, x, y]);
    out.extend(sample.source_rgb);
    out.extend(if sample.valid {
        view_rgb(view, sample.acescg)
    } else {
        [0.0; 3]
    });
    out.extend(view_rgb(view, background_scene));
    out.push(0.0);
    out
}

/// Import sRGB-transfer encoded AP1 and solve coordinates in fixed HDR P3.
/// The caller evaluates the solved coordinates again: they determine ACEScg.
#[wasm_bindgen]
pub fn picker_from_encoded(red: f64, green: f64, blue: f64) -> Vec<f64> {
    let scene = [red, green, blue].map(decode_srgb);
    let xyz = aces_output::forward(2, scene).map(|v| v / SOURCE_SCALE);
    let (code, domain_valid) = scaled_jhk_from_xyz(xyz, PICKER_J_PEAK);
    let valid = domain_valid && source_valid(mat(&XYZ_TO_P3, xyz));
    vec![if valid { 1.0 } else { 0.0 }, code[0], code[1], code[2]]
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
            let rgb = if source_valid(mat(&XYZ_TO_P3, xyz)) {
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
/// [`picker_evaluate`]: modCAM16-HK -> P3-D65 display linear -> fixed inverse
/// HDR P3 ACES 2.0 -> selected forward ACES 2.0 view.
#[wasm_bindgen]
pub fn picker_render_linear_rows(
    view: u32,
    j: f64,
    width: u32,
    height: u32,
    y_start: u32,
    y_end: u32,
) -> Vec<f32> {
    let width = width.max(1) as usize;
    let height = height.max(1) as usize;
    let start = (y_start as usize).min(height);
    let end = (y_end as usize).min(height).max(start);
    let mut output = vec![0.0_f32; (end - start) * width * 4];
    for y in start..end {
        for x in 0..width {
            let sx = if width == 1 { 0.5 } else { x as f64 / (width - 1) as f64 };
            let sy = if height == 1 { 0.5 } else { 1.0 - y as f64 / (height - 1) as f64 };
            let sample = source_sample([j, sx, sy]);
            let index = ((y - start) * width + x) * 4;
            if sample.valid {
                let rgb = view_rgb(view, sample.acescg);
                output[index] = rgb[0] as f32;
                output[index + 1] = rgb[1] as f32;
                output[index + 2] = rgb[2] as f32;
                output[index + 3] = 1.0;
            }
        }
    }
    output
}

/// ACES fixed-function parameters and reach/cusp tables for the WGSL slice
/// implementation. Values originate in the checked-in official OCIO config;
/// the Painter GLSL defines the GPU equation ordering used by the shader.
#[wasm_bindgen]
pub fn picker_gpu_parameters() -> Vec<f32> {
    aces_output::gpu_parameter_blob()
}

/// Fixed 18 ten-float records: J', x', y', encoded source P3, sRGB, available.
#[wasm_bindgen]
pub fn picker_colorchecker() -> Vec<f64> {
    let mut output = Vec::with_capacity(180);
    for lab in COLORCHECKER_LAB_D50 {
        let scene = mat(
            &XYZ_D65_TO_ACESCG,
            mat(&D50_TO_D65_CAT02, lab_d50_to_xyz(lab)),
        );
        let xyz = aces_output::forward(2, scene).map(|v| v / SOURCE_SCALE);
        let (code, domain_valid) = scaled_jhk_from_xyz(xyz, PICKER_J_PEAK);
        output.extend(code);
        output.extend(display_xyz_f64(xyz, &XYZ_TO_P3));
        output.extend(display_xyz_f64(xyz, &XYZ_TO_REC709));
        output.push(if domain_valid && source_valid(mat(&XYZ_TO_P3, xyz)) {
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
