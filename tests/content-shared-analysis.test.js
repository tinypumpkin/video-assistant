const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content-shared.js"), "utf8");
const visualSource = fs.readFileSync(path.join(__dirname, "..", "lib", "visual-memos.js"), "utf8");
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(visualSource, context);
context.globalThis.BILI_VISUAL_MEMOS = context.BILI_VISUAL_MEMOS;
vm.runInContext(source, context);
const { analyzeImagePixels } = context.globalThis.VideoAssistantUI;

function pixels(width, height, valueAt) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = valueAt(x, y);
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

test("96×54 像素分析过滤纯色低信息帧", () => {
  const result = analyzeImagePixels(pixels(96, 54, () => 255), 96, 54);
  assert.equal(result.useful, false);
  assert.equal(result.perceptualHash.length, 16);
});

test("96×54 像素分析保留具有清晰结构的帧", () => {
  const result = analyzeImagePixels(
    pixels(96, 54, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 235 : 25)),
    96,
    54,
  );
  assert.equal(result.useful, true);
  assert.ok(result.edgeDensity > 0.01);
});
