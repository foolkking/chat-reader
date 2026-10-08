// Read-only, synthetic evidence against the accepted source, not the live app.
// Run from the repository root with: node <this file>
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const appRequire = createRequire(path.join(root, 'apps/web/package.json'));
const ts = appRequire('typescript');
const source = '30a0d321fe2d538b0fa0bbd61b3e982452f822cb';

function loadAcceptedModule(filename) {
  const input = execFileSync('git', ['show', `${source}:${filename}`], { cwd: root, encoding: 'utf8' });
  const compiled = ts.transpileModule(input, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  // Only the pure exported helpers are called. No component is rendered.
  const requireStub = (name) => {
    if (name === 'next/link') return {};
    if (name.endsWith('/preferences-provider')) return {};
    return appRequire(name);
  };
  new Function('require', 'module', 'exports', compiled)(requireStub, module, module.exports);
  return module.exports;
}

async function main() {
  const { runBatchSelection } = loadAcceptedModule('apps/web/lib/batch-selection.ts');
  const batch = await runBatchSelection(['synthetic-a', 'synthetic-b'], async (id) => {
    if (id === 'synthetic-b') throw new Error('Synthetic unavailable');
  });
  assert.deepEqual(batch, { succeededIds: ['synthetic-a'], failedIds: ['synthetic-b'] });

  const { orderSearchResults } = loadAcceptedModule('apps/web/features/search/search-results.tsx');
  const before = [{ document_id: 'synthetic-message', document_type: 'message' }];
  const laterPage = [{ document_id: 'synthetic-annotation', document_type: 'annotation' }];
  const activeIndex = 0;
  const selectedBefore = orderSearchResults(before)[activeIndex].document_id;
  const selectedAfter = orderSearchResults([...before, ...laterPage])[activeIndex].document_id;
  assert.notEqual(selectedBefore, selectedAfter);

  const { QueryClient, QueryObserver } = appRequire('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let rejectRead = false;
  const observer = new QueryObserver(client, {
    queryKey: ['synthetic-recent'],
    queryFn: async () => {
      if (rejectRead) throw new Error('Synthetic unavailable');
      return [{ id: 'synthetic-recent' }];
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  rejectRead = true;
  await observer.refetch();
  const state = observer.getCurrentResult();
  assert.equal(state.isError, true);
  assert.equal(state.data.length, 1);
  unsubscribe();
  client.clear();

  console.log(JSON.stringify({
    source,
    evidence_kind: 'synthetic pure-helper and QueryObserver execution; no browser',
    batch_resolves_with_failed_items: batch,
    grouped_pagination_changes_index_target: { activeIndex, selectedBefore, selectedAfter },
    failed_background_read_retains_cached_data: { isError: state.isError, retainedRows: state.data.length },
    checks_passed: 3,
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
