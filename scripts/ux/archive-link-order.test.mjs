import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../apps/web/features/conversations/conversation-list.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("conversation-list.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useConversationLinkOrder");
assert.ok(hook);
const compiled = ts.transpileModule(hook.getText(ast), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText;

// The actual production hook with explicit event/ref/effect/frame doubles.
// Native activation, DOM identity and layout are separately tested in Chromium.
function fixture() {
  const window = new EventTarget(), refs = [], frames = new Map(), holds = [];
  let cursor = 0, effectScope, cleanup, frameId = 0, renderedScope = "active:account-1", sort = "content_updated";
  class Element {
    constructor(name) { this.name = name; this.anchor = this; this.isConnected = true; }
    closest() { return this.anchor; }
    contains(node) { return node === this || node?.anchor === this; }
  }
  const anchor = new Element("first"), other = new Element("second");
  const invoke = new Function("useRef", "useLayoutEffect", "window", "Element", "AbortController",
    "requestAnimationFrame", "cancelAnimationFrame",
    `${compiled}; return useConversationLinkOrder;`)(
      initial => refs[cursor++] ??= { current: initial },
      (run, deps) => {
        if (!deps) { run(); return; }
        const [scope] = deps;
        if (scope !== effectScope) { cleanup?.(); cleanup = run(); effectScope = scope; }
      },
      window, Element, AbortController,
      callback => { frames.set(++frameId, callback); return frameId; },
      id => frames.delete(id),
    );
  function render(scope = renderedScope, nextSort = sort) {
    cursor = 0; renderedScope = scope; sort = nextSort;
    return invoke(() => {
      const held = { sort, scope, releases: 0 };
      holds.push(held);
      return () => { held.releases++; };
    }, scope);
  }
  let handlers = render();
  return {
    holds, anchor, other,
    render(scope, nextSort) { handlers = render(scope, nextSort); },
    act(name, extras = {}, target = anchor) {
      handlers[name]({ target, currentTarget: { contains: candidate => candidate === anchor || candidate === other },
        isPrimary: true, button: 0, pointerId: 1, ...extras,
        preventDefault() { throw new Error("Never replace native link activation"); },
        stopPropagation() { throw new Error("Never suppress native link propagation"); },
      });
    },
    dispatch(name, pointerId = 1) {
      const event = new Event(name); Object.defineProperty(event, "pointerId", { value: pointerId }); window.dispatchEvent(event);
    },
    frame() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    dispose() { cleanup?.(); },
  };
}

test("ordinary link holds the old sort through pointerup and the native click", () => {
  const f = fixture();
  f.act("onPointerDownCapture"); f.act("onFocusCapture");
  f.render(undefined, "recent_read");
  assert.equal(f.holds.length, 1); assert.equal(f.holds[0].sort, "content_updated");
  f.dispatch("pointerup"); assert.equal(f.holds[0].releases, 0);
  f.act("onClick"); assert.equal(f.holds[0].releases, 0);
  f.frame(); assert.equal(f.holds[0].releases, 1);
  f.dispose(); assert.equal(f.holds[0].releases, 1);
});

for (const button of [0, 1]) test(`native button ${button}, modifier keys and activation are never intercepted`, () => {
  const f = fixture();
  f.act("onPointerDownCapture", { button, ctrlKey: true, metaKey: true });
  f.dispatch("pointerup");
  f.act(button === 0 ? "onClick" : "onAuxClick", { button, ctrlKey: true });
  assert.equal(f.holds[0].releases, 0);
  f.frame(); assert.equal(f.holds[0].releases, 1);
});

test("focus holds order until blur, keyboard Enter activation reacquires and then releases", () => {
  const f = fixture();
  f.act("onFocusCapture"); f.render(undefined, "recent_read");
  f.act("onKeyDownCapture", { key: "Enter" }); f.act("onClick");
  f.frame(); assert.equal(f.holds.length, 1); assert.equal(f.holds[0].releases, 1);
  f.act("onKeyDownCapture", { key: "Enter" }); assert.equal(f.holds[1].sort, "recent_read");
  f.act("onClick"); f.frame(); assert.equal(f.holds[1].releases, 1);
  f.act("onFocusCapture"); f.act("onBlurCapture"); assert.equal(f.holds[2].releases, 1);
});

test("Escape, window blur and a cancelled touch do not leave a held list", () => {
  const f = fixture();
  f.act("onFocusCapture"); f.act("onKeyDownCapture", { key: "Escape" });
  f.act("onFocusCapture"); f.dispatch("blur");
  f.act("onPointerDownCapture", { pointerType: "touch" }); f.dispatch("pointercancel");
  assert.deepEqual(f.holds.map(item => item.releases), [1, 1, 1]);
  f.frame(); assert.deepEqual(f.holds.map(item => item.releases), [1, 1, 1]);
});

test("release outside without click finishes; another pointer cannot finish this press", () => {
  const f = fixture();
  f.act("onPointerDownCapture"); f.dispatch("pointerup", 2); f.frame();
  assert.equal(f.holds[0].releases, 0);
  f.act("onBlurCapture"); assert.equal(f.holds[0].releases, 0);
  f.dispatch("pointerup"); f.frame(); assert.equal(f.holds[0].releases, 1);
});

test("an old deferred release cannot clear a newer anchor's interaction", () => {
  const f = fixture();
  f.act("onPointerDownCapture"); f.dispatch("pointerup");
  f.act("onFocusCapture", {}, f.other); f.frame();
  assert.deepEqual(f.holds.map(item => item.releases), [1, 0]);
  f.act("onBlurCapture", {}, f.other); assert.equal(f.holds[1].releases, 1);
});

for (const interaction of ["onFocusCapture", "onPointerDownCapture"]) {
  test(`a disconnected anchor releases ${interaction} ownership without a synthetic blur`, () => {
    const f = fixture();
    f.act(interaction);
    f.anchor.isConnected = false;
    f.render();
    assert.equal(f.holds[0].releases, 1);
    f.act("onFocusCapture", {}, f.other);
    f.dispatch("pointerup");
    f.frame();
    assert.deepEqual(f.holds.map(item => item.releases), [1, 0]);
    f.dispose();
    assert.deepEqual(f.holds.map(item => item.releases), [1, 1]);
  });
}

for (const scope of ["archived:account-1", "active:tag-2:account-1", "active:account-2", "active:account-1:selection"]) {
  test(`interaction ownership is released on scope transition ${scope}`, () => {
    const f = fixture();
    f.act("onPointerDownCapture"); f.dispatch("pointerup"); f.render(scope); f.frame();
    assert.equal(f.holds[0].releases, 1);
    f.act("onFocusCapture"); assert.equal(f.holds[1].scope, scope);
    f.dispose(); assert.equal(f.holds[1].releases, 1);
  });
}

test("secondary/non-primary pointers and non-link targets cannot acquire ownership", () => {
  const f = fixture();
  f.act("onPointerDownCapture", { button: 2 });
  f.act("onPointerDownCapture", { isPrimary: false });
  f.act("onFocusCapture", {}, {});
  assert.equal(f.holds.length, 0);
});

test("the row wires native link handlers and the actual query/control share the held order", () => {
  assert.match(source, /className="min-w-0" \{\.\.\.\(!selectionMode \? conversationLinkHandlers : \{\}\)\}/);
  const wiredLinks = [];
  function inspect(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "HoverPreviewLink") {
      let parent = node.parent;
      while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
      wiredLinks.push(parent?.openingElement.attributes.properties.some(property =>
        ts.isJsxSpreadAttribute(property) && property.expression.getText(ast).includes("conversationLinkHandlers")));
    }
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  assert.deepEqual(wiredLinks, [true], "handlers must enclose the real link, not the adjacent metadata column");
  assert.match(source, /useConversationLinkOrder\(holdListOrder, JSON\.stringify\(\[mode, tagId, viewGeneration, selectionMode\]\)\)/);
  assert.match(source, /heldOrder\?\.generation === viewGeneration && heldOrder\.mode === mode && heldOrder\.tagId === tagId/);
  assert.match(source, /queryKey: \["conversations", "paged", mode, tagId, conversationSortMode, conversationSortDirection\]/);
  assert.match(source, /displayedOrder=\{displayedOrder\}/);
  assert.doesNotMatch(hook.getText(ast), /preventDefault|stopPropagation|router\.|location\./);
});

test("archived projects retain their component below conversations for all result states", () => {
  const shell = readFileSync(new URL("../../apps/web/components/app-shell.tsx", import.meta.url), "utf8");
  const component = ts.createSourceFile("app-shell.tsx", shell, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const order = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && ["ConversationList", "ArchivedProjectList"].includes(node.tagName.getText(component))) order.push(node.tagName.getText(component));
    ts.forEachChild(node, visit);
  }
  visit(component);
  assert.deepEqual(order, ["ConversationList", "ArchivedProjectList"]);
  const projects = readFileSync(new URL("../../apps/web/features/projects/archived-project-list.tsx", import.meta.url), "utf8");
  assert.match(projects, /projectsQuery\.isLoading/);
  assert.match(projects, /projectsQuery\.isError/);
  assert.match(projects, /projectsQuery\.refetch/);
});
