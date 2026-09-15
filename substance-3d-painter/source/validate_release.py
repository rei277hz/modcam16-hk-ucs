"""Validate the packed Painter shader and LUTs against official PyOpenColorIO."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import moderngl
import numpy as np
import OpenEXR

try:
    import PyOpenColorIO as ocio
except ImportError as exc:  # pragma: no cover - dependency diagnostic
    raise RuntimeError("PyOpenColorIO 2.5 is required for release validation") from exc

from generate_aces_tables import build_payload
from generate_whitepoint_lut import (
    D65_WHITE_UV,
    D65_WHITE_XYZ,
    planck_uv_tangent,
    reference_coordinates,
)


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONFIG = HERE / "cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio"
PROFILE = "ACES 2.0 - HDR 1000 nits (Rec.2020)"
AP0_TO_ACESCG = np.array(
    [
        [1.4514393161456653, -0.23651074689374019, -0.21492856925192524],
        [-0.07655377339602043, 1.1762296998335731, -0.0996759264375522],
        [0.008316148425697719, -0.006032449791021028, 0.9977163013653233],
    ],
    dtype=np.float64,
)
CAT16 = np.array(
    [[0.401288, 0.650173, -0.051461],
     [-0.250268, 1.204414, 0.045854],
     [-0.002079, 0.048952, 0.953127]],
    dtype=np.float64,
)
CAT16_INV = np.array(
    [[1.86206786, -1.01125463, 0.14918678],
     [0.38752654, 0.62144744, -0.00897399],
     [-0.0158415, -0.03412294, 1.04996444]],
    dtype=np.float64,
)

# Each row stores normalized shader input (J', x', y') followed by its
# corresponding XYZ-D65 decode result, precomputed from the maintained
# modCAM16-HK decode contract.
FIXTURES = np.array(
    [
        [0.112547569, 0.500090003, 0.516813040, 0.025227164543843, 0.026205417233069, 0.028575646446005],
        [0.090331130, 0.352182388, 0.404482604, 0.005642222677216, 0.006933077021143, 0.003416868586367],
        [0.106114067, 0.688105822, 0.483932316, 0.010190615554478, 0.010482824039460, 0.019338844914618],
        [0.113946728, 0.369368464, 0.363253027, 0.010442279300287, 0.013658176161968, 0.007730339003621],
        [0.078317888, 0.447247803, 0.588867188, 0.007212434826522, 0.006985341997220, 0.006472843736806],
        [0.048975043, 0.613720357, 0.375614673, 0.001459702957542, 0.001630264931714, 0.002083194204088],
        [0.113733768, 0.437250942, 0.413027346, 0.018106063992900, 0.020812231991994, 0.018765335087439],
        [0.056248799, 0.546454847, 0.603279352, 0.002495603731615, 0.002495934289203, 0.002975199583116],
    ],
    dtype=np.float64,
)
PICKER_CODE = np.array([0.38, 0.38, 0.86], dtype=np.float32)
PICKER_XYZ = np.array([0.388071353650662, 0.170312703225082, 0.026136089974250], dtype=np.float64)


def _load_rgb(path: Path) -> np.ndarray:
    with OpenEXR.File(str(path)) as exr:
        return np.ascontiguousarray(exr.channels()["RGB"].pixels, dtype=np.float32)


def _ocio_inverse_batch(values: np.ndarray) -> np.ndarray:
    config = ocio.Config.CreateFromFile(str(CONFIG))
    view = config.getViewTransform(PROFILE)
    transform = view.getTransform(ocio.VIEWTRANSFORM_DIR_FROM_REFERENCE)
    inverse = ocio.BuiltinTransform(transform.getStyle())
    inverse.setDirection(ocio.TRANSFORM_DIR_INVERSE)
    processor = config.getProcessor(inverse).getDefaultCPUProcessor()
    result = np.asarray(values, dtype=np.float32).copy()
    for value in result:
        processor.applyRGB(value)
    return result.astype(np.float64) @ AP0_TO_ACESCG.T


def _uv_to_xyz(uv: np.ndarray) -> np.ndarray:
    u, v = np.asarray(uv, dtype=np.float64)
    denominator = 2.0 * u - 8.0 * v + 4.0
    x = 3.0 * u / denominator
    y = 2.0 * v / denominator
    return np.array((x / y, 1.0, (1.0 - x - y) / y), dtype=np.float64)


def _adapt_d65(xyz: np.ndarray, target: np.ndarray) -> np.ndarray:
    source_lms = CAT16 @ D65_WHITE_XYZ
    target_lms = CAT16 @ target
    return CAT16_INV @ ((target_lms / source_lms) * (CAT16 @ xyz))


def _sample_lut(payload: np.ndarray, coordinate: np.ndarray) -> np.ndarray:
    values = np.asarray(payload, dtype=np.float64)
    position = np.clip(np.asarray(coordinate, dtype=np.float64), 0.0, 1.0) * (np.array(values.shape[1::-1]) - 1.0)
    lower = np.floor(position).astype(np.int64)
    upper = np.minimum(lower + 1, np.array(values.shape[1::-1]) - 1)
    weight = position - lower
    c00 = values[lower[1], lower[0], :2]
    c10 = values[lower[1], upper[0], :2]
    c01 = values[upper[1], lower[0], :2]
    c11 = values[upper[1], upper[0], :2]
    return ((1.0 - weight[1]) * ((1.0 - weight[0]) * c00 + weight[0] * c10)
            + weight[1] * ((1.0 - weight[0]) * c01 + weight[0] * c11))


class ShaderHarness:
    def __init__(self) -> None:
        source = re.sub(
            r"^import lib-sparse\.glsl\s*$", "", (ROOT / "modcam16_hk_view.glsl").read_text(), flags=re.MULTILINE
        )
        adapter = """#version 410 core
struct SamplerSparse { sampler2D tex; vec4 size; bool is_set; bool is_color; uvec3 lod_mask_select; };
struct SparseCoord { vec2 tex_coord; }; struct V2F { SparseCoord sparse_coord; };
vec4 textureSparse(SamplerSparse s, SparseCoord c) { return textureLod(s.tex, c.tex_coord, 0.0); }
vec3 test_emissive; void albedoOutput(vec3 x) {} void diffuseShadingOutput(vec3 x) {}
void specularShadingOutput(vec3 x) {} void emissiveColorOutput(vec3 x) { test_emissive = x; }
void alphaOutput(float x) {} uniform vec2 test_size; out vec4 test_output;
"""
        main = """void main() { V2F i; i.sparse_coord.tex_coord = (gl_FragCoord.xy - vec2(0.5)) / test_size; shade(i); test_output = vec4(test_emissive, 1.0); }"""
        vertex = """#version 410 core
void main() { vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }
"""
        self.ctx = moderngl.create_standalone_context(backend="egl", require=410)
        self.program = self.ctx.program(vertex_shader=vertex, fragment_shader=adapter + source + main)
        self.vao = self.ctx.vertex_array(self.program, [])
        self.lut_payload = _load_rgb(ROOT / "whitepoint_cct_duv_lut.exr")
        self.tables_payload = _load_rgb(ROOT / "aces2_inverse_tables.exr")
        self.lut = self.ctx.texture((257, 257), 3, np.ascontiguousarray(np.flip(self.lut_payload, axis=0)).tobytes(), dtype="f4")
        self.tables = self.ctx.texture((363, 12), 3, np.ascontiguousarray(np.flip(self.tables_payload, axis=0)).tobytes(), dtype="f4")
        self.lut.filter = (moderngl.NEAREST, moderngl.NEAREST)
        self.tables.filter = (moderngl.NEAREST, moderngl.NEAREST)
        self.lut.use(location=0)
        self.tables.use(location=1)
        self.program["whitepoint_lut_tex"].value = 0
        self.program["aces_tables_tex"].value = 1

    def render(self, codes: np.ndarray, emissive: np.ndarray | None = None,
               user0: np.ndarray | None = None) -> np.ndarray:
        codes = np.asarray(codes, dtype=np.float32).reshape(-1, 3)
        count = len(codes)
        base = self.ctx.texture((count, 1), 3, np.ascontiguousarray(codes).tobytes(), dtype="f4")
        if emissive is None:
            emit_data = np.zeros((count, 3), dtype=np.float32)
            emit_data[:, 1:] = 0.5
        else:
            emit_data = np.asarray(emissive, dtype=np.float32)
        emit = self.ctx.texture((count, 1), 3, np.ascontiguousarray(emit_data).tobytes(), dtype="f4")
        users = np.full((count, 3), 0.5, dtype=np.float32) if user0 is None else np.asarray(user0, dtype=np.float32)
        user = self.ctx.texture((count, 1), 3, np.ascontiguousarray(users).tobytes(), dtype="f4")
        for texture in (base, emit, user):
            texture.filter = (moderngl.NEAREST, moderngl.NEAREST)
        for unit, texture, name in ((2, base, "basecolor_tex"), (3, emit, "emissive_tex"), (4, user, "user0_tex")):
            texture.use(location=unit)
            self.program[name + ".tex"].value = unit
            self.program[name + ".is_set"].value = True
        self.lut.use(location=0)
        self.tables.use(location=1)
        self.program["test_size"].value = (count, 1)
        target = self.ctx.texture((count, 1), 4, dtype="f4")
        framebuffer = self.ctx.framebuffer(color_attachments=[target])
        framebuffer.use()
        self.ctx.viewport = (0, 0, count, 1)
        self.vao.render(vertices=3)
        result = np.frombuffer(framebuffer.read(components=4, dtype="f4"), dtype=np.float32).reshape(count, 4)[:, :3].copy()
        framebuffer.release()
        target.release()
        base.release()
        emit.release()
        user.release()
        return result


def _check_assets() -> None:
    expected = {
        "whitepoint_cct_duv_lut.exr": (257, 257, "59e063a3ecf088cb5939c80fc98e48e5d0275a9b5237a8a7dadb2469f1ab88f9"),
        "aces2_inverse_tables.exr": (363, 12, "7abdf93229da5ea1e768302b5da891ad861510c221776ec039c0e103d856f7d7"),
    }
    for name, (width, height, digest) in expected.items():
        path = ROOT / name
        values = _load_rgb(path)
        assert values.shape == (height, width, 3), (name, values.shape)
        assert values.dtype == np.float32
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, name
    lut_manifest = json.loads((ROOT / "lut-manifest.json").read_text())
    table_manifest = json.loads((ROOT / "aces2_inverse_tables-manifest.json").read_text())
    assert lut_manifest["sha256"]["whitepoint_cct_duv_lut.exr"] == expected["whitepoint_cct_duv_lut.exr"][2]
    assert table_manifest["sha256"] == expected["aces2_inverse_tables.exr"][2]
    serialized = json.dumps((lut_manifest, table_manifest))
    assert "workspace/" not in serialized
    assert "colors/" not in serialized


def main() -> None:
    _check_assets()
    extracted, profiles = build_payload(CONFIG)
    tables = _load_rgb(ROOT / "aces2_inverse_tables.exr")
    np.testing.assert_array_equal(extracted, tables)
    assert len(profiles) == 4

    harness = ShaderHarness()
    expected = _ocio_inverse_batch(FIXTURES[:, 3:] * 2.03)
    actual = harness.render(FIXTURES[:, :3]).astype(np.float64)
    np.testing.assert_allclose(actual, expected, atol=1.0e-1, rtol=3.0e-3)

    cusp_expected = _ocio_inverse_batch((PICKER_XYZ * 2.03)[None, :])
    cusp_actual = harness.render(PICKER_CODE[None, :]).astype(np.float64)
    np.testing.assert_allclose(cusp_actual, cusp_expected, atol=3.0e-5, rtol=3.0e-5)

    user0 = np.array([[0.23, 0.74, 0.5]], dtype=np.float32)
    white_delta = _sample_lut(harness.lut_payload, user0[0, :2])
    target_white = _uv_to_xyz(D65_WHITE_UV + white_delta)
    adapted = _adapt_d65(PICKER_XYZ, target_white)
    wb_expected = _ocio_inverse_batch((adapted * 2.03)[None, :])
    wb_actual = harness.render(PICKER_CODE[None, :], user0=user0).astype(np.float64)
    np.testing.assert_allclose(wb_actual, wb_expected, atol=4.0e-5, rtol=4.0e-5)

    # User0.B offsets Base Color J' only; User0.R/G select the white point.
    offset_base = np.array([[0.30, 0.46, 0.57]], dtype=np.float32)
    offset_user = np.array([[0.50, 0.50, 0.45]], dtype=np.float32)
    explicit_lower = offset_base.copy()
    explicit_lower[:, 0] -= 0.05
    np.testing.assert_allclose(
        harness.render(offset_base, user0=offset_user),
        harness.render(explicit_lower),
        atol=2.0e-6,
        rtol=2.0e-6,
    )
    offset_user[:, 2] = 0.60
    explicit_upper = offset_base.copy()
    explicit_upper[:, 0] += 0.10
    np.testing.assert_allclose(
        harness.render(offset_base, user0=offset_user),
        harness.render(explicit_upper),
        atol=2.0e-6,
        rtol=2.0e-6,
    )

    # Base Color and Emissive use the same decoder and are added in scene
    # linear space. A neutral base plus an encoded emissive equals the
    # corresponding encoded base when both are independently inverted.
    emissive = np.array([[0.20, 0.55, 0.45]], dtype=np.float32)
    neutral_base = np.array([[0.0, 0.5, 0.5]], dtype=np.float32)
    np.testing.assert_allclose(
        harness.render(neutral_base, emissive=emissive),
        harness.render(emissive),
        atol=2.0e-6,
        rtol=2.0e-6,
    )

    np.testing.assert_allclose(harness.render(np.array([[0.0, 0.7, 0.3]], dtype=np.float32)), 0.0, atol=0.0, rtol=0.0)
    np.testing.assert_allclose(harness.render(np.array([[0.2, 1.0, 1.0]], dtype=np.float32)), [[1.0, 0.0, 0.0]], atol=0.0, rtol=0.0)
    bad_channel = np.array([[np.nan, 0.5, 0.5]], dtype=np.float32)
    np.testing.assert_allclose(harness.render(bad_channel), [[0.0, 0.0, 1.0]], atol=0.0, rtol=0.0)
    bad_user0 = np.array([[0.5, np.nan, 0.5]], dtype=np.float32)
    np.testing.assert_allclose(
        harness.render(np.array([[0.2, 0.5, 0.5]], dtype=np.float32), user0=bad_user0),
        [[0.0, 0.0, 1.0]],
        atol=0.0,
        rtol=0.0,
    )

    # Ensure the documented reference anchor is still represented in the LUT.
    assert np.linalg.norm(harness.lut_payload[128, 128]) == 0.0
    reference_temperature, _ = reference_coordinates()
    _, tangent = planck_uv_tangent(reference_temperature)
    tangent /= np.linalg.norm(tangent)
    normal = np.array([-tangent[1], tangent[0]])
    green = harness.lut_payload[round(0.75 * 256), 128, :2]
    magenta = harness.lut_payload[round(0.25 * 256), 128, :2]
    assert float(np.dot(green, normal)) < -0.005
    assert float(np.dot(magenta, normal)) > 0.005

    # A malformed target-white payload selects the shader's cyan diagnostic.
    bad_lut = np.zeros_like(harness.lut_payload)
    bad_lut[:, :, 1] = 1.0
    harness.lut.write(np.ascontiguousarray(np.flip(bad_lut, axis=0)).tobytes())
    np.testing.assert_allclose(
        harness.render(np.array([[0.2, 0.5, 0.5]], dtype=np.float32)),
        [[0.0, 1.0, 1.0]],
        atol=0.0,
        rtol=0.0,
    )
    print("packed Painter shader validation passed")


if __name__ == "__main__":
    main()
