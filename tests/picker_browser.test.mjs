import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const CHROMIUM =
  "/home/rust/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

test(
  "picker renders and preserves canonical profile state",
  { timeout: 60_000 },
  async (context) => {
    const server = await createServer({
      server: { host: "127.0.0.1", port: 0 },
    });
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
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${address.port}/`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#gamut-slice");
      const status = document.querySelector("#plot-status");
      return canvas?.width === 512 && status?.hasAttribute("hidden");
    });

    const initial = await page.evaluate(() => {
      const canvas = document.querySelector("#gamut-slice");
      const ctx = canvas.getContext("2d");
      return {
        profileOrder: Array.from(
          document.querySelector("#profile").options,
          (option) => option.value,
        ),
        profileLabels: Array.from(
          document.querySelector("#profile").options,
          (option) => option.textContent.trim().replace(/\s+/g, " "),
        ),
        omittedControls: document.querySelectorAll(
          "#temperature, #tint, #white-balance-reset, #white-balance-store, #white-balance-recall, #reflectance, #hue, #saturation",
        ).length,
        corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        center: Array.from(ctx.getImageData(256, 256, 1, 1).data),
        patchName: document.querySelector("#colorchecker-name").textContent,
        sticks: ["#j-stick", "#x-stick", "#y-stick"].map(
          (selector) =>
            !document.querySelector(selector).hasAttribute("hidden"),
        ),
      };
    });
    assert.deepEqual(initial.profileOrder, ["3", "1", "4", "2", "0"]);
    assert.deepEqual(initial.profileLabels, [
      "Rec.709 / No view transform",
      "Rec.709 / ACES 2.0 - SDR 100 nits (Rec.709)",
      "P3-D65 / ACES 2.0 - SDR 100 nits (P3 D65)",
      "P3-D65 / ACES 2.0 - HDR 1000 nits (P3 D65)",
      "Rec.2020 (P3-D65 limited) / ACES 2.0 - HDR 1000 nits (Rec.2020)",
    ]);
    assert.equal(initial.omittedControls, 0);
    assert.notDeepEqual(initial.corner, initial.center);
    assert.equal(initial.patchName, "Dark Skin");
    assert.deepEqual(initial.sticks, [true, true, true]);

    const beforeSnap = await page.evaluate(() => ({
      j: document.querySelector("#j-code").value,
      y: document.querySelector("#saturation-y").value,
      targetX:
        Number.parseFloat(document.querySelector("#x-stick").style.left) / 100,
    }));
    await page.locator("#saturation-x").evaluate((element, target) => {
      element.value = String(target + 0.01);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, beforeSnap.targetX);
    const afterSnap = await page.evaluate(() => ({
      j: document.querySelector("#j-code").value,
      x: Number(document.querySelector("#saturation-x").value),
      xNumber: Number(document.querySelector("#x-number").value),
      y: document.querySelector("#saturation-y").value,
    }));
    assert.ok(Math.abs(afterSnap.x - beforeSnap.targetX) < 1e-6);
    assert.ok(Math.abs(afterSnap.xNumber - beforeSnap.targetX) < 1e-6);
    assert.equal(afterSnap.j, beforeSnap.j);
    assert.equal(afterSnap.y, beforeSnap.y);

    const beforeNumericSnap = await page.evaluate(() => ({
      j: Number(document.querySelector("#j-code").value),
      x: Number(document.querySelector("#saturation-x").value),
      targetJ:
        Number.parseFloat(document.querySelector("#j-stick").style.left) / 100,
      targetY:
        Number.parseFloat(document.querySelector("#y-stick").style.left) / 100,
    }));
    await page.locator("#y-number").focus();
    await page.locator("#y-number").evaluate((element, target) => {
      element.value = String(target + 0.01);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, beforeNumericSnap.targetY);
    const afterYNumericSnap = await page.evaluate(() => ({
      j: Number(document.querySelector("#j-code").value),
      x: Number(document.querySelector("#saturation-x").value),
      y: Number(document.querySelector("#saturation-y").value),
      yNumber: Number(document.querySelector("#y-number").value),
    }));
    assert.equal(afterYNumericSnap.j, beforeNumericSnap.j);
    assert.equal(afterYNumericSnap.x, beforeNumericSnap.x);
    assert.ok(Math.abs(afterYNumericSnap.y - beforeNumericSnap.targetY) < 1e-6);
    assert.ok(
      Math.abs(afterYNumericSnap.yNumber - beforeNumericSnap.targetY) < 1e-6,
    );

    await page.locator("#j-number").focus();
    await page.locator("#j-number").evaluate((element, target) => {
      element.value = String(target + 0.01);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, beforeNumericSnap.targetJ);
    await page.waitForFunction(
      () => document.querySelector("#gamut-slice").width === 64,
    );
    const afterJNumericSnap = await page.evaluate(() => ({
      j: Number(document.querySelector("#j-code").value),
      jNumber: Number(document.querySelector("#j-number").value),
      x: Number(document.querySelector("#saturation-x").value),
      y: Number(document.querySelector("#saturation-y").value),
    }));
    assert.ok(Math.abs(afterJNumericSnap.j - beforeNumericSnap.targetJ) < 1e-6);
    assert.ok(
      Math.abs(afterJNumericSnap.jNumber - beforeNumericSnap.targetJ) < 1e-6,
    );
    assert.equal(afterJNumericSnap.x, afterYNumericSnap.x);
    assert.equal(afterJNumericSnap.y, afterYNumericSnap.y);
    await page
      .locator("#j-number")
      .evaluate((element) =>
        element.dispatchEvent(new Event("change", { bubbles: true })),
      );
    await page.waitForFunction(
      () => document.querySelector("#gamut-slice").width === 512,
    );

    const backgroundTarget = await page.evaluate(
      () =>
        Number.parseFloat(
          document.querySelector("#background-stick").style.left,
        ) / 100,
    );
    await page.locator("#background-brightness").evaluate((element, target) => {
      element.value = String(target);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, backgroundTarget);

    let canonical;
    for (const profile of ["1", "4", "2", "0"]) {
      await page.selectOption("#profile", profile);
      await page.waitForFunction((expected) => {
        const status = document.querySelector("#plot-status");
        return (
          document.querySelector("#profile").value === expected &&
          status.hasAttribute("hidden")
        );
      }, profile);
      const value = await page.textContent("#linear-value");
      canonical ??= value;
      assert.equal(value, canonical);
      assert.match(await page.textContent("#rgb-label"), /ACEScg/);
      const background = await page.evaluate(() => ({
        value: Number(document.querySelector("#background-brightness").value),
        marker:
          Number.parseFloat(
            document.querySelector("#background-stick").style.left,
          ) / 100,
        display: Number(
          document.querySelector("#background-brightness-value").textContent,
        ),
      }));
      const markerLinear =
        (background.marker <= 0.04045
          ? background.marker / 12.92
          : ((background.marker + 0.055) / 1.055) ** 2.4) * 1.2;
      assert.ok(
        Math.abs(background.display - markerLinear) < 0.002,
        JSON.stringify({ background, markerLinear }),
      );
    }

    await page.selectOption("#profile", "3");
    await page.waitForFunction(() =>
      document.querySelector("#plot-status").hasAttribute("hidden"),
    );
    // Leave any latched ColorChecker halo before selecting the exact neutral;
    // otherwise the independent axis snap can intentionally retain a nearby
    // patch coordinate.
    for (const [selector, value] of [
      ["#saturation-x", "0"],
      ["#saturation-y", "0"],
      ["#saturation-x", "0.5"],
      ["#saturation-y", "0.5"],
    ]) {
      await page.locator(selector).evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    }
    await page.locator("#j-code").evaluate((element) => {
      element.value = "0.4";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(
      () => document.querySelector("#gamut-slice").width === 64,
    );
    await page
      .locator("#j-code")
      .evaluate((element) =>
        element.dispatchEvent(new Event("change", { bubbles: true })),
      );
    await page.waitForFunction(
      () => document.querySelector("#gamut-slice").width === 512,
    );
    const bright = await page.evaluate(() => ({
      linear: document.querySelector("#linear-value").textContent,
      hex: document.querySelector("#encoded-value").value,
      preview: getComputedStyle(document.querySelector("#preview"))
        .backgroundColor,
      unavailable: document
        .querySelector("#preview")
        .classList.contains("preview-unavailable"),
    }));
    assert.ok(Number(bright.linear.match(/\(([^,]+)/)?.[1]) > 1);
    assert.equal(bright.hex, "FFFFFF");
    assert.equal(bright.preview, "rgb(255, 255, 255)");
    assert.equal(bright.unavailable, false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const narrowLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      readoutWidth: document.querySelector("#linear-value").scrollWidth,
      readoutViewport: document.querySelector("#linear-value").clientWidth,
      overflowingElements: Array.from(document.querySelectorAll(".app-shell *"))
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 1,
        )
        .map((element) => element.id || element.className),
    }));
    assert.equal(narrowLayout.documentWidth, narrowLayout.viewportWidth);
    assert.ok(narrowLayout.readoutWidth <= narrowLayout.readoutViewport);
    assert.deepEqual(narrowLayout.overflowingElements, []);
    assert.deepEqual(errors, []);
  },
);
