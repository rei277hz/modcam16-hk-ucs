import { encodePreview, encodeLinearRgbPng } from './png';
import { arrival, reply, type PreviewRequest, type CheckerPngRequest } from './jobs';
globalThis.onmessage = (event: MessageEvent<PreviewRequest | CheckerPngRequest>) => {
  const request = event.data, timings = arrival(request), start = performance.now();
  try {
    if (request.type === 'preview') {
      const png = encodePreview(request.view, request.display, request.background, request.valid, timings);
      timings.totalMs = performance.now() - start;
      reply({ ...request, png, timings }, [png.buffer]);
    } else {
      const patches = request.patches.map(patch => ({ code: patch.code, png: encodeLinearRgbPng(request.view, 1, 1, patch.display) }));
      timings.totalMs = performance.now() - start;
      reply({ ...request, type: 'checker', patches, timings }, patches.map(patch => patch.png.buffer));
    }
  } catch (error) { reply({ type: 'error', id: request.id, message: String(error) }); }
};
