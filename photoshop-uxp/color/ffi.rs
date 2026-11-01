//! A synchronous, copy-out WASM ABI. The returned buffer is valid until the next
//! call. There are no JS heap objects or caller-controlled raw memory writes.
use super::*;
use std::cell::RefCell;

thread_local! { static RESULT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) }; }

fn output(values: Vec<f64>) -> *const f64 {
    RESULT.with(|slot| { let mut data = slot.borrow_mut(); *data = values; data.as_ptr() })
}

#[no_mangle]
pub extern "C" fn result_len() -> usize { RESULT.with(|slot| slot.borrow().len()) }

#[no_mangle]
pub extern "C" fn evaluate(view: u32, j: f64, x: f64, y: f64, full: u32) -> *const f64 {
    output(picker::picker_evaluate_mode(view, j, x, y, 0.15, full != 0))
}

#[no_mangle]
pub extern "C" fn import_scene(r: f64, g: f64, b: f64, full: u32) -> *const f64 {
    let mut code = picker::picker_code_from_acescg(r, g, b);
    if code[0] > 0.5 {
        let sample = picker::picker_evaluate_mode(0, code[1], code[2], code[3], 0.15, full != 0);
        let matches = sample[0] > 0.5 && sample[1..4].iter().zip([r,g,b]).all(|(a,b)|
            (a-b).abs() <= 2.0e-4 * b.abs().max(1.0));
        code[0] = if matches { 1.0 } else { 0.0 };
    }
    output(code)
}

#[no_mangle]
pub extern "C" fn scene_view(view: u32, r: f64, g: f64, b: f64) -> *const f64 {
    let matrix = match view { 0 => &XYZ_TO_REC2020, 2 | 4 => &XYZ_TO_P3, _ => &XYZ_TO_REC709 };
    output(mat(matrix, aces_output::forward(view, [r,g,b])).to_vec())
}

#[no_mangle]
pub extern "C" fn slice(view: u32, j: f64, width: u32, height: u32, start: u32, end: u32, full: u32) -> *const f64 {
    if width == 0 || height == 0 || width > 1024 || height > 1024 { return output(vec![]); }
    output(picker::picker_render_linear_rows_mode(view, j, width, height, start, end, full != 0)
        .into_iter().map(f64::from).collect())
}

#[no_mangle]
pub extern "C" fn parameters() -> *const f64 {
    output(picker::picker_gpu_parameters().into_iter().map(f64::from).collect())
}

#[no_mangle]
pub extern "C" fn checker(view: u32) -> *const f64 { output(picker::picker_colorchecker_mode(view)) }
