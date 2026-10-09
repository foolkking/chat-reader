import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Frozen pre-edit proof. Uses the existing actual-component test harness, not
// a browser or a real PDF canvas. CI trace/screenshot evidence is separate.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const commit = '36b656a5c1642989c9fc1796bfd4c21a6cbe7f9e';
const files = ['apps/web/features/attachments/attachment-viewer.tsx',
  'apps/web/features/attachments/pdf-viewer-policy.ts',
  'apps/web/e2e/pdfjs-migration.spec.ts', 'scripts/ux/attachment-reading.test.mjs'];
const source = Object.fromEntries(files.map(file => [file,
  execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })]));
for (const file of files) assert.equal(readFileSync(new URL('../../../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n'), source[file].replaceAll('\r\n', '\n'), `Pre-edit source changed: ${file}`);
const testUrl = new URL('../../../scripts/ux/attachment-reading.test.mjs', import.meta.url);
const header = source[files[3]].split('test("PDF page canvas')[0]
  .replace(/^import .*;\r?$/gm, '').replaceAll(', import.meta.url', ', ' + JSON.stringify(testUrl.href));
const { fixture, policy, appRequire, flush } = new Function('assert', 'existsSync', 'readFileSync', 'createRequire', 'setImmediate',
  header + '\nreturn { fixture, policy, appRequire, flush };')(assert, existsSync, readFileSync, createRequire, setImmediate);
const { Virtualizer } = appRequire('@tanstack/react-virtual');
const noop = () => {};
const offsets = [];
for (const width of [375, 1267]) {
  let scroll, visiblePage, virtualizer, requestedOffset;
  const root = { clientWidth: width, clientHeight: 730, scrollTop: 0, scrollHeight: 200000,
    addEventListener: (name, callback) => { if (name === 'scroll') scroll = callback; }, removeEventListener: noop };
  const f = fixture('PdfPageList', { documentProxy: { numPages: 120 }, currentPage: 90, scrollRequest: { page: 90 },
    onVisiblePageChange: page => { visiblePage = page; }, fitMode: 'width', zoom: 1, containerWidth: width, containerHeight: 730,
    viewportRef: { current: root }, pageSizesRef: { current: new Map([[90, { width: 792, height: 612 }]]) },
    renderQueue: policy.createPdfRenderQueue(), onPageSize: noop }, {}, {
    useVirtualizer: options => {
      if (!virtualizer) {
        virtualizer = new Virtualizer({ ...options, initialRect: { width, height: 730 }, observeElementRect: noop, observeElementOffset: noop,
          scrollToFn: (offset, { adjustments = 0 }) => { requestedOffset = offset + adjustments; root.scrollTop = Math.floor(requestedOffset); virtualizer.scrollOffset = root.scrollTop; } });
        virtualizer.scrollElement = root;
      }
      return virtualizer;
    },
  });
  try {
    f.render(); await f.runEffects(); scroll();
    const target = virtualizer.getMeasurements()[89];
    offsets.push({ width, targetPage: 90, requestedOffset, nativeIntegerOffset: root.scrollTop, targetStart: target.start,
      currentSample: root.scrollTop + 16, reportedPage: visiblePage,
      onePixelInsetSamplePage: virtualizer.getVirtualItemForOffset(root.scrollTop + 17).index + 1 });
    assert.equal(visiblePage, 89);
    assert.equal(offsets.at(-1).onePixelInsetSamplePage, 90);
  } finally { f.dispose(); }
}

const ts = appRequire('typescript');
const ast = ts.createSourceFile('pdfjs-migration.spec.ts', source[files[2]], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let init;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'page.addInitScript' && node.arguments[0]?.getText(ast).includes('Synthetic PDF canvas failure')) init = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(init);
class Canvas {
  getContext() { return {}; }
  closest(selector) { return selector === '[data-pdf-page="1"]' ? {} : null; }
}
const compiled = ts.transpileModule(`(${init})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('HTMLCanvasElement', compiled)(Canvas);
let renders = 0;
const page = { getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), cleanup: noop,
  render: ({ canvas }) => { renders++; canvas.getContext('2d'); return { promise: Promise.resolve(), cancel: noop }; } };
const props = { documentProxy: { getPage: async () => page }, pageNumber: 1, fitMode: 'page', zoom: 1,
  containerWidth: 1230, containerHeight: 720, renderQueue: policy.createPdfRenderQueue() };
const f = fixture('PdfPage', props);
Object.setPrototypeOf(f.canvas, Canvas.prototype);
let initialError, afterResizeError;
try {
  f.render(); await f.runEffects(); initialError = f.states.get('error');
  props.containerHeight = 722; f.render(); await f.runEffects(); afterResizeError = f.states.get('error');
  assert.equal(initialError, true); assert.equal(afterResizeError, false); assert.equal(renders, 2);
} finally { f.dispose(); await flush(); }
console.log(JSON.stringify({ schema_version: 1, source_commit: commit,
  evidence: 'actual PdfPageList/PdfPage and actual E2E injection; installed Virtualizer; explicit hook/DOM/PDF doubles, no browser',
  source_sha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(source[file]).digest('hex')])),
  fractional_offsets: offsets, one_shot_fault: { initialError, afterResizeError, renderAttempts: renders, explicitRetryClicks: 0 },
}, null, 2));
