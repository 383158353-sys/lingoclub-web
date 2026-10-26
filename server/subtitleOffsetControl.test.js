import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { JSDOM } from "jsdom";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const outdir = join(projectRoot, "node_modules/.cache");
mkdirSync(outdir, { recursive: true });
const outfile = join(outdir, "subtitle-offset-control.js");
await esbuild.build({
  absWorkingDir: projectRoot,
  entryPoints: ["src/components/study/SubtitleOffsetControl.jsx"],
  bundle: true,
  format: "esm",
  outfile,
  jsx: "automatic",
  alias: { "@": join(projectRoot, "src") },
  external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
});

const { default: SubtitleOffsetControl } = await import(pathToFileURL(outfile).href);
const ReactMod = await import("react");
const React = ReactMod.default;
const { act } = ReactMod;
const { createRoot } = await import("react-dom/client");

function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function renderControl(props) {
  const rootEl = document.getElementById("root");
  rootEl.innerHTML = "";
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(React.createElement(SubtitleOffsetControl, props));
  });
  return root;
}

test("precise offset applies as you type and has no confirm button", async () => {
  const changes = [];
  const root = await renderControl({ offsetMs: 0, onChange: (ms) => changes.push(ms) });
  assert.equal([...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "确定"), false);
  assert.equal(document.querySelector("[data-testid='subtitle-offset-commit']"), null);
  const input = document.querySelector("[data-testid='subtitle-offset-input']");
  await act(async () => setNativeValue(input, "2.4"));
  assert.deepEqual(changes, [2400]);
  await act(async () => {
    input.dispatchEvent(new window.Event("blur", { bubbles: true }));
  });
  assert.deepEqual(changes, [2400]);
  act(() => root.unmount());
});

test("nudge buttons write the offset immediately", async () => {
  const changes = [];
  const root = await renderControl({
    offsetMs: 0,
    onChange: (ms, source) => changes.push({ ms, source }),
  });
  await act(async () => {
    document.querySelector("[data-testid='subtitle-offset-nudge-plus-100']").click();
  });
  assert.deepEqual(changes, [{ ms: 100, source: "nudge" }]);
  act(() => root.unmount());
});
