#!/usr/bin/env python3
"""Emit official ACES 2.0 OCIO forward/inverse reference vectors.

This script deliberately uses PyOpenColorIO and the bundled config rather
than any Rust implementation. ``ocio_oracle.test.mjs`` compares its JSON
output with the browser WASM port.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import PyOpenColorIO as ocio
from picker_reference import PEAK, REFERENCE_J, P3, REC709, REC2020, code_xyz, neutral_jhk


CONFIG = Path(__file__).parent / "reference" / "cg-config-v4.0.0_aces-v2.0_ocio-v2.5.ocio"
PROFILES = {
    "0": "ACES 2.0 - HDR 1000 nits (Rec.2020)",
    "1": "ACES 2.0 - SDR 100 nits (Rec.709)",
    "2": "ACES 2.0 - HDR 1000 nits (P3 D65)",
    "4": "ACES 2.0 - SDR 100 nits (P3 D65)",
}
VECTORS = np.asarray(
    [
        [0.0, 0.0, 0.0],
        [0.1, 0.2, 0.3],
        [0.1, 0.1, 0.1],
        [0.2, 0.3, 0.4],
        [1.0, 0.0, 0.0],
        [0.08, 0.12, 0.18],
        [2.0, 0.5, 0.25],
    ],
    dtype=np.float32,
)


def _view_group(config: ocio.Config, view_name: str) -> ocio.GroupTransform:
    view = config.getViewTransform(view_name)
    if view is None:
        raise RuntimeError(f"Missing OCIO view transform: {view_name}")
    view_transform = view.getTransform(ocio.VIEWTRANSFORM_DIR_FROM_REFERENCE)
    if view_transform is None:
        raise RuntimeError(f"Missing scene-reference transform: {view_name}")
    colorspace = ocio.ColorSpaceTransform()
    colorspace.setSrc("ACEScg")
    colorspace.setDst("ACES2065-1")
    group = ocio.GroupTransform()
    group.appendTransform(colorspace)
    group.appendTransform(view_transform)
    return group


def _apply(processor: ocio.CPUProcessor, values: np.ndarray) -> list[list[float]]:
    result = np.ascontiguousarray(values, dtype=np.float32).copy()
    processor.applyRGB(result)
    return result.astype(np.float64).tolist()


def main() -> None:
    config = ocio.Config.CreateFromFile(str(CONFIG))
    records: dict[str, object] = {
        "config": str(CONFIG),
        "config_cache_id": str(config.getCacheID()),
        "vectors": VECTORS.astype(np.float64).tolist(),
        "profiles": {},
    }
    for profile_id, view_name in PROFILES.items():
        group = _view_group(config, view_name)
        forward = config.getProcessor(group).getDefaultCPUProcessor()
        inverse = config.getProcessor(
            group, ocio.TRANSFORM_DIR_INVERSE
        ).getDefaultCPUProcessor()
        profile_records = records["profiles"]
        assert isinstance(profile_records, dict)
        profile_records[profile_id] = {
            "view": view_name,
            "forward_xyz": _apply(forward, VECTORS),
            "inverse_acescg": _apply(inverse, VECTORS),
        }
    hdr_inverse = config.getProcessor(_view_group(config, PROFILES["0"]), ocio.TRANSFORM_DIR_INVERSE).getDefaultCPUProcessor()
    codes = [[0, .5, .5], [REFERENCE_J, .5, .5], [100 / PEAK, .5, .5],
             [1, .5, .5], [.38, .86, .62], [.3, .38, .65], [.6, .55, .53], [.1, .48, .52]]
    xyz = np.array([code_xyz(code) for code in codes])
    scene = _apply(hdr_inverse, xyz * 2.03)
    backgrounds = [0, REFERENCE_J, neutral_jhk(203) / PEAK, 1]
    bg_xyz = np.array([code_xyz([v, .5, .5]) * 2.03 for v in backgrounds])
    bg_scene = _apply(hdr_inverse, bg_xyz)
    records["picker"] = {
        "peak_jhk": PEAK, "reference_j": REFERENCE_J,
        "reference_100_jhk": neutral_jhk(100), "codes": codes,
        "source_rec2020": (xyz @ np.linalg.inv(REC2020).T).tolist(),
        "scene": scene, "backgrounds": backgrounds, "views": {},
    }
    for profile_id, view_name in PROFILES.items():
        forward = config.getProcessor(_view_group(config, view_name)).getDefaultCPUProcessor()
        inverse_matrix = np.linalg.inv({"0": REC2020, "1": REC709, "2": P3, "4": P3}[profile_id])
        records["picker"]["views"][profile_id] = {
            "rgb": (np.asarray(_apply(forward, np.asarray(scene))) @ inverse_matrix.T).tolist(),
            "background_rgb": (np.asarray(_apply(forward, np.asarray(bg_scene))) @ inverse_matrix.T).tolist(),
        }
    json.dump(records, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
