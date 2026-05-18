import test from "node:test";
import assert from "node:assert/strict";
import { buildRecipePrompt } from "../../src/recipe/prompt.js";

test("builds a short Japanese cooking supporter request", () => {
  const prompt = buildRecipePrompt("カレー");
  assert.match(prompt, /カレー/);
  assert.match(prompt, /料理サポーター/);
  assert.match(prompt, /聞き返/);
  assert.match(prompt, /代替/);
  assert.match(prompt, /プレーンテキスト/);
  assert.match(prompt, /Markdown記法/);
  assert.match(prompt, /コードブロック/);
  assert.doesNotMatch(prompt, /Answer only with a recipe/);
});


test("rejects empty and overlong dish names", () => {
  assert.throws(() => buildRecipePrompt("   "), /料理名/);
  assert.doesNotThrow(() => buildRecipePrompt("あ".repeat(80)));
  assert.throws(() => buildRecipePrompt("あ".repeat(81)), /80/);
});
