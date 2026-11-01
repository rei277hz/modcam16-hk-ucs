import { wasmBase64 } from './wasm_bytes';
import type { RGB, View } from '../host/protocol';
type Exports = Record<string, any> & { memory: WebAssembly.Memory; result_len(): number };
export class ColorCore {
  constructor(private exports: Exports) {}
  static async create() {
    const bytes = Uint8Array.from(atob(wasmBase64), v => v.charCodeAt(0));
    const result = await WebAssembly.instantiate(bytes, {});
    return new ColorCore(result.instance.exports as Exports);
  }
  private call(name: string, ...args: number[]) {
    const pointer = this.exports[name](...args);
    return new Float64Array(this.exports.memory.buffer, pointer, this.exports.result_len()).slice();
  }
  evaluate(view: View, code: number[], full: boolean) { return this.call('evaluate', view, ...code, +full); }
  import(scene: RGB, full: boolean) { return this.call('import_scene', ...scene, +full); }
  view(view: View, scene: ArrayLike<number>) { return this.call('scene_view', view, scene[0], scene[1], scene[2]); }
  parameters() { return Float32Array.from(this.call('parameters')); }
  checker(view: View) { return this.call('checker', view); }
  slice(view: View, j: number, width: number, height: number, start: number, end: number, full: boolean) {
    return Float32Array.from(this.call('slice', view, j, width, height, start, end, +full));
  }
}
