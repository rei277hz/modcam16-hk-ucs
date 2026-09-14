"""Generate the spectral User0 CCT/Duv delta-UV LUT for Painter."""

from __future__ import annotations

import argparse
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import brentq

T_MIN = 2000.0
T_MAX = 20000.0
DUV_HALF_RANGE = 0.02
ARC_SAMPLES = 32769
PLANCK_C2_MK = 0.014388
CIE_MD5 = "17cca777db64b17170f06f67ce9d3ab7"

HERE = Path(__file__).resolve().parent
RELEASE_ROOT = HERE.parent
CIE_PATH = HERE / "CIE_xyz_1931_2deg.csv"
D65_WHITE_XY = np.array([0.3127, 0.3290], dtype=np.float64)
D65_WHITE_XYZ = np.array(
    [D65_WHITE_XY[0] / D65_WHITE_XY[1], 1.0,
     (1.0 - D65_WHITE_XY.sum()) / D65_WHITE_XY[1]], dtype=np.float64)


def xy_to_uv(xy: np.ndarray) -> np.ndarray:
    values = np.asarray(xy, dtype=np.float64)
    x, y = values[..., 0], values[..., 1]
    denominator = -2.0 * x + 12.0 * y + 3.0
    return np.stack((4.0 * x / denominator, 6.0 * y / denominator), axis=-1)


D65_WHITE_UV = xy_to_uv(D65_WHITE_XY)
WHITE_XY = D65_WHITE_XY
WHITE_XYZ = D65_WHITE_XYZ
WHITE_UV = D65_WHITE_UV
# Backward-compatible aliases used by the reference test helpers.
AP1_WHITE_XY = D65_WHITE_XY
AP1_WHITE_XYZ = D65_WHITE_XYZ
AP1_WHITE_UV = D65_WHITE_UV


def uv_to_xyz(uv: np.ndarray) -> np.ndarray:
    values = np.asarray(uv, dtype=np.float64)
    u, v = values[..., 0], values[..., 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.stack((1.5 * u / v, np.ones_like(u),
                         (4.0 - u - 10.0 * v) / (2.0 * v)), axis=-1)


@lru_cache(maxsize=1)
def load_cmfs() -> np.ndarray:
    if not CIE_PATH.is_file():
        raise FileNotFoundError(f"Missing bundled observer data: {CIE_PATH}")
    digest = hashlib.md5(CIE_PATH.read_bytes()).hexdigest()
    if digest != CIE_MD5:
        raise ValueError(f"Bundled CIE observer checksum mismatch: {digest}")
    data = np.loadtxt(CIE_PATH, delimiter=",")
    if data.shape != (471, 4) or not np.array_equal(data[:, 0], np.arange(360.0, 831.0)):
        raise ValueError("Expected CIE 1931 2-degree data from 360 to 830 nm at 1 nm.")
    if not np.isfinite(data).all() or np.any(data[:, 1:] < 0.0):
        raise ValueError("CIE observer data must be finite and nonnegative.")
    return data.astype(np.float64, copy=False)


def planck_uv_tangent(temperatures: np.ndarray | float,
                      cmfs: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Integrate Planck spectra and return CIE 1960 uv and analytical tangent."""
    observer_data = load_cmfs() if cmfs is None else np.asarray(cmfs, dtype=np.float64)
    original = np.asarray(temperatures, dtype=np.float64)
    values = np.atleast_1d(original)
    if not np.isfinite(values).all() or np.any(values <= 0.0):
        raise ValueError("Planck temperatures must be finite and positive.")
    wavelengths = observer_data[:, 0] * 1.0e-9
    observer = observer_data[:, 1:].copy()
    observer[[0, -1]] *= 0.5
    uv_chunks: list[np.ndarray] = []
    tangent_chunks: list[np.ndarray] = []
    for start in range(0, len(values), 1024):
        temperature = values[start:start + 1024, None]
        exponent = PLANCK_C2_MK / (temperature * wavelengths)
        with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
            spectrum = (560.0e-9 / wavelengths) ** 5 / np.expm1(exponent)
            derivative = spectrum * exponent / (temperature * (-np.expm1(-exponent)))
        xyz = spectrum @ observer
        dxyz = derivative @ observer
        denominator = xyz[:, 0] + 15.0 * xyz[:, 1] + 3.0 * xyz[:, 2]
        ddenominator = dxyz[:, 0] + 15.0 * dxyz[:, 1] + 3.0 * dxyz[:, 2]
        numerator = xyz[:, :2] * np.array([4.0, 6.0])
        dnumerator = dxyz[:, :2] * np.array([4.0, 6.0])
        with np.errstate(divide="ignore", invalid="ignore"):
            uv_chunks.append(numerator / denominator[:, None])
            tangent_chunks.append((dnumerator * denominator[:, None] - numerator * ddenominator[:, None]) /
                                  denominator[:, None] ** 2)
    uv = np.concatenate(uv_chunks, axis=0)
    tangent = np.concatenate(tangent_chunks, axis=0)
    if original.ndim == 0:
        return uv[0], tangent[0]
    return uv.reshape(original.shape + (2,)), tangent.reshape(original.shape + (2,))


def cct_uv(temperature: np.ndarray | float) -> np.ndarray:
    return planck_uv_tangent(temperature)[0]


def tangent_normal(temperature: float) -> tuple[np.ndarray, np.ndarray]:
    _, tangent = planck_uv_tangent(float(temperature))
    tangent /= np.linalg.norm(tangent)
    # Preserve the tangent orientation; the UI-facing R/G reversals are
    # applied when normalized LUT coordinates are encoded below.
    return tangent, np.array([-tangent[1], tangent[0]])


def reference_coordinates() -> tuple[float, float]:
    def perpendicularity(temperature: float) -> float:
        locus, tangent = planck_uv_tangent(temperature)
        return float(np.dot(locus - D65_WHITE_UV, tangent))
    temperature = float(brentq(perpendicularity, 4500.0, 7500.0, xtol=1.0e-10))
    locus, tangent = planck_uv_tangent(temperature)
    tangent /= np.linalg.norm(tangent)
    normal = np.array([-tangent[1], tangent[0]])
    offset = float(np.dot(D65_WHITE_UV - locus, normal))
    residual = float(np.linalg.norm(locus + offset * normal - D65_WHITE_UV))
    if residual > 2.0e-10:
        raise RuntimeError(f"AP1 anchor residual is too large: {residual}")
    return temperature, offset


def row_curve(temperature: np.ndarray | float, duv: float,
              cmfs: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    locus, tangent = planck_uv_tangent(temperature, cmfs)
    tangent /= np.linalg.norm(tangent, axis=-1, keepdims=True)
    normal = np.stack((-tangent[..., 1], tangent[..., 0]), axis=-1)
    return locus + float(duv) * normal, locus


def build_lut(size: int = 257) -> tuple[np.ndarray, dict[str, Any]]:
    if size < 3 or size % 2 == 0:
        raise ValueError("LUT size must be an odd integer >= 3.")
    cmfs = load_cmfs()
    reference_temperature, reference_duv = reference_coordinates()
    temperatures = 1.0 / np.linspace(1.0 / T_MAX, 1.0 / T_MIN, ARC_SAMPLES)
    temperatures = np.sort(np.unique(np.r_[temperatures, reference_temperature]))
    locus, tangent = planck_uv_tangent(temperatures, cmfs)
    tangent /= np.linalg.norm(tangent, axis=-1, keepdims=True)
    normal = np.stack((-tangent[:, 1], tangent[:, 0]), axis=-1)
    rows: list[tuple[np.ndarray, np.ndarray, float]] = []
    half_arc = float("inf")
    for g in np.linspace(0.0, 1.0, size):
        # Reverse the Duv row axis so G > 0.5 selects the green side and
        # G < 0.5 selects the magenta side in the Painter UI.
        absolute_duv = reference_duv + DUV_HALF_RANGE * (1.0 - 2.0 * g)
        curve = locus + absolute_duv * normal
        cumulative = np.concatenate(([0.0], np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))))
        if not np.isfinite(cumulative).all() or np.any(np.diff(cumulative) <= 0.0):
            raise RuntimeError("Fixed-Duv row is degenerate or non-finite.")
        reference_distance = float(np.interp(reference_temperature, temperatures, cumulative))
        half_arc = min(half_arc, reference_distance, float(cumulative[-1] - reference_distance))
        rows.append((curve, cumulative, reference_distance))
    if not np.isfinite(half_arc) or half_arc <= 0.0:
        raise RuntimeError("Could not establish a positive common symmetric arc span.")
    # Higher red values should read as warmer in the UI. The spectral arc is
    # ordered from warm/lower-T to cool/higher-T, so encode it right-to-left.
    coordinates = 1.0 - np.linspace(0.0, 1.0, size)
    lut = np.empty((size, size, 3), dtype=np.float64)
    for row, (_, cumulative, reference_distance) in enumerate(rows):
        target = reference_distance + half_arc * (2.0 * coordinates - 1.0)
        row_temperature = np.interp(target, cumulative, temperatures)
        absolute_duv = reference_duv + DUV_HALF_RANGE * (1.0 - 2.0 * row / (size - 1))
        row_locus, row_tangent = planck_uv_tangent(row_temperature, cmfs)
        row_tangent /= np.linalg.norm(row_tangent, axis=-1, keepdims=True)
        row_normal = np.stack((-row_tangent[:, 1], row_tangent[:, 0]), axis=-1)
        lut[row, :, :2] = row_locus + absolute_duv * row_normal - D65_WHITE_UV
        lut[row, :, 2] = 0.0
    center = size // 2
    lut[center, center] = 0.0
    target_xyz = uv_to_xyz(D65_WHITE_UV + lut[:, :, :2])
    if not np.isfinite(lut).all() or not np.isfinite(target_xyz).all() or np.any(target_xyz <= 0.0):
        raise RuntimeError("Generated LUT contains a non-finite or non-positive white.")
    metadata: dict[str, Any] = {
        "size": size, "temperature_min": T_MIN, "temperature_max": T_MAX,
        "reference_temperature": reference_temperature, "reference_duv": reference_duv,
        "duv_half_range": DUV_HALF_RANGE, "symmetric_arc": half_arc,
        "reference_u": float(D65_WHITE_UV[0]), "reference_v": float(D65_WHITE_UV[1]),
        "observer_md5": CIE_MD5, "planck_c2_mK": PLANCK_C2_MK,
        "minimum_target_XYZ": target_xyz.reshape(-1, 3).min(axis=0).tolist(),
    }
    return lut.astype(np.float32), metadata


def sample_lut(array: np.ndarray, rg: np.ndarray) -> np.ndarray:
    values = np.asarray(array, dtype=np.float64)
    coordinates = np.asarray(rg, dtype=np.float64)
    if values.ndim != 3 or values.shape[2] < 2:
        raise ValueError("LUT must have shape (height, width, channels>=2).")
    flat = np.clip(coordinates.reshape(-1, 2), 0.0, 1.0)
    position = flat * (np.array(values.shape[1::-1], dtype=np.float64) - 1.0)
    lower = np.floor(position).astype(np.int64)
    upper = np.minimum(lower + 1, np.array(values.shape[1::-1]) - 1)
    weight = position - lower
    c00 = values[lower[:, 1], lower[:, 0], :2]
    c10 = values[lower[:, 1], upper[:, 0], :2]
    c01 = values[upper[:, 1], lower[:, 0], :2]
    c11 = values[upper[:, 1], upper[:, 0], :2]
    result = (c00 * (1.0 - weight[:, :1]) + c10 * weight[:, :1]) * (1.0 - weight[:, 1:2]) + \
             (c01 * (1.0 - weight[:, :1]) + c11 * weight[:, :1]) * weight[:, 1:2]
    return result.reshape(coordinates.shape[:-1] + (2,))


class Decoder:
    def __init__(self, samples: int = ARC_SAMPLES):
        self.cmfs = load_cmfs()
        self.reference_temperature, self.reference_duv = reference_coordinates()
        temperatures = 1.0 / np.linspace(1.0 / T_MAX, 1.0 / T_MIN, samples)
        self.temperatures = np.sort(np.unique(np.r_[temperatures, self.reference_temperature]))
        self.locus, tangent = planck_uv_tangent(self.temperatures, self.cmfs)
        tangent /= np.linalg.norm(tangent, axis=-1, keepdims=True)
        self.normal = np.stack((-tangent[:, 1], tangent[:, 0]), axis=-1)
        self.symmetric_arc = float("inf")
        for g in np.linspace(0.0, 1.0, 257):
            absolute_duv = self.reference_duv + DUV_HALF_RANGE * (1.0 - 2.0 * g)
            curve = self.locus + absolute_duv * self.normal
            cumulative = np.concatenate(
                ([0.0], np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1)))
            )
            reference_distance = float(
                np.interp(self.reference_temperature, self.temperatures, cumulative)
            )
            self.symmetric_arc = min(
                self.symmetric_arc,
                reference_distance,
                float(cumulative[-1] - reference_distance),
            )

    def decode_row(self, coordinate: np.ndarray, absolute_duv: float) -> tuple[np.ndarray, np.ndarray]:
        curve = self.locus + absolute_duv * self.normal
        cumulative = np.concatenate(([0.0], np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))))
        reference_distance = float(np.interp(self.reference_temperature, self.temperatures, cumulative))
        # Match build_lut's UI-facing red-axis reversal.
        target = reference_distance + self.symmetric_arc * (2.0 * (1.0 - np.asarray(coordinate)) - 1.0)
        temperature = np.interp(target, cumulative, self.temperatures)
        locus, tangent = planck_uv_tangent(temperature, self.cmfs)
        tangent /= np.linalg.norm(tangent, axis=-1, keepdims=True)
        normal = np.stack((-tangent[..., 1], tangent[..., 0]), axis=-1)
        return locus + absolute_duv * normal, temperature

    def decode(self, rg: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        values = np.asarray(rg, dtype=np.float64).reshape(-1, 2)
        uv = np.empty_like(values)
        temperatures = np.empty(len(values), dtype=np.float64)
        offsets = np.empty(len(values), dtype=np.float64)
        for index, (r, g) in enumerate(values):
            offsets[index] = self.reference_duv + DUV_HALF_RANGE * (1.0 - 2.0 * g)
            uv[index], temperatures[index] = self.decode_row(np.array([r]), offsets[index])
        return uv, temperatures, offsets


def write_exr(path: Path, lut: np.ndarray, metadata: dict[str, Any]) -> None:
    try:
        import OpenEXR
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("OpenEXR is required to write the LUT.") from exc
    # OpenEXR.ZIP_COMPRESSION is ZIP16: ZIP compression in 16-scanline blocks.
    # Keep this distinct from ZIPS, which uses one scanline per block.
    header = {
        "compression": OpenEXR.ZIP_COMPRESSION, "type": OpenEXR.scanlineimage,
        "comments": "RAW LUT DATA; User0 RG indexes delta CIE 1960 uv; LUT B is reserved zero. D65 identity at (0.5,0.5).",
        "whitePoint": "D65 xy=0.3127,0.3290",
        "lutTemperatureMin": float(metadata["temperature_min"]),
        "lutTemperatureMax": float(metadata["temperature_max"]),
        "lutReferenceTemperature": float(metadata["reference_temperature"]),
        "lutReferenceDuv": float(metadata["reference_duv"]),
        "lutDuvHalfRange": float(metadata["duv_half_range"]),
        "lutSymmetricArc": float(metadata["symmetric_arc"]),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = np.ascontiguousarray(lut, dtype=np.float32)
    with OpenEXR.File(header, {"RGB": payload}) as output:
        output.write(str(path))
    with OpenEXR.File(str(path)) as input_file:
        reread = input_file.channels()["RGB"].pixels
    if reread.dtype != np.float32 or not np.array_equal(reread, payload):
        raise RuntimeError("EXR round trip did not preserve float32 LUT samples.")


def write_manifest(path: Path, lut_path: Path, lut: np.ndarray, metadata: dict[str, Any]) -> None:
    manifest = {
        "version": "2.0", "lut": lut_path.name, "width": int(lut.shape[1]), "height": int(lut.shape[0]),
        "sample_type": "FLOAT (32-bit)",
        "compression": {
            "name": "ZIP16",
            "openexr_constant": "ZIP_COMPRESSION",
            "scanlines_per_block": 16,
        },
        "payload": {"R": "u - D65_white_u, CIE 1960 UCS", "G": "v - D65_white_v, CIE 1960 UCS", "B": "reserved zero"},
        "color_interpretation": "raw data; no gamma, gamut conversion, or color management",
        "import_orientation": "canonical OpenEXR scanline order; Painter GPU rows are vertically reversed and compensated in the shader",
        "orientation": "R increases from higher-temperature/cooler to lower-temperature/warmer for UI intuition; G increases toward green and decreases toward magenta",
        "orientation_reason": "A higher red paint value conventionally reads as warmer, and the green axis is explicitly reversed so higher G reads as greener and lower G as more magenta.",
        "coordinate_mapping": "spectral Planck integration, fixed-Duv CIE 1960 uv arc length, common symmetric span",
        "adaptation": "CAT16 from selected display D65 white to the LUT target white, applied before each ACES inverse",
        "reference_white_xy": AP1_WHITE_XY.tolist(), "reference_white_uv": AP1_WHITE_UV.tolist(),
        "reference_white_XYZ_Y1": AP1_WHITE_XYZ.tolist(),
        "center_payload": lut[lut.shape[0] // 2, lut.shape[1] // 2].tolist(),
        "metadata": metadata,
        "sha256": {lut_path.name: hashlib.sha256(lut_path.read_bytes()).hexdigest()},
        "generator": "source/generate_whitepoint_lut.py",
        "observer_data": "source/CIE_xyz_1931_2deg.csv",
        "observer_metadata": "source/CIE_xyz_1931_2deg.csv_metadata.json",
        "sources": ["https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer",
                    "https://www.nist.gov/publications/practical-use-and-calculation-cct-and-duv",
                    "https://docs.acescentral.com/encodings/acescg/",
                    "https://docs.acescentral.com/white-point/",
                    "https://adobedocs.github.io/painter-shader-api/api/parameters/all-custom-params/"],
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=RELEASE_ROOT / "whitepoint_cct_duv_lut.exr")
    parser.add_argument("--size", type=int, default=257)
    args = parser.parse_args()
    lut, metadata = build_lut(args.size)
    write_exr(args.output, lut, metadata)
    manifest_path = args.output.with_name("lut-manifest.json")
    write_manifest(manifest_path, args.output, lut, metadata)
    center = lut[args.size // 2, args.size // 2]
    print(f"wrote {args.output} ({args.size}x{args.size}, RGB float32)")
    print(f"identity delta UV = {center[0]:.9g}, {center[1]:.9g}, {center[2]:.9g}")
    print(f"reference CCT = {metadata['reference_temperature']:.9f} K")
    print(f"reference Duv = {metadata['reference_duv']:.12f}")
    print(f"symmetric uv arc = {metadata['symmetric_arc']:.12f}")
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()
