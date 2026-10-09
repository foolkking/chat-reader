import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.cwd());
const commit = '2f046f9fa2017e6c1d50833860b81f29896dbc60';
const working = process.argv.includes('--working');
const files = ['apps/web/features/attachments/attachment-viewer.tsx',
  'apps/web/features/attachments/pdf-viewer-policy.ts',
  'apps/web/features/attachments/complex-attachment-viewer.tsx',
  'apps/web/features/attachments/preview-adapter-registry.ts',
  'scripts/ux/attachment-reading.test.mjs'];
const sources = Object.fromEntries(files.map(file => [file, working ? readFileSync(path.join(root, file), 'utf8') :
  execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })]));
const readSource = (location, encoding) => sources[path.relative(root, location instanceof URL ? fileURLToPath(location) : location).replaceAll('\\', '/')] ?? readFileSync(location, encoding);
const testUrl = pathToFileURL(path.join(root, files[4]));
const header = sources[files[4]].split('test("PDF page canvas')[0]
  .replace(/^import .*;\r?$/gm, '').replaceAll(', import.meta.url', ', ' + JSON.stringify(testUrl.href));
const { fixture, policy, appRequire, flush } = new Function('assert', 'existsSync', 'readFileSync', 'createRequire', 'setImmediate',
  header + '\nreturn { fixture, policy, appRequire, flush };')(assert, existsSync, readSource, createRequire, setImmediate);
const noop = () => {};

const bridge = { opened: 0, closed: 0, oldCallback: 0, latestCallback: 0 };
let session;
const viewer = { open: value => { bridge.opened++; session = value; }, close: () => { bridge.closed++; const previous = session; session = null; previous?.onClosed?.(); } };
const bridgeProps = { attachment: { id: 'synthetic-preview' }, onClose: () => { bridge.oldCallback++; } };
const b = fixture('AttachmentPreviewDialog', bridgeProps, {}, { useAttachmentViewer: () => viewer, document: { activeElement: null }, HTMLElement: class {} });
b.render(); await b.runEffects();
bridgeProps.onClose = () => { bridge.latestCallback++; };
b.render(); await b.runEffects();
const callbackChurn = { ...bridge };
b.dispose();

const { Virtualizer } = appRequire('@tanstack/react-virtual');
const geometry = [];
for (const width of [375, 1267]) {
  let onScroll, virtualizer, nextFrame;
  const scrollport = { clientWidth: width, clientHeight: 730, scrollTop: 0, scrollHeight: 200000,
    addEventListener: (name, callback) => { if (name === 'scroll') onScroll = callback; }, removeEventListener: noop };
  const props = { documentProxy: { numPages: 120 }, currentPage: 90, scrollRequest: { page: 90 },
    onVisiblePageChange: page => { props.currentPage = page; }, fitMode: 'width', zoom: 1,
    containerWidth: width, containerHeight: 730, viewportRef: { current: scrollport },
    pageSizesRef: { current: new Map([[90, { width: 792, height: 612 }]]) }, renderQueue: policy.createPdfRenderQueue(), onPageSize: noop };
  const f = fixture('PdfPageList', props, {}, {
    useVirtualizer: options => {
      if (!virtualizer) {
        virtualizer = new Virtualizer({ ...options, initialRect: { width, height: 730 }, observeElementRect: noop, observeElementOffset: noop,
          scrollToFn: (offset, { adjustments = 0 }) => { scrollport.scrollTop = Math.round(offset + adjustments); virtualizer.scrollOffset = scrollport.scrollTop; } });
        virtualizer.scrollElement = scrollport;
        virtualizer.targetWindow = { requestAnimationFrame: callback => { nextFrame = callback; return 1; }, cancelAnimationFrame: noop };
      } else virtualizer.setOptions({ ...virtualizer.options, ...options });
      return virtualizer;
    },
  });
  const draw = async () => { f.render(); await f.runEffects(); f.render(); scrollport.scrollHeight = virtualizer.getTotalSize(); };
  const frame = () => { const callback = nextFrame; nextFrame = undefined; callback?.(); };
  try {
    for (let i = 0; i < 4; i++) { await draw(); frame(); }
    onScroll(); assert.equal(props.currentPage, 90);
    const before = { page: props.currentPage, offset: scrollport.scrollTop, target: virtualizer.getMeasurements()[89].start };
    props.fitMode = 'custom'; props.zoom = (width - 32) / 792 + 0.1; props.scrollRequest = { page: 90 };
    await draw();
    const afterMeasure = { offset: scrollport.scrollTop, target: virtualizer.getMeasurements()[89].start };
    // A native scroll event and scrollbar-induced ResizeObserver delivery can
    // arrive before Virtualizer's queued reconciliation frame.
    onScroll();
    const intermediatePage = props.currentPage;
    props.containerHeight = 715; scrollport.clientHeight = 715;
    for (let i = 0; i < 4; i++) { await draw(); frame(); onScroll(); }
    geometry.push({ width, before, afterMeasure, intermediatePage, finalPage: props.currentPage, finalOffset: scrollport.scrollTop });
  } finally { f.dispose(); }
}

const page = { getViewport: ({ scale }) => ({ width: 792 * scale, height: 612 * scale }), cleanup: noop,
  render: () => ({ promise: Promise.resolve(), cancel: noop }) };
const pageProps = { documentProxy: { getPage: async () => page }, pageNumber: 90, fitMode: 'width', zoom: 1,
  containerWidth: 375, containerHeight: 730, renderQueue: policy.createPdfRenderQueue() };
const p = fixture('PdfPage', pageProps);
let cssGeometry;
try {
  p.render(); await p.runEffects();
  const before = p.render().props.style;
  pageProps.fitMode = 'custom'; pageProps.zoom = 343 / 792 + 0.1;
  const duringQueuedRender = p.render().props.style;
  const expected = policy.pdfPageLayout({ width: 792, height: 612 }, { width: 375, height: 730 }, pageProps.fitMode, pageProps.zoom);
  cssGeometry = { before, duringQueuedRender, expected: { width: expected.width, height: expected.height } };
} finally { p.dispose(); await flush(); }

console.log(JSON.stringify({ schema_version: 1, source_commit: working ? 'working-tree' : commit,
  evidence: 'actual component source with explicit hook/DOM/PDF doubles and installed Virtualizer; no local browser or real pixels',
  source_sha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(sources[file]).digest('hex')])),
  callbackChurn, geometry, cssGeometry }, null, 2));
