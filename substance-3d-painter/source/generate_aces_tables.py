"""Extract ACES 2.0 inverse tables from the official OCIO GPU processors."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import numpy as np

try:
    import PyOpenColorIO as ocio
except ImportError as exc:  # pragma: no cover - dependency diagnostic
    raise RuntimeError("PyOpenColorIO 2.5 is required to extract ACES tables") from exc

import OpenEXR


HERE = Path(__file__).resolve().parent
RELEASE_ROOT = HERE.parent
DEFAULT_CONFIG = HERE / "cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio"
TABLE_WIDTH = 363
PROFILE_ROWS = (
    ("rec2020_hdr", "ACES 2.0 - HDR 1000 nits (Rec.2020)"),
    ("p3_hdr", "ACES 2.0 - HDR 1000 nits (P3 D65)"),
    ("p3_sdr", "ACES 2.0 - SDR 100 nits (P3 D65)"),
    ("rec709_sdr", "ACES 2.0 - SDR 100 nits (Rec.709)"),
)
HUES_PATTERN = re.compile(
    r"const float ocio_gamut_cusp_table_0_hues_array\[363\]"
    r" = float\[363\]\((.*?)\);",
    re.DOTALL,
)
NUMBER_PATTERN = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _extract_hues(shader_text: str) -> np.ndarray:
    match = HUES_PATTERN.search(shader_text)
    if match is None:
        raise RuntimeError("OCIO shader did not contain the 363-entry hue sentinel array")
    values = np.asarray(
        [float(value) for value in NUMBER_PATTERN.findall(match.group(1))],
        dtype=np.float32,
    )
    if values.shape != (TABLE_WIDTH,) or not np.isfinite(values).all():
        raise RuntimeError("OCIO hue sentinel array is not finite 363-sample data")
    return values


def _extract_profile(config: Any, view_name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
    view = config.getViewTransform(view_name)
    if view is None:
        raise RuntimeError(f"Missing OCIO view transform: {view_name}")
    transform = view.getTransform(ocio.VIEWTRANSFORM_DIR_FROM_REFERENCE)
    if transform is None:
        raise RuntimeError(f"Missing scene-reference transform: {view_name}")
    inverse = ocio.BuiltinTransform(transform.getStyle())
    inverse.setDirection(ocio.TRANSFORM_DIR_INVERSE)
    processor = config.getProcessor(inverse)
    descriptor = ocio.GpuShaderDesc.CreateShaderDesc(ocio.GPU_LANGUAGE_GLSL_4_0)
    processor.getDefaultGPUProcessor().extractGpuShaderInfo(descriptor)

    textures = {texture.textureName: np.asarray(texture.getValues(), dtype=np.float32)
                for texture in descriptor.getTextures()}
    try:
        reach = textures["ocio_reach_m_table_0"]
        cusp = textures["ocio_gamut_cusp_table_0"]
    except KeyError as exc:
        raise RuntimeError(f"OCIO shader is missing an ACES table texture: {exc}") from exc
    if reach.shape != (TABLE_WIDTH,) or cusp.shape != (TABLE_WIDTH * 3,):
        raise RuntimeError(
            f"Unexpected OCIO table dimensions: reach={reach.shape}, cusp={cusp.shape}"
        )
    if not np.isfinite(reach).all() or not np.isfinite(cusp).all():
        raise RuntimeError(f"OCIO table payload for {view_name} is not finite")
    return reach, cusp.reshape(TABLE_WIDTH, 3), _extract_hues(descriptor.getShaderText()), transform.getStyle()


def build_payload(config_path: Path) -> tuple[np.ndarray, list[dict[str, str]]]:
    config = ocio.Config.CreateFromFile(str(config_path))
    payload = np.zeros((12, TABLE_WIDTH, 3), dtype=np.float32)
    profiles: list[dict[str, str]] = []
    for index, (profile_id, view_name) in enumerate(PROFILE_ROWS):
        reach, cusp, hues, transform_style = _extract_profile(config, view_name)
        payload[index * 3, :, 0] = reach
        payload[index * 3 + 1] = cusp
        payload[index * 3 + 2, :, 0] = hues
        profiles.append({
            "id": profile_id,
            "view": view_name,
            "inverse_transform": transform_style,
            "rows": f"{index * 3}=reach, {index * 3 + 1}=cusp, {index * 3 + 2}=hues",
        })
    return payload, profiles


def write_exr(path: Path, payload: np.ndarray) -> None:
    header = {
        "compression": OpenEXR.ZIP_COMPRESSION,
        "type": OpenEXR.scanlineimage,
        "comments": "RAW ACES 2.0 inverse tables; 4 profiles x (reach,cusp,hues), RGB32F.",
    }
    values = np.ascontiguousarray(payload, dtype=np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    with OpenEXR.File(header, {"RGB": values}) as output:
        output.write(str(path))
    with OpenEXR.File(str(path)) as input_file:
        reread = input_file.channels()["RGB"].pixels
    if reread.dtype != np.float32 or not np.array_equal(reread, values):
        raise RuntimeError("EXR round-trip changed the ACES table payload")


def write_manifest(path: Path, lut_path: Path, payload: np.ndarray,
                   config_path: Path, profiles: list[dict[str, str]]) -> None:
    config_hash = hashlib.sha256(config_path.read_bytes()).hexdigest()
    manifest = {
        "version": "2.0",
        "lut": lut_path.name,
        "width": int(payload.shape[1]),
        "height": int(payload.shape[0]),
        "sample_type": "FLOAT (32-bit)",
        "compression": {
            "name": "ZIP16",
            "openexr_constant": "ZIP_COMPRESSION",
            "scanlines_per_block": 16,
        },
        "orientation": {
            "payload": "canonical OpenEXR scanline order",
            "painter_gpu_rows": "vertically reversed on import",
            "shader_compensation": "logical row y maps to physical row 11-y",
        },
        "payload_layout": {
            "rows": "each profile uses consecutive reach, cusp, and hue rows",
            "reach": "R channel of the first row; 363 samples",
            "cusp": "RGB values of the second row; 363 samples",
            "hues": "R channel of the third row; 363 samples including sentinel endpoints",
            "unused_channels": "zero-filled",
        },
        "rows": [
            "Rec.2020 HDR reach/cusp/hues",
            "P3-D65 HDR reach/cusp/hues",
            "P3-D65 SDR reach/cusp/hues",
            "Rec.709 SDR reach/cusp/hues",
        ],
        "acquisition": {
            "method": "PyOpenColorIO GPUProcessor.extractGpuShaderInfo with a GLSL 4.0 descriptor",
            "oracle": "PyOpenColorIO CPUProcessor for the matching official ACES 2.0 inverse BuiltinTransform",
            "configuration": "source/cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio",
            "configuration_sha256": config_hash,
            "ocio_profile_version": "2.5",
            "aces_config": "ACES v4.0.0 CG configuration with ACES v2.0 output transforms",
            "upstream": "https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES",
            "notes": "Reach and cusp values come from OCIO GPU textures; hue sentinels come from the generated OCIO shader text.",
        },
        "profiles": profiles,
        "generator": "source/generate_aces_tables.py",
        "sha256": hashlib.sha256(lut_path.read_bytes()).hexdigest(),
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG,
                        help="official ACES OCIO configuration to query")
    parser.add_argument("--output", type=Path,
                        default=RELEASE_ROOT / "aces2_inverse_tables.exr")
    args = parser.parse_args()
    config_path = args.config.resolve()
    if not config_path.is_file():
        raise FileNotFoundError(f"Missing OCIO configuration: {config_path}")
    payload, profiles = build_payload(config_path)
    write_exr(args.output, payload)
    manifest_path = args.output.with_name("aces2_inverse_tables-manifest.json")
    write_manifest(manifest_path, args.output, payload, config_path, profiles)
    print(f"wrote {args.output} ({TABLE_WIDTH}x{payload.shape[0]}, RGB float32)")
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()
