import { fragmentShader } from './glsl_source';
import { deviceInfo, type Timings } from './jobs';

export class SliceWebGlRenderer {
  info = deviceInfo('WebGL2');
  timings: Timings = {};
  private queries = new Map<WebGLQuery, ReturnType<typeof setTimeout>>();
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private data?: WebGLTexture;
  private canvas?: OffscreenCanvas;
  get available() { return typeof OffscreenCanvas !== 'undefined'; }
  private prepare(parameters: Float32Array) {
    if (this.program) return;
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float rendering unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.info = deviceInfo('WebGL2', debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : '',
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '');
    this.canvas = canvas; this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(String(error));
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      void main() { vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram()!;
    this.program = program;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(program)));
    const data = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, data);
    const height = Math.ceil(parameters.length / 4096), padded = new Float32Array(4096 * height);
    padded.set(parameters);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 4096, height, 0, gl.RED, gl.FLOAT, padded);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.canvas = canvas; this.gl = gl; this.program = program; this.data = data;
  }
  async render(parameters: Float32Array, view: number, j: number, width: number, height: number, full: boolean, onGpuTime?: (timings: Timings) => void) {
    const started = performance.now();
    this.prepare(parameters);
    this.timings = { prepareMs: performance.now()-started, gpuMs: null, gpuTimer: 'unavailable' };
    const gl = this.gl!, program = this.program!;
    if (gl.isContextLost()) throw new Error('WebGL context lost');
    const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float framebuffer incomplete');
      gl.viewport(0, 0, width, height); gl.useProgram(program);
      gl.disable(gl.DITHER); gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.data!);
      gl.uniform1i(gl.getUniformLocation(program, 'parameters'), 0);
      gl.uniform1ui(gl.getUniformLocation(program, 'profile'), view);
      gl.uniform1i(gl.getUniformLocation(program, 'fullRec2020'), +full);
      gl.uniform1f(gl.getUniformLocation(program, 'lightness'), j);
      gl.uniform2f(gl.getUniformLocation(program, 'size'), width, height);
      const ext = onGpuTime ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
      const query = ext ? gl.createQuery() : null;
      if (query) { gl.beginQuery(ext!.TIME_ELAPSED_EXT, query); this.timings.gpuTimer = 'pending'; }
      const submitStart = performance.now();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (query) gl.endQuery(ext!.TIME_ELAPSED_EXT);
      this.timings.submitMs = performance.now()-submitStart;
      const result = new Float32Array(width * height * 4);
      const readStart = performance.now();
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, result);
      this.timings.readbackWaitMs = performance.now()-readStart;
      if (query) {
        let attempts = 0;
        const poll = () => {
          const disjoint = gl.isContextLost() || gl.getParameter(ext!.GPU_DISJOINT_EXT);
          const available = !disjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
          if (disjoint || available || ++attempts >= 50) {
            const measured = { gpuMs: available ? Number(gl.getQueryParameter(query, gl.QUERY_RESULT))/1e6 : null,
              gpuTimer: available ? 'measured' : disjoint ? 'disjoint' : 'unavailable' };
            gl.deleteQuery(query); this.queries.delete(query); onGpuTime!(measured);
          } else this.queries.set(query,setTimeout(poll,10));
        };
        this.queries.set(query,setTimeout(poll,0));
      }
      if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('WebGL float readback failed');
      return result;
    } finally { gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); }
  }
  dispose() {
    for (const [query,timer] of this.queries) { clearTimeout(timer); this.gl?.deleteQuery(query); }
    this.queries.clear();
    this.gl?.deleteProgram(this.program!); this.gl?.deleteTexture(this.data!);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = undefined; this.program = undefined;
  }
}
