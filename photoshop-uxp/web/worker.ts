import { ColorCore } from './core';
import { encodeLinearRgbaPng } from './png';
import { SliceWebGpuRenderer } from './webgpu';
import { SliceWebGlRenderer } from './webgl';
import { arrival, deviceInfo, reply, type Backend, type RenderRequest } from './jobs';
const ready = ColorCore.create().then(core => ({ core, params: core.parameters() }));
const gpu = new SliceWebGpuRenderer(), gl = new SliceWebGlRenderer();
let gpuFailed = false, glFailed = false;
const failures: string[] = [];
// Sender-side backpressure limits this worker to one request. Synchronous
// readback and PNG work cannot block evaluation or preview workers.
globalThis.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const request = event.data, timings = arrival(request), started = performance.now();
  try {
    const { core, params } = await ready;
    timings.initializationMs = performance.now() - started;
    let pixels: Float32Array | undefined, renderer: Backend = 'WASM', size = 256;
    let device = deviceInfo('WASM');
    const renderStart = performance.now();
    if (!gpuFailed && gpu.available) {
      try {
        pixels = await gpu.render(params, request.view, request.code[0], size, size, request.full);
        renderer = 'WebGPU'; device = gpu.info; Object.assign(timings, gpu.timings);
      } catch (error) { gpuFailed = true; gpu.dispose(); failures.push('WebGPU: '+String(error)); }
    }
    if (!pixels && !glFailed && gl.available) {
      try {
        pixels = await gl.render(params, request.view, request.code[0], size, size, request.full,
          measured => reply({ type: 'gpu-timing', id: request.id, timings: measured }));
        renderer = 'WebGL2'; device = gl.info; Object.assign(timings, gl.timings);
      } catch (error) { glFailed = true; gl.dispose(); failures.push('WebGL2: '+String(error)); }
    }
    if (!pixels) {
      size = request.interacting ? 128 : 256;
      pixels = core.slice(request.view, request.code[0], size, size, 0, size, request.full);
      timings.gpuMs = null; timings.gpuTimer = 'unavailable';
    }
    timings.renderMs = performance.now() - renderStart;
    const png = encodeLinearRgbaPng(request.view, size, size, pixels, timings);
    timings.totalMs = performance.now() - started;
    reply({ ...request, png, renderer, size, device, timings, failures: [...failures] }, [png.buffer]);
  } catch (error) { reply({ type: 'error', id: request.id, message: String(error) }); }
};
