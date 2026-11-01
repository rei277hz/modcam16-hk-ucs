import { ColorCore } from './core';
import { arrival, reply, type SelectionRequest, type CheckerRequest, type Patch } from './jobs';
import type { RGB } from '../host/protocol';
const coreReady = ColorCore.create();
globalThis.onmessage = async (event: MessageEvent<SelectionRequest | CheckerRequest>) => {
  const request = event.data, timings = arrival(request), start = performance.now();
  try {
    const core = await coreReady;
    timings.initializationMs = performance.now() - start;
    const evaluated = performance.now();
    if (request.type === 'selection') {
      let code = request.code, representable = true;
      const external = request.scene;
      if (external) {
        const imported = core.import(external, request.full);
        representable = imported[0] > .5;
        if (representable) code = Array.from(imported.slice(1,4));
      }
      const values = core.evaluate(request.view, code, request.full);
      const valid = representable && values[0] > .5;
      const scene = external ?? Array.from(values.slice(1,4)) as RGB;
      const display = Array.from(external ? core.view(request.view, external) : values.slice(26,29)) as RGB;
      timings.evaluateMs = performance.now() - evaluated;
      reply({ type: 'selection', id: request.id, epoch: request.epoch, view: request.view, code, scene, valid, external: !!external,
        display, background: Array.from(values.slice(29,32)) as RGB, timings });
    } else {
      const records = core.checker(request.view), patches: Patch[] = [];
      for (let i=0;i<18;i++) {
        const record = records.slice(i*7,i*7+7);
        patches.push({ code: Array.from(record.slice(0,3)), display: Array.from(record.slice(3,6)) as RGB });
      }
      timings.evaluateMs = performance.now() - evaluated;
      reply({ ...request, type: 'checker-colors', patches, timings });
    }
  } catch (error) { reply({ type: 'error', id: request.id, message: String(error) }); }
};
