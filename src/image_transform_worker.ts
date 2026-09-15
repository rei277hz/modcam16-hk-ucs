import init, {
  image_picker_display_rgb_ap0_batch,
} from "./wasm/decomposition_pkg/modcam16_decomposition_wasm.js";
import type { ViewId } from "./preview_png";

type TransformRequest = {
  id: number;
  pixels: ArrayBuffer;
  view: ViewId;
  scale203: boolean;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TransformRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
const ready = init();

scope.onmessage = event => {
  const request = event.data;
  void ready.then(() => {
    const pixels = new Float32Array(request.pixels);
    const output = image_picker_display_rgb_ap0_batch(pixels, request.view, request.scale203);
    scope.postMessage({ id: request.id, pixels: output.buffer }, [output.buffer]);
  }).catch(error => {
    scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  });
};
