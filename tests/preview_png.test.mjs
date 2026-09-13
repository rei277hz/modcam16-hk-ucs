import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { initSync, picker_evaluate, picker_colorchecker, picker_from_encoded } from "../src/wasm/pkg/modcam16_color_core.js";
import { encodeLinearRgbaPng, encodePreview, encodePq, displayIcc } from "../src/preview_png.ts";
import { J_HK_PEAK, J_REFERENCE_WHITE } from "../src/picker_math.ts";
import { readPng } from "./png_reader.mjs";

initSync({ module: new WebAssembly.Module(readFileSync(new URL("../src/wasm/pkg/modcam16_color_core_bg.wasm", import.meta.url))) });
const oracle = JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["tests/ocio_oracle.py"], { encoding: "utf8" })).picker;
const close = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);
function expectedSample(value, hdr) {
  if (hdr) {
    const linear = Math.max(0, Math.min(10, value)) / 100;
    const p = linear ** (2610 / 16384);
    return Math.round(65535 * ((3424 / 4096 + 2413 / 128 * p) / (1 + 2392 / 128 * p)) ** (2523 / 32));
  }
  const linear = Math.max(0, Math.min(1, value));
  return Math.round(255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055));
}

test("physical white scale is independently derived with the 203-nit appearance context", () => {
  close(J_HK_PEAK, oracle.peak_jhk, 1e-9, "1000-nit JHK");
  close(J_REFERENCE_WHITE, oracle.reference_j, 1e-12, "100-nit locator");
  close(encodePq(100), 0.5080784215, 1e-10, "ST2084 100 nits");
  close(encodePq(1000), 0.7518270962, 1e-10, "ST2084 1000 nits");
});

test("fixed authoring inverse and all forward views agree with Python OpenColorIO", () => {
  for (const [index, code] of oracle.codes.entries()) {
    const canonical = picker_evaluate(2, ...code, .15);
    for (const view of [1, 4, 2, 0]) {
      const values = picker_evaluate(view, ...code, .15);
      assert.equal(values[0], 1, `valid code ${code}`);
      assert.deepEqual(values.slice(0, 26), canonical.slice(0, 26));
      for (let c = 0; c < 3; c++) {
        close(values[23 + c], oracle.source_p3[index][c], 1e-8, `source ${index}/${c}`);
        // At the 1000-nit endpoint the inverse shoulder is ill-conditioned:
        // OCIO float32 RGB/XYZ rounding amplifies into ~3.5e-5 relative AP1.
        const sceneTolerance = code[0] === 1 ? 1e-4 : 3e-5;
        close(values[1 + c], oracle.scene[index][c], sceneTolerance * Math.max(1, Math.abs(oracle.scene[index][c])), `scene ${index}/${c}`);
        close(values[26 + c], oracle.views[view].rgb[index][c], 8e-5, `view ${view}/${index}/${c}`);
      }
    }
  }
});

test("PNG formats, metadata, and pixel samples match independent OCIO presentation values", () => {
  for (const view of [1, 4, 2, 0]) {
    const hdr = view === 0 || view === 2;
    for (const [index, code] of oracle.codes.entries()) {
      const values = picker_evaluate(view, ...code, 1);
      const png = readPng(encodePreview(view, values.slice(26, 29), values.slice(29, 32)));
      assert.deepEqual([png.width, png.height, png.depth], [256, 256, hdr ? 16 : 8]);
      assert.deepEqual([...png.chunks.get("cICP")], [view === 0 ? 9 : view === 1 ? 1 : 12, hdr ? 16 : 13, 0, 1]);
      assert.equal(!!png.icc, !hdr);
      if (png.icc) assert.deepEqual(png.icc, Buffer.from(displayIcc(view === 1 ? "srgb" : "p3")));
      const fg = png.pixel(128, 128), bg = png.pixel(0, 0);
      for (let c = 0; c < 3; c++) {
        close(fg[c], expectedSample(oracle.views[view].rgb[index][c], hdr), 2, `PNG foreground ${view}/${index}/${c}`);
        close(bg[c], expectedSample(oracle.views[view].background_rgb[3][c], hdr), 2, `PNG surround ${view}/${index}/${c}`);
      }
      assert.deepEqual(png.pixel(34, 128), bg);
      assert.deepEqual(png.pixel(35, 128), fg);
      assert.deepEqual(png.pixel(220, 128), fg);
      assert.deepEqual(png.pixel(221, 128), bg);
    }
  }
});

test("RGBA slice encoding preserves selected-view metadata and linear alpha", () => {
  for (const view of [1, 4, 2, 0]) {
    const hdr = view === 0 || view === 2;
    const png = readPng(encodeLinearRgbaPng(view, 2, 1, new Float32Array([
      .18, .25, .5, 1,
      .8, .4, .2, 0,
    ])));
    assert.deepEqual([png.width, png.height, png.depth, png.colorType], [2, 1, hdr ? 16 : 8, 6]);
    assert.equal(png.alpha(0, 0), hdr ? 65535 : 255);
    assert.equal(png.alpha(1, 0), 0);
    assert.deepEqual([...png.chunks.get("cICP")], [view === 0 ? 9 : view === 1 ? 1 : 12, hdr ? 16 : 13, 0, 1]);
    assert.equal(!!png.icc, !hdr);
  }
});

test("background uses normalized surround J' and shares the fixed source path", () => {
  for (const view of [1, 4, 2, 0]) {
    oracle.backgrounds.forEach((background, index) => {
      const values = picker_evaluate(view, .3, .5, .5, background);
      for (let c = 0; c < 3; c++) close(values[29 + c], oracle.views[view].background_rgb[index][c], 8e-5, `background ${view}/${index}/${c}`);
      assert.equal(values[32], 0);
    });
    const j = .42, marker = picker_evaluate(view, j, .5, .5, 0)[19];
    const values = picker_evaluate(view, j, .5, .5, j);
    const png = readPng(encodePreview(view, values.slice(26, 29), values.slice(29, 32)));
    assert.deepEqual(png.pixel(128, 128), png.pixel(0, 0));
  }
});

test("ColorChecker anchors and encoded AP1 imports round trip in canonical source space", () => {
  const patches = picker_colorchecker();
  assert.equal(patches.length, 180);
  for (let i = 0; i < 18; i++) {
    const code = patches.slice(i * 10, i * 10 + 3);
    const picked = picker_evaluate(2, ...code, 0);
    assert.equal(picked[0], 1);
    const imported = picker_from_encoded(...picked.slice(10, 13));
    assert.equal(imported[0], 1);
    for (let c = 0; c < 3; c++) close(imported[1 + c], code[c], 3e-5, `patch ${i} coordinate ${c}`);
  }
});

test("invalid pick PNG carries a diagnostic cross, without making a clipped scene color", () => {
  const values = picker_evaluate(2, .5, 0, 0, .15);
  assert.equal(values[0], 0);
  assert.ok(values.slice(1, 4).every(Number.isNaN));
  const png = readPng(encodePreview(2, values.slice(26, 29), values.slice(29, 32), false));
  assert.ok(png.pixel(128, 128)[0] > png.pixel(128, 128)[1]);
});

test("embedded SDR ICC profiles are readable and colorimetrically valid in LittleCMS", () => {
  const result = JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["tests/icc_oracle.py"], {
    input: JSON.stringify({ srgb: Buffer.from(displayIcc("srgb")).toString("base64"), p3: Buffer.from(displayIcc("p3")).toString("base64") }), encoding: "utf8",
  }));
  assert.match(result.srgb.name, /sRGB/);
  assert.match(result.p3.name, /Display P3/);
  for (const space of ["srgb", "p3"]) for (let c = 0; c < 3; c++) close(result[space].actual[c], result[space].expected[c], 2, `${space} LittleCMS ${c}`);
});
