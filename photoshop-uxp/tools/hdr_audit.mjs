// Buck2 supplies pinned Node, Python, the shipping bundle and the official OCIO config.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readPng } from '../tests/png_reader.mjs';

const [plugin, output] = process.argv.slice(2);
const api = await import(pathToFileURL(path.join(plugin, 'test-api.mjs')));
const core = await api.ColorCore.create();
const manifest = JSON.parse(await fs.readFile(path.join(plugin, 'plugin/manifest.json'), 'utf8'));
const oracle = JSON.parse(execFileSync(process.env.EXT_PYTHON,
  [path.join(process.env.EXT_ROOT, 'references/hdr_display_oracle.py')], { maxBuffer: 2e6 }));
// Independent inverse ST 2084; neither the production encoder nor OCIO is used here.
const nitsFromPq = value => {
  const p = Math.max(0, value) ** (32 / 2523);
  return 10000 * (Math.max(0, p - 3424 / 4096) / (2413 / 128 - (2392 / 128) * p)) ** (16384 / 2610);
};
const nits = [0, 18, 50, 100, 203, 500, 1000];
const width = 420, height = 64;
const reference = [], scenes = [], selections = [], fixtures = {};
for (const record of oracle.records) {
  const view = record.viewId;
  const rgb = new Float32Array(width * height * 3), rgba = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = nits[Math.floor(x / 60)] / 100, index = y * width + x;
    rgb.set([value, value, value], index * 3); rgba.set([value, value, value, 1], index * 4);
  }
  fixtures[view] = {};
  for (const [kind, bytes] of [['rgb', api.encodeLinearRgbPng(view, width, height, rgb)],
    ['rgba', api.encodeLinearRgbaPng(view, width, height, rgba)]]) {
    const png = readPng(bytes);
    assert.equal(png.depth, 16);
    assert.deepEqual([...png.chunks.get('cICP')], [view === 0 ? 9 : 12, 16, 0, 1]);
    assert.equal(png.icc, undefined);
    const samples = nits.map((expectedNits, i) => {
      const code = png.pixel(i * 60 + 30, 32)[0] / 65535, decodedNits = nitsFromPq(code);
      assert.ok(Math.abs(decodedNits - expectedNits) < .1);
      if (kind === 'rgba') assert.equal(png.alpha(i * 60 + 30, 32), 65535);
      return { expectedNits, code, decodedNits };
    });
    const name = 'reference-' + view + '-' + kind + '.png';
    await fs.writeFile(path.join(output, name), bytes);
    fixtures[view][kind] = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
    reference.push({ view, kind, depth: png.depth, cICP: [...png.chunks.get('cICP')], samples });
  }
  for (const [i, scene] of record.scene.entries()) {
    const linear = [...core.view(view, scene)];
    const encoded = readPng(api.encodeLinearRgbPng(view, 1, 1, linear)).pixel(0, 0).map(c => c / 65535);
    const expected = record.pq[i], error = Math.max(...encoded.map((c, channel) => Math.abs(c - expected[channel])));
    assert.ok(error < 2e-5, JSON.stringify({ view, scene, error }));
    scenes.push({ view, scene, linear, pngNits: encoded.map(nitsFromPq), ocioPq: expected, pngPq: encoded, maxPqError: error });
  }
  for (const j of [.15, 100 / 217.2768649129496, .7, .9, 1]) {
    const values = core.evaluate(view, [j, .5, .5], true), linear = [...values.slice(26, 29)];
    const bytes = api.encodePreview(view, linear, [...values.slice(29, 32)], values[0] === 1), png = readPng(bytes);
    const pngNits = png.pixel(128, 128).map(c => nitsFromPq(c / 65535));
    if (view === 0 && (j === 1 || j === 100 / 217.2768649129496)) {
      const expectedNits = j === 1 ? 1000 : 203;
      assert.ok(pngNits.every(n => Math.abs(n - expectedNits) < .1));
    }
    selections.push({ view, j, valid: values[0], scene: [...values.slice(1, 4)], linear, pngNits });
    await fs.writeFile(path.join(output, 'neutral-' + view + '-' + j + '.png'), bytes);
  }
}
const report = { extension: manifest.version, node: process.version, ocio: oracle.ocio, config: oracle.config,
  unitNits: 100, authoringWhiteNits: 203, authoringToOcioScale: 2.03, pngEncoderMultiplier: 1,
  maxPqError: Math.max(...scenes.map(s => s.maxPqError)),
  reference, scenes, selections, physicalHdrVerified: false };
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');

// This script runs manually in the embedded WebView inspector. It changes only
// the two image sources/styles, and provides restoration; no host messages/writes.
const inspect = function (fixtures) {
  window.modcam16HdrProbe?.restore();
  const images = ['slice', 'preview'].map(id => document.getElementById(id)).filter(Boolean);
  if (!images.length) throw Error('Run in the picker WebView inspector, not the native UXP console.');
  const saved = images.map(image => ({ image, src: image.getAttribute('src'), range: image.style.getPropertyValue('dynamic-range-limit') }));
  const layout = document.getElementById('interface'), transform = layout?.style.transform;
  const ancestors = images.map(image => {
    const chain = [];
    for (let node = image; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      chain.push({ id: node.id, tag: node.tagName, transform: style.transform, opacity: style.opacity,
        filter: style.filter, dynamicRangeLimit: style.getPropertyValue('dynamic-range-limit') });
    }
    return chain;
  });
  const report = { userAgent: navigator.userAgent, dynamicRangeHigh: matchMedia('(dynamic-range: high)').matches,
    p3: matchMedia('(color-gamut: p3)').matches, rec2020: matchMedia('(color-gamut: rec2020)').matches,
    cssNoLimit: CSS.supports('dynamic-range-limit', 'no-limit'), cssHigh: CSS.supports('dynamic-range-limit', 'high'),
    ancestors, physicalHdrVerified: false, patchNitsLeftToRight: [0, 18, 50, 100, 203, 500, 1000] };
  const probe = window.modcam16HdrProbe = {
    report,
    show(view = 0) { for (const image of images) image.src = fixtures[view][image.id === 'slice' ? 'rgba' : 'rgb']; },
    limit(value) { for (const image of images) image.style.setProperty('dynamic-range-limit', value); },
    unscaled() { if (layout) layout.style.transform = 'none'; },
    restore() {
      for (const { image, src, range } of saved) if (image.isConnected) {
        if (src === null) image.removeAttribute('src'); else image.setAttribute('src', src);
        if (range) image.style.setProperty('dynamic-range-limit', range); else image.style.removeProperty('dynamic-range-limit');
      }
      if (layout) layout.style.transform = transform;
      delete window.modcam16HdrProbe;
    },
  };
  probe.show(); console.log('modcam16 HDR probe:', report);
  return report;
};
await fs.writeFile(path.join(output, 'panel-inspector.js'), '(' + inspect.toString() + ')(' + JSON.stringify(fixtures) + ');\n');
const rows = [0, 2].flatMap(view => ['rgb', 'rgba'].map(kind => '<h2>' + (view === 0 ? 'Rec.2020' : 'P3-D65') + ' ' + kind.toUpperCase() + '</h2><div class="labels">' + nits.map(n => '<span>' + n + ' nits</span>').join('') + '</div><img width="420" height="64" src="' + fixtures[view][kind] + '" alt="PQ reference patches">')).join('\n');
const html = '<!doctype html><meta charset="utf-8"><title>modcam16 PQ display probe</title><style>body{background:#222;color:#ddd;font:14px system-ui;margin:24px}h2{font-size:15px}.labels{display:flex;width:420px}.labels span{width:60px;text-align:center;font-size:10px}img{display:block;dynamic-range-limit:no-limit;margin-bottom:12px}.white{background:white;width:120px;height:48px}pre{white-space:pre-wrap}button{margin:8px}</style><h1>PQ display probe</h1><p>Exact PNG samples: 0, 18, 50, 100, 203, 500 and 1000 nits. Decode success and media queries do not prove physical HDR. Compare the same data in Safari and the plugin WebView on the same display.</p><div class="white"></div><p>CSS white above is an SDR UI reference, with brightness determined by the display/browser.</p><button id="hdr">HDR allowed</button><button id="sdr">Standard range</button>' + rows + '<pre id="info"></pre><script>const images=[...document.images];document.getElementById("hdr").onclick=()=>images.forEach(i=>i.style.setProperty("dynamic-range-limit",CSS.supports("dynamic-range-limit","no-limit")?"no-limit":"high"));document.getElementById("sdr").onclick=()=>images.forEach(i=>i.style.setProperty("dynamic-range-limit","standard"));document.getElementById("info").textContent=JSON.stringify({userAgent:navigator.userAgent,dynamicRangeHigh:matchMedia("(dynamic-range: high)").matches,cssNoLimit:CSS.supports("dynamic-range-limit","no-limit"),cssHigh:CSS.supports("dynamic-range-limit","high"),physicalHdrVerified:false},null,2);</script>';
await fs.writeFile(path.join(output, 'probe.html'), html);
console.log(JSON.stringify({ extension: report.extension, unitNits: report.unitNits, pngEncoderMultiplier: report.pngEncoderMultiplier,
  maxPqError: report.maxPqError, neutralAtJ1Nits: selections.filter(s => s.j === 1).map(s => ({ view: s.view, nits: s.pngNits })),
  output, physicalHdrVerified: false }, null, 2));
