import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { readPng } from "./png_reader.mjs";

const CHROMIUM =
  process.env.CHROMIUM ?? "/home/rust/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

test(
  "desktop gamut slice supports live mouse tracking and second-click commit",
  { timeout: 60_000 },
  async (context) => {
    const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    context.after(async () => {
      await browser.close();
      await server.close();
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.querySelector("#plot-frame")?.dataset.colorcheckerRingCount === "18",
    );
    assert.equal(await page.locator('[data-image-zoom="2"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('[data-image-zoom="1"]').getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("body").evaluate(element => getComputedStyle(element).userSelect), "none");
    assert.equal(await page.locator("#j-number").evaluate(element => getComputedStyle(element).userSelect), "text");
    assert.equal(await page.locator("#plot-frame").getAttribute("data-indicator-patch-count"), "18");
    assert.ok(await page.locator("#gamut-indicators").evaluate(canvas => {
      const context = canvas.getContext("2d");
      if (!context) return false;
      const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < alpha.length; i += 4) if (alpha[i] !== 0) return true;
      return false;
    }), "ColorChecker indicators are painted before any picker movement");
    const desktopLayout = await page.evaluate(() => {
      const wheel = document.querySelector("#j-wheel").getBoundingClientRect();
      const slice = document.querySelector("#plot-frame").getBoundingClientRect();
      return {
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        viewport: [innerWidth, innerHeight],
        wheelRight: wheel.right,
        sliceLeft: slice.left,
      };
    });
    assert.deepEqual(desktopLayout.scroll, desktopLayout.viewport);
    assert.ok(desktopLayout.wheelRight <= desktopLayout.sliceLeft, JSON.stringify(desktopLayout));
    const slice = page.locator("#gamut-slice");
    const box = await slice.boundingBox();
    assert.ok(box);
    await slice.dispatchEvent("pointerdown", {
      pointerId: 90,
      pointerType: "mouse",
      button: 0,
      clientX: box.x + box.width * 0.2,
      clientY: box.y + box.height * 0.2,
    });
    await page.waitForFunction(
      () => document.querySelector(".plot-frame")?.dataset.sliceTracking === "active",
    );
    await page.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 90,
          pointerType: "mouse",
          clientX: 9999,
          clientY: 9999,
        }),
      );
    });
    await page.waitForFunction(
      () => Number(document.querySelector("#plot-frame")?.dataset.displayX) > 0.99 &&
        Number(document.querySelector("#plot-frame")?.dataset.displayY) < 0.01,
    );
    const live = await page.evaluate(() => ({
      state: document.querySelector(".plot-frame")?.dataset.sliceTracking,
      x: Number(document.querySelector("#plot-frame")?.dataset.displayX),
      y: Number(document.querySelector("#plot-frame")?.dataset.displayY),
    }));
    assert.equal(live.state, "active");
    assert.ok(live.x > 0.99 && live.y < 0.01);
    await page.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 91,
          pointerType: "mouse",
          button: 0,
          clientX: 500,
          clientY: 500,
        }),
      );
    });
    await page.waitForFunction(
      () => document.querySelector(".plot-frame")?.dataset.sliceTracking === "idle",
    );
    const committed = await page.evaluate(() => ({
      state: document.querySelector(".plot-frame")?.dataset.sliceTracking,
      x: Number(document.querySelector("#plot-frame")?.dataset.displayX),
      y: Number(document.querySelector("#plot-frame")?.dataset.displayY),
    }));
    await page.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 90,
          pointerType: "mouse",
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    await page.waitForTimeout(100);
    assert.deepEqual(
      await page.evaluate(() => ({
        state: document.querySelector(".plot-frame")?.dataset.sliceTracking,
        x: Number(document.querySelector("#plot-frame")?.dataset.displayX),
        y: Number(document.querySelector("#plot-frame")?.dataset.displayY),
      })),
      committed,
    );
  },
);

test(
  "narrow DPR-3 layout fits the 360x645 viewport without scrolling",
  { timeout: 60_000 },
  async (context) => {
    const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    context.after(async () => {
      await browser.close();
      await server.close();
    });
    const page = await browser.newPage({ viewport: { width: 360, height: 645 }, deviceScaleFactor: 3 });
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.querySelector("#plot-frame")?.dataset.colorcheckerRingCount === "18",
    );
    const metrics = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      shellBottom: document.querySelector(".app-shell").getBoundingClientRect().bottom,
      layerBounds: ["#gamut-checkerboard", "#gamut-slice", "#gamut-indicators"].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [rect.left, rect.top, rect.width, rect.height];
      }),
      canvasBacking: ["#gamut-checkerboard", "#gamut-indicators"].map(selector => {
        const canvas = document.querySelector(selector);
        return [canvas.width, canvas.height];
      }),
      wheel: (() => { const r = document.querySelector("#j-wheel").getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; })(),
      slice: (() => { const r = document.querySelector("#plot-frame").getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; })(),
      required: ["#gamut-slice", "#preview", "#linear-value", "#view-menu", "#j-wheel", "#background-stick", ".app-footer"].every((selector) => !!document.querySelector(selector)),
      removed: ["#rolling-pad", "#rolling-ball"].every((selector) => !document.querySelector(selector)),
    }));
    assert.equal(metrics.dpr, 3);
    assert.equal(metrics.documentWidth, metrics.viewportWidth);
    assert.equal(metrics.documentHeight, metrics.viewportHeight);
    assert.ok(metrics.shellBottom <= metrics.viewportHeight + 1, JSON.stringify(metrics));
    assert.deepEqual(metrics.layerBounds[1], metrics.layerBounds[0]);
    assert.deepEqual(metrics.layerBounds[2], metrics.layerBounds[0]);
    assert.deepEqual(metrics.canvasBacking, [[512, 512], [512, 512]]);
    assert.equal(metrics.required, true);
    assert.equal(metrics.removed, true);
    assert.ok(metrics.wheel[1] <= metrics.slice[0], JSON.stringify(metrics));

    const slice = page.locator("#gamut-slice");
    const sliceBox = await slice.boundingBox();
    const point = { pointerId: 81, pointerType: "mouse", button: 0, clientX: sliceBox.x + sliceBox.width / 2, clientY: sliceBox.y + sliceBox.height / 2 };
    await slice.dispatchEvent("pointerdown", point);
    assert.equal(await page.locator("#plot-frame").getAttribute("data-slice-tracking"), "active");
    await slice.dispatchEvent("pointerdown", point);
    assert.equal(await page.locator("#plot-frame").getAttribute("data-slice-tracking"), "idle");
  },
);


async function openPicker(context, options = {}) {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath: CHROMIUM, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...options });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#preview-image")?.getAttribute("src")?.startsWith("blob:") && document.querySelector("#gamut-slice")?.getAttribute("src")?.startsWith("blob:") && document.querySelector("#gamut-slice")?.dataset.renderer && document.querySelector("#plot-frame")?.dataset.colorcheckerRingCount === "18");
  return { page, errors };
}
async function pickXY(page, x, y) {
  const slice = page.locator("#gamut-slice");
  const box = await slice.boundingBox();
  const event = { pointerId: 90, pointerType: "mouse", button: 0, clientX: box.x + box.width * x, clientY: box.y + box.height * (1 - y) };
  await slice.dispatchEvent("pointerdown", event);
  await slice.dispatchEvent("pointerdown", event);
}
async function setJ(page, j) {
  const wheel = page.locator("#j-wheel");
  await wheel.press("Home");
  for (let i = 0; i < Math.round(j / .01); i++) await wheel.press("ArrowUp");
}
async function setJNumber(page, j) {
  await page.locator("#j-number").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, j);
}
async function chooseView(page, view) {
  await page.locator("#preview").click();
  await page.locator(`#view-menu [data-view="${view}"]`).click();
  await page.waitForFunction(view => document.querySelector("#preview").dataset.view === String(view), view);
}
async function settledImage(page) {
  await page.waitForFunction(() => {
    const frame = document.querySelector("#plot-frame");
    const imageCode = JSON.parse(document.querySelector("#preview").dataset.imageCode ?? "[]");
    const background = Number.parseFloat(document.querySelector("#background-stick").style.bottom) / 100;
    return imageCode.length === 4 && Math.abs(imageCode[0] - Number(frame.dataset.displayJ)) < 1e-6 && Math.abs(imageCode[1] - Number(frame.dataset.displayX)) < 1e-6 && Math.abs(imageCode[2] - Number(frame.dataset.displayY)) < 1e-6 && Math.abs(imageCode[3] - background) < 1e-3;
  });
}
async function currentPng(page) {
  return readPng(await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector("#preview-image").src)).arrayBuffer())]));
}
async function currentSlicePng(page) {
  return readPng(await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector("#gamut-slice").src)).arrayBuffer())]));
}
async function elementPng(page, selector) {
  return readPng(await page.evaluate(async selector => [...new Uint8Array(await (await fetch(document.querySelector(selector).src)).arrayBuffer())], selector));
}

test("gamut viewport keeps fixed canvas layers around an RGBA slice PNG", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  const layers = await page.evaluate(() => {
    const selectors = ["#gamut-checkerboard", "#gamut-slice", "#gamut-indicators"];
    const boxes = selectors.map(selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return { selector, tag: element.tagName, width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const checker = document.querySelector("#gamut-checkerboard");
    const overlay = document.querySelector("#gamut-indicators");
    const checkerPixels = checker.getContext("2d").getImageData(0, 0, checker.width, checker.height).data;
    const overlayPixels = overlay.getContext("2d").getImageData(0, 0, overlay.width, overlay.height).data;
    return {
      boxes,
      backing: selectors.map(selector => {
        const element = document.querySelector(selector);
        return [selector, element instanceof HTMLImageElement ? element.naturalWidth : element.width, element instanceof HTMLImageElement ? element.naturalHeight : element.height];
      }),
      checkerInk: Array.from(checkerPixels).some((value, index) => index % 4 !== 3 && value !== 0),
      overlayInk: Array.from(overlayPixels).some((value, index) => index % 4 === 3 && value !== 0),
      order: Array.from(document.querySelector(".plot-frame").children).map(element => element.id),
    };
  });
  assert.deepEqual(layers.order.slice(0, 3), ["gamut-checkerboard", "gamut-slice", "gamut-indicators"]);
  assert.deepEqual(layers.backing, [["#gamut-checkerboard", 512, 512], ["#gamut-slice", 512, 512], ["#gamut-indicators", 512, 512]]);
  for (const box of layers.boxes) {
    assert.ok(Math.abs(box.width - layers.boxes[0].width) < 0.01, `${box.selector} width`);
    assert.ok(Math.abs(box.height - layers.boxes[0].height) < 0.01, `${box.selector} height`);
    assert.ok(Math.abs(box.left - layers.boxes[0].left) < 0.01, `${box.selector} left`);
    assert.ok(Math.abs(box.top - layers.boxes[0].top) < 0.01, `${box.selector} top`);
  }
  assert.equal(layers.checkerInk, true);
  assert.equal(layers.overlayInk, true);

  const slice = await currentSlicePng(page);
  assert.equal(slice.colorType, 6);
  assert.equal(slice.width, 512);
  assert.equal(slice.height, 512);
  const alphaSamples = [];
  for (let y = 0; y < slice.height; y += 32) {
    for (let x = 0; x < slice.width; x += 32) alphaSamples.push(slice.alpha(x, y));
  }
  assert.ok(alphaSamples.some(alpha => alpha === 0), "invalid slice samples are transparent");
  assert.ok(alphaSamples.some(alpha => alpha > 0), "valid slice samples are opaque");

  const before = await page.locator("#gamut-slice").getAttribute("src");
  await pickXY(page, .23, .71);
  await page.waitForFunction(() => Number(document.querySelector("#plot-frame").dataset.displayX) !== .38);
  assert.equal(await page.locator("#gamut-slice").getAttribute("src"), before, "X/Y only repaints the overlay");

  const renderer = await page.locator("#gamut-slice").getAttribute("data-renderer");
  const wheel = page.locator("#j-wheel"), wheelBox = await wheel.boundingBox();
  const centerX = wheelBox.x + wheelBox.width / 2, centerY = wheelBox.y + wheelBox.height / 2;
  await page.evaluate(({ centerX, centerY }) => {
    const wheel = document.querySelector("#j-wheel");
    wheel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 71, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY }));
    window.__rapidJRunning = true;
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      wheel.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 71, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY + Math.sin(tick * .55) * 9 }));
      if (tick >= 180) {
        clearInterval(timer);
        window.__rapidJRunning = false;
      }
    }, 10);
  }, { centerX, centerY });
  await page.waitForFunction(src => document.querySelector("#gamut-slice").getAttribute("src") !== src && window.__rapidJRunning, before);
  await page.waitForFunction(() => !window.__rapidJRunning);
  const transientSource = await page.locator("#gamut-slice").getAttribute("src");
  const transient = await currentSlicePng(page);
  assert.equal(transient.width, renderer === "webgpu" ? 512 : 64);
  assert.equal(transient.height, renderer === "webgpu" ? 512 : 64);
  assert.deepEqual(await page.evaluate(() => [
    document.querySelector("#gamut-checkerboard").width,
    document.querySelector("#gamut-checkerboard").height,
    document.querySelector("#gamut-indicators").width,
    document.querySelector("#gamut-indicators").height,
  ]), [512, 512, 512, 512]);
  await wheel.dispatchEvent("pointerup", { pointerId: 71, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - 20 });
  if (renderer === "wasm") {
    await page.waitForFunction(() => {
      const image = document.querySelector("#gamut-slice");
      const code = JSON.parse(image.dataset.imageCode ?? "[]");
      return image.naturalWidth === 512 && Math.abs(code[0] - Number(document.querySelector("#plot-frame").dataset.displayJ)) < 1e-6;
    });
    assert.equal((await currentSlicePng(page)).width, 512);
  }
  assert.deepEqual(errors, []);
});

test("wheel, direct slice gestures, and canonical snap display/calculation stay synchronized", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  assert.equal(await page.locator("#profile, .profile-row, #rolling-snap").count(), 0);
  assert.equal(await page.locator("#rolling-value, .rolling-value").count(), 0);
  assert.equal(await page.locator(".j-wheel-ticks span").count(), 11);
  assert.deepEqual(await page.locator("#view-menu [data-view]").evaluateAll(buttons => buttons.map(b => [b.dataset.view, b.disabled])), [["1", false], ["4", false], ["2", false], ["0", false]]);
  assert.equal(await page.locator("#background-stick").getAttribute("aria-hidden"), "true");
  const initialGeometry = await page.evaluate(() => {
    const rect = selector => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    return {
      control: rect(".j-wheel-control"), wheel: rect("#j-wheel"),
      ruler: rect(".j-ruler"), number: rect("#j-number"), slice: rect("#plot-frame"),
      preview: rect(".preview"), details: rect(".preview-details"),
      name: rect("#colorchecker-name"),
      nameVisibility: getComputedStyle(document.querySelector("#colorchecker-name")).visibility,
    };
  });
  assert.ok(Math.abs(initialGeometry.control.top - initialGeometry.slice.top) < .01);
  assert.ok(Math.abs(initialGeometry.control.bottom - initialGeometry.slice.bottom) < .01);
  assert.ok(initialGeometry.wheel.right <= initialGeometry.ruler.left);
  assert.ok(initialGeometry.ruler.right <= initialGeometry.slice.left);
  assert.ok(initialGeometry.number.bottom <= initialGeometry.control.bottom + .01);
  assert.ok(Math.abs(initialGeometry.preview.width - initialGeometry.preview.height) < .01);
  assert.ok(Math.abs(initialGeometry.preview.height - initialGeometry.details.height) < .01);
  assert.ok(initialGeometry.name.height >= 14);
  assert.equal(initialGeometry.nameVisibility, "hidden");

  const patch = await page.evaluate(async () => {
    const wasm = await import("/src/wasm/pkg/modcam16_color_core.js");
    await wasm.default();
    return [...wasm.picker_colorchecker().slice(70, 73)];
  });
  await pickXY(page, patch[1] + .002, patch[2] + .002);
  await setJ(page, patch[0]);
  await settledImage(page);
  const snapped = await page.locator("#plot-frame").evaluate(frame => ({ ...frame.dataset }));
  assert.equal(snapped.snapTarget, "patch:7");
  assert.equal(snapped.jSnapTarget, "patch");
  assert.ok(Math.abs(Number(snapped.displayJ) - patch[0]) < 1e-6);
  assert.ok(Math.abs(Number(snapped.displayX) - patch[1]) < 1e-6);
  assert.ok(Math.abs(Number(snapped.displayY) - patch[2]) < 1e-6);
  assert.notEqual(snapped.realX, snapped.displayX);
  assert.equal(await page.textContent("#colorchecker-name"), "Purplish Blue");
  assert.equal(await page.locator("#colorchecker-name").evaluate(element => getComputedStyle(element).visibility), "visible");
  assert.equal(await page.locator("#j-stick").isVisible(), true);
  assert.equal(await page.locator("#j-wheel").getAttribute("aria-valuenow"), String(patch[0]));
  const scene = await page.textContent("#linear-value");
  assert.equal(await page.locator("#gamut-slice").evaluate(element => element.tagName), "IMG");
  let sliceSource = await page.locator("#gamut-slice").getAttribute("src");
  for (const view of [4, 2, 0, 1]) {
    await chooseView(page, view);
    assert.deepEqual(await page.locator("#plot-frame").evaluate(frame => ({ ...frame.dataset })), snapped);
    assert.equal(await page.textContent("#linear-value"), scene);
    await page.waitForFunction(expected => document.querySelector("#gamut-slice").dataset.view === String(expected), view);
    const nextSource = await page.locator("#gamut-slice").getAttribute("src");
    assert.notEqual(nextSource, sliceSource);
    sliceSource = nextSource;
    assert.equal((await currentSlicePng(page)).depth, view === 0 || view === 2 ? 16 : 8);
    assert.equal((await currentPng(page)).depth, view === 0 || view === 2 ? 16 : 8);
    assert.equal(await page.locator(".visuals").evaluate(element => element.scrollLeft), 0);
  }

  // Snapping is a projection: leaving its band updates both numbers and ACEScg.
  const frame = page.locator("#plot-frame");
  const frameBox = await frame.boundingBox();
  const centerX = frameBox.x + frameBox.width / 2;
  const centerY = frameBox.y + frameBox.height / 2;
  await frame.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: centerX, clientY: centerY });
  await frame.dispatchEvent("pointermove", { pointerId: 7, pointerType: "touch", clientX: centerX + frameBox.width * .08, clientY: centerY });
  await frame.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: centerX + frameBox.width * .08, clientY: centerY });
  await settledImage(page);
  assert.notEqual(await page.textContent("#linear-value"), scene);
  const escaped = await frame.evaluate(element => ({ ...element.dataset }));
  assert.equal(escaped.realX, escaped.displayX);
  assert.ok(Number(escaped.displayX) > patch[1] + .005);

  await pickXY(page, .5, .5);
  await settledImage(page);
  assert.match(await frame.getAttribute("aria-label"), /x' 0\.500000, y' 0\.500000/);
  assert.equal(await page.locator("#j-stick").isVisible(), false);
  const referenceJ = await page.locator("#j-reference-tick").evaluate(tick => Number.parseFloat(tick.style.bottom) / 100);
  await setJ(page, referenceJ + .003);
  await settledImage(page);
  assert.ok(Math.abs(Number(await page.locator("#j-wheel").getAttribute("aria-valuenow")) - referenceJ) < 1e-6);
  await page.locator("#j-wheel").press("ArrowUp");
  await settledImage(page);
  const releasedJ = await frame.evaluate(element => ({ real: element.dataset.realJ, display: element.dataset.displayJ }));
  assert.equal(releasedJ.real, releasedJ.display);

  // Neutral foreground and its snapped surround must be the same PNG samples.
  // The preview drag controls Background J'.  Keep the foreground at the
  // default surround here so the view-switch comparison remains neutral
  // without relying on the removed range input.
  await setJ(page, .15);
  await settledImage(page);
  for (const view of [1, 4, 2, 0]) {
    await chooseView(page, view);
    // Background J' is now controlled by vertical preview dragging.  The
    // default surround remains intentionally independent of foreground J'.
    await settledImage(page);
    const png = await currentPng(page);
    assert.deepEqual(png.pixel(0, 0), png.pixel(128, 128));
  }

  const beforeTouch = Number(await frame.getAttribute("data-real-x"));
  await frame.dispatchEvent("pointerdown", { pointerId: 8, pointerType: "touch", clientX: centerX, clientY: centerY });
  assert.equal(Number(await frame.getAttribute("data-real-x")), beforeTouch, "touch contact does not jump");
  await frame.dispatchEvent("pointermove", { pointerId: 8, pointerType: "touch", clientX: centerX + frameBox.width / 4, clientY: centerY });
  assert.ok(Number(await frame.getAttribute("data-real-x")) > beforeTouch + .07, "fast slice movement accelerates beyond quarter speed");
  await frame.dispatchEvent("pointerup", { pointerId: 8, pointerType: "touch", clientX: centerX + frameBox.width / 4, clientY: centerY });
  assert.equal(await frame.getAttribute("data-slice-tracking"), "idle");
  assert.deepEqual(errors, []);
});

test("J wheel is direct, persistent, clamped, and snaps through a separate real value", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  assert.equal(await page.locator("#background-stick").evaluate(element => getComputedStyle(element).borderLeftColor), "rgb(255, 255, 255)");
  assert.equal(await page.locator("#background-stick").evaluate(element => getComputedStyle(element, "::after").borderLeftColor), "rgb(23, 26, 32)");
  await pickXY(page, .5, .5);
  const wheel = page.locator("#j-wheel");
  const frame = page.locator("#plot-frame");
  const box = await wheel.boundingBox();
  assert.ok(box);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const realJ = () => frame.evaluate(element => Number(element.dataset.realJ));
  const displayJ = () => frame.evaluate(element => Number(element.dataset.displayJ));
  const visualOffset = () => wheel.evaluate(element => Number(element.dataset.visualOffset));

  await setJNumber(page, .5);
  const startingOffset = await visualOffset();
  await wheel.dispatchEvent("pointerdown", { pointerId: 201, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY });
  await wheel.dispatchEvent("pointermove", { pointerId: 201, pointerType: "touch", button: 0, clientX: centerX + 100, clientY: centerY - box.height * .2 });
  assert.ok(await realJ() > .55, "fast movement applies acceleration beyond the base quarter-speed delta");
  const fastOffset = await visualOffset();
  assert.ok(Math.abs((fastOffset - startingOffset) + box.height * .2) < .01);
  await wheel.dispatchEvent("pointerup", { pointerId: 201, pointerType: "touch", button: 0, clientX: centerX + 100, clientY: centerY - box.height * .2 });
  assert.equal(await visualOffset(), fastOffset, "wheel texture stays where it was released");

  await setJNumber(page, .5);
  await wheel.dispatchEvent("pointerdown", { pointerId: 202, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY });
  for (let step = 1; step <= 4; step++) {
    await wheel.dispatchEvent("pointermove", { pointerId: 202, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - box.height * .05 * step });
  }
  assert.ok(await realJ() > .55, "rapid event samples retain accelerated value movement");
  await wheel.dispatchEvent("pointerup", { pointerId: 202, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - box.height * .2 });

  await setJNumber(page, .5);
  const horizontalOffset = await visualOffset();
  await wheel.dispatchEvent("pointerdown", { pointerId: 203, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY });
  await wheel.dispatchEvent("pointermove", { pointerId: 203, pointerType: "touch", button: 0, clientX: centerX + 500, clientY: centerY });
  assert.equal(await realJ(), .5, "horizontal travel has no J' effect");
  assert.equal(await visualOffset(), horizontalOffset);
  await wheel.dispatchEvent("pointerup", { pointerId: 203, pointerType: "touch", button: 0, clientX: centerX + 500, clientY: centerY });

  await setJNumber(page, .99);
  await wheel.dispatchEvent("pointerdown", { pointerId: 204, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY });
  await wheel.dispatchEvent("pointermove", { pointerId: 204, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - box.height });
  assert.equal(await realJ(), 1);
  const endpointOffset = await visualOffset();
  await wheel.dispatchEvent("pointermove", { pointerId: 204, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - box.height * 2 });
  assert.ok(Math.abs(Math.abs((await visualOffset()) - endpointOffset) - box.height) < .01, "texture keeps following the pointer at the endpoint");
  await wheel.dispatchEvent("pointermove", { pointerId: 204, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - box.height * 2 + 10 });
  assert.ok(await realJ() < 1, "reversing at an endpoint changes J' immediately");
  await wheel.dispatchEvent("pointerup", { pointerId: 204, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - box.height * 2 + 10 });

  const referenceJ = await page.locator("#j-reference-tick").evaluate(tick => Number.parseFloat(tick.style.bottom) / 100);
  await setJNumber(page, referenceJ + .003);
  assert.ok(Math.abs(await realJ() - (referenceJ + .003)) < 1e-6);
  assert.ok(Math.abs(await displayJ() - referenceJ) < 1e-6);
  assert.equal(await page.locator("#j-number").inputValue(), referenceJ.toFixed(3));
  const snappedOffset = await visualOffset();
  await wheel.dispatchEvent("pointerdown", { pointerId: 205, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY });
  await wheel.dispatchEvent("pointermove", { pointerId: 205, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - 1 });
  assert.ok(Math.abs(await displayJ() - referenceJ) < 1e-6, "display and calculation remain snapped");
  assert.ok(await realJ() > referenceJ + .003, "the hidden real value continues moving");
  assert.ok(Math.abs((await visualOffset()) - snappedOffset + 1) < .01, "wheel texture follows real J' while snapped");
  await wheel.dispatchEvent("pointermove", { pointerId: 205, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - 8 });
  assert.equal(await displayJ(), await realJ(), "real J' naturally escapes the snap band");
  await wheel.dispatchEvent("pointerup", { pointerId: 205, pointerType: "touch", button: 0, clientX: centerX, clientY: centerY - 8 });
  assert.match(await page.locator("#j-number").inputValue(), /^\d\.\d{3}$/);

  const beforeResize = { height: box.height, offset: await visualOffset() };
  await page.setViewportSize({ width: 1280, height: 700 });
  const resizedBox = await wheel.boundingBox();
  assert.ok(resizedBox);
  await page.waitForFunction(({ height, offset }) => {
    const wheel = document.querySelector("#j-wheel");
    const actualHeight = wheel.getBoundingClientRect().height;
    return actualHeight > 0 && Math.abs(offset / height - Number(wheel.dataset.visualOffset) / actualHeight) < 1e-5;
  }, beforeResize);
  assert.ok(Math.abs(beforeResize.offset / beforeResize.height - (await visualOffset()) / resizedBox.height) < 1e-5,
    "wheel position is reconstructed for the new wheel height");
  assert.deepEqual(errors, []);
});

test("preview retains decoded images, rejects stale work, and shows invalidity during a gesture", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.__decodes = 0;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.id !== "preview-image") return;
      const delay = window.__delayNextDecode ?? 0;
      window.__delayNextDecode = 0;
      window.__decodes++;
      if (window.__failNextDecode) { window.__failNextDecode = false; throw new Error("test decode failure"); }
      await new Promise(resolve => setTimeout(resolve, delay));
    };
    window.__delayNextDecode = 300;
  });
  const before = await page.locator("#preview-image").getAttribute("src");
  await page.locator("#j-wheel").press("ArrowUp");
  await page.waitForFunction(() => window.__decodes >= 1);
  assert.equal(await page.locator("#preview-image").getAttribute("src"), before);
  await page.locator("#j-wheel").press("ArrowUp");
  await page.waitForFunction(src => document.querySelector("#preview-image").src !== src, before);
  const latest = await page.locator("#preview-image").getAttribute("src");
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#preview-image").getAttribute("src"), latest);

  await page.evaluate(() => { window.__failNextDecode = true; });
  await page.locator("#j-wheel").press("ArrowUp");
  await page.waitForFunction(() => !document.querySelector("#preview-status").hidden);
  assert.equal(await page.locator("#preview-image").getAttribute("src"), latest);
  await page.locator("#j-wheel").press("ArrowUp");
  await page.waitForFunction(() => document.querySelector("#preview-status").hidden);

  // Background J' drags are admitted to the same live, coalesced preview
  // pipeline, so rapid movement advances the PNG before release.
  const preview = page.locator("#preview");
  const previewBox = await preview.boundingBox();
  assert.ok(previewBox);
  const beforeBackground = await preview.getAttribute("data-image-generation");
  await preview.dispatchEvent("pointerdown", {
    pointerId: 701, pointerType: "touch", button: 0,
    clientX: previewBox.x + previewBox.width / 2,
    clientY: previewBox.y + previewBox.height / 2,
  });
  await preview.dispatchEvent("pointermove", {
    pointerId: 701, pointerType: "touch", button: 0,
    clientX: previewBox.x + previewBox.width / 2,
    clientY: previewBox.y + previewBox.height * .35,
  });
  await page.waitForFunction(generation => document.querySelector("#preview").dataset.imageGeneration !== generation, beforeBackground);
  await preview.dispatchEvent("pointerup", {
    pointerId: 701, pointerType: "touch", button: 0,
    clientX: previewBox.x + previewBox.width / 2,
    clientY: previewBox.y + previewBox.height * .35,
  });

  // A captured touch drag has not released, and PNG decode is deliberately slow.
  await page.evaluate(() => { window.__delayNextDecode = 400; });
  const frame = page.locator("#plot-frame"), box = await frame.boundingBox();
  await frame.dispatchEvent("pointerdown", { pointerId: 99, pointerType: "touch", clientX: box.x, clientY: box.y });
  await frame.dispatchEvent("pointermove", { pointerId: 99, pointerType: "touch", clientX: box.x + box.width * 4, clientY: box.y + box.height * 4 });
  await page.waitForFunction(() => document.querySelector("#preview").classList.contains("preview-unavailable"));
  assert.equal(await page.textContent("#linear-value"), "Unavailable");
  assert.deepEqual(await page.locator("#preview").evaluate(element => ({
    imageVisibility: getComputedStyle(document.querySelector("#preview-image")).visibility,
    background: getComputedStyle(element).backgroundColor,
    immediateCross: getComputedStyle(element, "::before").content,
  })), { imageVisibility: "hidden", background: "rgb(0, 0, 0)", immediateCross: '""' });
  await frame.dispatchEvent("pointerup", { pointerId: 99, pointerType: "touch" });
  await page.waitForFunction(() => document.querySelector("#preview").dataset.previewReady === "invalid");
  const unavailable = await currentPng(page);
  assert.deepEqual(unavailable.pixel(128, 100), [0, 0, 0]);
  assert.ok(unavailable.pixel(128, 128)[0] > unavailable.pixel(128, 128)[1]);
  assert.deepEqual(await page.locator("#preview").evaluate(element => ({
    imageVisibility: getComputedStyle(document.querySelector("#preview-image")).visibility,
    immediateCross: getComputedStyle(element, "::before").content,
  })), { imageVisibility: "visible", immediateCross: "none" });
  assert.deepEqual(errors, []);
});

test("mobile view menu and controls stay visible at 360x645 DPR 3", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context, { viewport: { width: 360, height: 645 }, deviceScaleFactor: 3 });
  const geometry = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
    return { slice: rect(".plot-frame"), preview: rect(".preview-panel"), background: rect("#background-stick"), footer: rect(".app-footer"), wheel: rect("#j-wheel") };
  });
  assert.ok(geometry.slice.bottom <= geometry.preview.top);
  for (const [name, r] of Object.entries(geometry)) assert.ok(r.top >= 0 && r.bottom <= 645 && r.left >= 0 && r.right <= 360, `${name} visible: ${JSON.stringify(r)}`);

  const previewGeneration = await page.locator("#preview").getAttribute("data-image-generation");
  assert.ok(geometry.wheel.right <= geometry.slice.left, JSON.stringify(geometry));
  const frame = page.locator("#plot-frame"), frameBox = await frame.boundingBox();
  const pointerX = frameBox.x + frameBox.width / 2, pointerY = frameBox.y + frameBox.height / 2;
  await page.evaluate(({ pointerX, pointerY }) => {
    const frame = document.querySelector("#plot-frame");
    frame.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 72, pointerType: "touch", button: 0, clientX: pointerX, clientY: pointerY }));
    window.__rapidSwipeRunning = true;
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      frame.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 72, pointerType: "touch", button: 0, clientX: pointerX + Math.sin(tick * .65) * 5, clientY: pointerY + Math.cos(tick * .51) * 4 }));
      if (tick >= 180) {
        clearInterval(timer);
        window.__rapidSwipeRunning = false;
      }
    }, 5);
  }, { pointerX, pointerY });
  await page.waitForFunction(generation => document.querySelector("#preview").dataset.imageGeneration !== generation && window.__rapidSwipeRunning, previewGeneration);
  await page.waitForFunction(() => !window.__rapidSwipeRunning);
  await frame.dispatchEvent("pointerup", { pointerId: 72, pointerType: "touch", button: 0, clientX: pointerX, clientY: pointerY });
  await settledImage(page);

  await page.locator("#preview").click();
  const menu = await page.locator("#view-menu").boundingBox();
  assert.ok(menu.y >= 0 && menu.y + menu.height <= 645 && menu.x >= 0 && menu.x + menu.width <= 360);
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.view), "0");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#preview").dataset.view === "0");
  assert.equal(await page.locator("#view-menu").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "preview");
  assert.deepEqual(errors, []);
});

test("touch and pen swipe the slice relatively without a contact jump", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  await pickXY(page, .4, .4);
  const frame = page.locator("#plot-frame");
  const box = await frame.boundingBox();
  assert.ok(box);
  for (const [index, pointerType] of ["touch", "pen"].entries()) {
    const pointerId = 130 + index;
    const startX = box.x + box.width * .8;
    const startY = box.y + box.height * .8;
    const before = await frame.evaluate(element => [Number(element.dataset.realX), Number(element.dataset.realY)]);
    await frame.dispatchEvent("pointerdown", { pointerId, pointerType, button: 0, clientX: startX, clientY: startY });
    assert.deepEqual(await frame.evaluate(element => [Number(element.dataset.realX), Number(element.dataset.realY)]), before);
    assert.equal(await frame.getAttribute("data-slice-tracking"), "touch-active");
    await frame.dispatchEvent("pointermove", {
      pointerId,
      pointerType,
      button: 0,
      clientX: startX + box.width * .1,
      clientY: startY - box.height * .1,
    });
    const after = await frame.evaluate(element => [Number(element.dataset.realX), Number(element.dataset.realY)]);
    assert.ok(after[0] > before[0], `${pointerType} raises x': ${before[0]} -> ${after[0]}`);
    assert.ok(after[1] > before[1], `${pointerType} upward motion raises y': ${before[1]} -> ${after[1]}`);
    await frame.dispatchEvent("pointerup", { pointerId, pointerType, button: 0, clientX: startX, clientY: startY });
    assert.equal(await frame.getAttribute("data-slice-tracking"), "idle");
  }
  assert.equal(await page.locator("#rolling-pad, #rolling-ball").count(), 0);
  assert.deepEqual(errors, []);
});

test("image locator inspects PNG metadata, prepares manual input, and samples a sharp loupe", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.locator("#image-file-input").setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  assert.equal(await page.locator('[data-image-zoom="2"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#image-panel").getAttribute("data-ready"), "false");
  const hiddenDuringPreparation = await page.locator("#image-panel").evaluate(panel => {
    const previous = panel.getAttribute("data-ready");
    panel.setAttribute("data-ready", "false");
    const hidden = getComputedStyle(panel.querySelector(".image-row")).display === "none";
    if (previous === null) panel.removeAttribute("data-ready");
    else panel.setAttribute("data-ready", previous);
    return hidden;
  });
  assert.equal(hiddenDuringPreparation, true);
  await page.waitForFunction(() => ["inspected", "true"].includes(document.querySelector("#image-panel")?.dataset.ready ?? ""));
  await page.locator("#image-options").click();
  assert.equal(await page.locator("#image-gamut-field").isVisible(), true);
  assert.equal(await page.locator("#image-transfer-field").isVisible(), true);
  assert.match(await page.locator("#image-interpretation-warning").textContent(), /No embedded color profile/);
  await page.locator("#image-gamut").selectOption("Rec.709 / sRGB");
  await page.locator("#image-transfer").selectOption("sRGB");
  await page.locator("#image-options-close").click();
  await page.waitForFunction(() => document.querySelector("#image-viewport")?.dataset.ready === "true");
  assert.equal(await page.locator("#image-preview").evaluate(image => [image.naturalWidth, image.naturalHeight].join("×")), "1×1");
  assert.deepEqual(await page.evaluate(() => ({
    preview: document.querySelector("#image-preview")?.tagName,
    loupe: document.querySelector("#image-loupe")?.tagName,
    overlay: document.querySelector("#image-overlay")?.tagName,
    overlaySpace: document.querySelector("#image-overlay")?.getContext("2d")?.getContextAttributes().colorSpace,
    indicatorSpace: document.querySelector("#gamut-indicators")?.getContext("2d")?.getContextAttributes().colorSpace,
  })), {
    preview: "IMG", loupe: "IMG", overlay: "CANVAS",
    overlaySpace: "display-p3", indicatorSpace: "display-p3",
  });
  const rangePresentation = await page.evaluate(() => ({
    supported: CSS.supports("dynamic-range-limit", "no-limit"),
    preview: getComputedStyle(document.querySelector("#image-preview")).getPropertyValue("dynamic-range-limit"),
    loupe: getComputedStyle(document.querySelector("#image-loupe")).getPropertyValue("dynamic-range-limit"),
  }));
  if (rangePresentation.supported) assert.deepEqual(rangePresentation, { supported: true, preview: "no-limit", loupe: "no-limit" });
  assert.equal(await page.locator("#image-overlay").evaluate(canvas => getComputedStyle(canvas).objectFit), "fill");
  const viewport = await page.locator("#image-viewport").boundingBox();
  assert.ok(viewport);
  await page.locator("#image-viewport").dispatchEvent("pointerdown", {
    pointerId: 401, pointerType: "mouse", button: 0,
    clientX: viewport.x + viewport.width / 2,
    clientY: viewport.y + viewport.height / 2,
  });
  await page.waitForFunction(() => document.querySelector("#image-stats")?.textContent?.includes("pixels sampled"));
  assert.equal(await page.locator("#image-viewport").getAttribute("data-tracking"), "mouse-active");
  assert.equal(await page.locator("#image-viewport").getAttribute("data-pointer-lock"), "active");
  assert.equal(await page.locator("#image-loupe").evaluate(element => getComputedStyle(element).imageRendering), "pixelated");
  assert.match(await page.locator("#image-loupe").getAttribute("src"), /^blob:/);
  assert.match(await page.locator("#image-stats").textContent(), /1 pixels sampled/);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 402, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 })));
  await page.waitForFunction(() => document.querySelector("#image-viewport")?.dataset.tracking === "idle");
  const locatorBeforeHdr = await page.locator("#image-preview").getAttribute("src");
  const loupeBeforeHdr = await page.locator("#image-loupe").getAttribute("src");
  await chooseView(page, 2);
  await page.waitForFunction(({ locator, loupe }) => {
    const panel = document.querySelector("#image-panel");
    return panel?.dataset.transforming === "false" &&
      document.querySelector("#image-preview")?.getAttribute("src") !== locator &&
      document.querySelector("#image-loupe")?.getAttribute("src") !== loupe;
  }, { locator: locatorBeforeHdr, loupe: loupeBeforeHdr });
  assert.deepEqual(await page.evaluate(async urls => Promise.all(urls.map(async url => {
    try { return (await fetch(url)).ok; } catch { return false; }
  })), [locatorBeforeHdr, loupeBeforeHdr]), [false, false], "superseded direct-image blob URLs are revoked");
  for (const selector of ["#image-preview", "#image-loupe"]) {
    const encoded = await elementPng(page, selector);
    assert.equal(encoded.depth, 16);
    assert.deepEqual([...encoded.chunks.get("cICP")], [12, 16, 0, 1]);
  }
  assert.equal(await page.locator("#image-scale-203").isChecked(), true);
  const analysisBeforeScale = await page.locator("#image-stats").textContent();
  const previewBeforeScale = await page.locator("#image-preview").getAttribute("src");
  await page.locator("#image-options").click();
  const busyState = await page.locator("#image-scale-203").evaluate(input => {
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const panel = document.querySelector("#image-panel");
    const banner = document.querySelector("#image-transform-banner");
    return {
      busy: panel?.dataset.transforming,
      bannerHidden: banner?.hasAttribute("hidden"),
      opacity: getComputedStyle(document.querySelector(".image-row")).opacity,
    };
  });
  assert.deepEqual(busyState, { busy: "true", bannerHidden: false, opacity: "0.38" });
  await page.waitForFunction(src => document.querySelector("#image-preview")?.getAttribute("src") !== src, previewBeforeScale);
  assert.equal(await page.locator("#image-panel").getAttribute("data-transforming"), "false");
  assert.equal(await page.locator("#image-transform-banner").isHidden(), true);
  assert.match(await page.locator("#image-preview").getAttribute("data-renderer"), /^(webgpu|wasm)$/);
  assert.equal(await page.locator("#image-stats").textContent(), analysisBeforeScale);
  await page.locator("#image-options-close").click();
  await page.locator('[data-image-zoom="2"]').click();
  assert.equal(await page.locator('[data-image-zoom="2"]').getAttribute("aria-pressed"), "true");

  // Replacing the image resets to 2x and keeps the row hidden until the new
  // raster/crosshair state is initialized together.
  await page.locator("#image-file-input").setInputFiles({ name: "sample-2.png", mimeType: "image/png", buffer: png });
  assert.equal(await page.locator('[data-image-zoom="2"]').getAttribute("aria-pressed"), "true");
  await page.waitForFunction(() => document.querySelector("#image-viewport")?.dataset.ready === "true");
  const zoomWidth = await page.locator(".image-zoom-controls").evaluate(element => element.getBoundingClientRect().width);
  const buttonWidths = await page.locator(".image-zoom-button").evaluateAll(buttons => buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0));
  assert.ok(zoomWidth <= buttonWidths + 8, `zoom controls expanded to ${zoomWidth}px for ${buttonWidths}px of buttons`);
  assert.ok(await page.locator("#image-overlay").evaluate(canvas => {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return true;
    return false;
  }), "replacement image publishes with a crosshair");
  assert.deepEqual(errors, []);
});

test("unchecked HDR P3 slice PNG accepts bright neighborhoods", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context);
  await chooseView(page, 2);
  await setJNumber(page, 0.8);
  await page.waitForFunction(() => Math.abs(JSON.parse(document.querySelector("#gamut-slice")?.dataset.imageCode ?? "[NaN]")[0] - 0.8) < 1e-6);
  const sliceBytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector("#gamut-slice").src)).arrayBuffer())]);
  await page.locator("#image-file-input").setInputFiles({ name: "hdr-slice.png", mimeType: "image/png", buffer: Buffer.from(sliceBytes) });
  await page.waitForFunction(() => document.querySelector("#image-viewport")?.dataset.ready === "true");
  assert.equal(await page.locator("#image-scale-203").isChecked(), false);
  await page.waitForFunction(() => document.querySelector("#image-stats")?.textContent?.includes("pixels sampled"));
  const stats = await page.locator("#image-stats").textContent();
  assert.match(stats ?? "", /29 pixels sampled/);
  assert.doesNotMatch(stats ?? "", /29 unavailable/);
  assert.deepEqual(errors, []);
});

test("WebGPU image appearance matches the official-table WASM path for every view and scale", { timeout: 60_000 }, async context => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-webgpu", "--use-angle=swiftshader"],
  });
  context.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  const parity = await page.evaluate(async () => {
    const wasm = await import("/src/wasm/decomposition_pkg/modcam16_decomposition_wasm.js");
    await wasm.default();
    const { SliceWebGpuRenderer } = await import("/src/slice_webgpu.ts");
    const renderer = new SliceWebGpuRenderer();
    if (!renderer.available) return null;
    const parameters = wasm.picker_gpu_parameters();
    const source = new Float32Array([.18, .18, .18, .5, .1, .05, .02, .3, .7, 1.2, .8, .25]);
    const results = [];
    for (const view of [1, 4, 2, 0]) for (const scale203 of [false, true]) {
      const slot = view === 0 ? 0 : view === 1 ? 1 : view === 2 ? 2 : 3;
      const gpu = await renderer.renderImage(parameters, slot, scale203, source);
      const cpu = wasm.image_picker_display_rgb_ap0_batch(source, view, scale203);
      let maximum = 0;
      for (let index = 0; index < cpu.length; index += 1)
        maximum = Math.max(maximum, Math.abs(gpu[index] - cpu[index]));
      results.push({ view, scale203, maximum, length: gpu.length });
    }
    return results;
  });
  if (parity === null) return;
  assert.equal(parity.length, 8);
  for (const result of parity) {
    assert.equal(result.length, 12);
    assert.ok(result.maximum < .002, JSON.stringify(result));
  }
});

test("image appearance falls back to the bounded WASM worker pool without WebGPU", { timeout: 60_000 }, async context => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({
    executablePath: CHROMIUM, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-webgpu"],
  });
  context.after(async () => { await browser.close(); await server.close(); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.locator("#image-file-input").setInputFiles({ name: "cpu.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => document.querySelector("#image-viewport")?.dataset.ready === "true");
  assert.equal(await page.locator("#image-preview").getAttribute("data-renderer"), "wasm");
});

test("loaded image locator still fits the 360x645 DPR-3 viewport", { timeout: 60_000 }, async context => {
  const { page, errors } = await openPicker(context, { viewport: { width: 360, height: 645 }, deviceScaleFactor: 3 });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.locator("#image-file-input").setInputFiles({ name: "mobile.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => ["inspected", "true"].includes(document.querySelector("#image-panel")?.dataset.ready ?? ""));
  await page.locator("#image-options").click();
  await page.locator("#image-gamut").selectOption("Rec.709 / sRGB");
  await page.locator("#image-options-close").click();
  await page.waitForFunction(() => document.querySelector("#image-viewport")?.dataset.ready === "true");
  const layout = await page.evaluate(() => {
    const selectors = [".app-shell", ".visuals", "#image-panel", "#image-viewport", ".app-footer"];
    return {
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      viewport: [innerWidth, innerHeight],
      bounds: selectors.map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [rect.left, rect.top, rect.right, rect.bottom];
      }),
    };
  });
  assert.deepEqual(layout.scroll, layout.viewport);
  for (const [left, top, right, bottom] of layout.bounds) {
    assert.ok(left >= 0 && top >= 0 && right <= 360 && bottom <= 645, JSON.stringify(layout));
  }
  assert.deepEqual(errors, []);
});
