import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../../apps/web/features/search/search-box.tsx", import.meta.url), "utf8"), {
  fileName: "search-box.tsx", compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

// Actual SearchBox handlers with controlled state/effects/window. This isolates
// the input-vs-result readiness contract, not React or browser history timing.
function fixture() {
  const values = [], refs = [], moves = [], submissions = [], listeners = new Map();
  const props = { initialQuery: "Synthetic restored query", hasResults: false,
    onMoveSelection: delta => moves.push(delta), onSearch: value => submissions.push(value),
    onOpenSelection: () => { opens += 1; } };
  let opens = 0, stateIndex = 0, refIndex = 0, effects = [], tree;
  const window = { location: { search: "?q=Synthetic+restored+query" },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const modules = {
    react: {
      useState: initial => {
        const index = stateIndex++;
        if (!(index in values)) values[index] = initial;
        return [values[index], value => { values[index] = value; }];
      },
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useEffect: fn => effects.push(fn),
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "../../components/preferences-provider": { usePreferences: () => ({ resolvedLocale: "en-US" }) },
  };
  const exports = {};
  new Function("require", "exports", "window", compiled)(name => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (name.startsWith(".")) throw new Error(`Unexpected dependency: ${name}`);
    return require(name);
  }, exports, window);
  const render = () => {
    stateIndex = refIndex = 0; effects = [];
    tree = exports.SearchBox(props);
  };
  const input = () => tree.props.children[0].props.children[1].props;
  const key = key => {
    const event = { key, nativeEvent: { isComposing: false }, keyCode: 0, prevented: false,
      preventDefault() { this.prevented = true; } };
    input().onKeyDown(event); return event;
  };
  render(); for (const effect of effects) effect(); render();
  return { props, moves, submissions, render, input, key, opens: () => opens,
    popstate: () => listeners.get("popstate")(),
  };
}

test("restored text without restored results does not consume ArrowDown or queue a future selection", () => {
  const f = fixture();
  f.input().onChange({ target: { value: "Synthetic unsubmitted draft" } }); f.render();
  f.popstate(); f.render();
  assert.equal(f.input().value, f.props.initialQuery);
  assert.equal(f.key("ArrowDown").prevented, false);
  assert.deepEqual(f.moves, []);
  f.props.hasResults = true; f.render();
  assert.deepEqual(f.moves, []); // Data arrival does not replay the earlier key.
  assert.equal(f.key("ArrowDown").prevented, true); f.render();
  assert.deepEqual(f.moves, [1]);
  assert.equal(f.key("Enter").prevented, true);
  assert.equal(f.opens(), 1);
});

test("a restored input cannot select stale results while the committed query differs", () => {
  const f = fixture();
  f.props.initialQuery = "Synthetic new query"; f.props.hasResults = true; f.render();
  f.popstate(); f.render();
  assert.equal(f.key("ArrowDown").prevented, false);
  assert.deepEqual(f.moves, []);
  f.props.initialQuery = "Synthetic restored query"; f.render();
  assert.equal(f.key("ArrowDown").prevented, true);
  assert.deepEqual(f.moves, [1]);
});

test("history restoration clears keyboard-open intent until another explicit selection", () => {
  const f = fixture();
  f.props.hasResults = true; f.render(); f.key("ArrowDown"); f.render();
  f.popstate(); f.render();
  assert.equal(f.key("Enter").prevented, false);
  assert.equal(f.opens(), 0);
  f.key("ArrowDown"); f.render(); f.key("Enter");
  assert.equal(f.opens(), 1);
});
