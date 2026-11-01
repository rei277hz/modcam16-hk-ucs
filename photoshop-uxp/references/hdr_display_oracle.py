"""Independent complete OCIO ACEScg -> HDR display/PQ reference vectors."""
import json
from pathlib import Path
import numpy as np
import PyOpenColorIO as ocio

config = ocio.Config.CreateFromFile(str(Path(__file__).with_name('config.ocio')))
scenes = [[0, 0, 0], [.18, .18, .18], [1, 1, 1], [4, 4, 4],
          [20, 20, 20], [100, 100, 100], [4096, 4096, 4096], [8, .1, .01]]
records = []
for view_id, view, display in [
    (0, 'ACES 2.0 - HDR 1000 nits (Rec.2020)', 'Rec.2100-PQ - Display'),
    (2, 'ACES 2.0 - HDR 1000 nits (P3 D65)', 'ST2084-P3-D65 - Display'),
]:
    transform = ocio.DisplayViewTransform()
    transform.setSrc('ACEScg')
    transform.setDisplay(display)
    transform.setView(view)
    processor = config.getProcessor(transform).getDefaultCPUProcessor()
    values = np.asarray(scenes, dtype=np.float32)
    processor.applyRGB(values)
    records.append(dict(viewId=view_id, view=view, display=display,
                        scene=scenes, pq=values.tolist()))
print(json.dumps(dict(ocio=ocio.GetVersion(), config=config.getName(), records=records)))
