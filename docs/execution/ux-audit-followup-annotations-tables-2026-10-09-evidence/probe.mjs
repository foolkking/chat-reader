import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = 'E:/1project/chat-reader/';
const expectedCommit = 'f4719c96d3b2da4bcf2629872ed330ee50510142';
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(sourceCommit, expectedCommit, 'This checkpoint is exact-source, not a moving-HEAD audit');
const requireApp = createRequire(pathToFileURL(root + 'apps/web/package.json'));
const ts = requireApp('typescript');
const files = [
  'apps/web/features/annotations/annotation-workspace.tsx',
  'apps/web/lib/annotation-repository.ts',
  'apps/web/features/annotations/notebook-view.tsx',
  'apps/web/features/attachments/attachment-viewer.tsx',
  'apps/web/features/attachments/attachment-table-policy.ts',
  'apps/web/lib/api.ts',
];
const source = Object.fromEntries(files.map(file => {
  const disk = readFileSync(root + file);
  const committed = execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
  assert.equal(disk.toString('utf8').replace(/\r\n/g, '\n') === committed.replace(/\r\n/g, '\n'), true, `Uncommitted source other than checkout line endings: ${file}`);
  return [file, committed];
}));
const asts = Object.fromEntries(files.map(file => [file, ts.createSourceFile(file, source[file], ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)]));
function findNode(file, match) {
  let found;
  function visit(node) { if (!found && match(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(asts[file]); assert.ok(found, 'Missing production syntax'); return found;
}
const fn = (file, name) => findNode(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(asts[file]).replace(/^export\s+/, '');
function evaluate(code, names, bindings = {}) {
  const compiled = ts.transpileModule(code + '\nexport { ' + names.join(', ') + ' };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ...Object.keys(bindings), compiled)(module, module.exports, requireApp, ...Object.values(bindings));
  return module.exports;
}
const workspace = files[0], viewer = files[3], table = files[4];
const reloadNode = findNode(workspace, node => ts.isVariableDeclaration(node) && node.name.getText() === 'reload');
const reloadCode = 'const reload = ' + reloadNode.initializer.getText(asts[workspace]) + ';';
function bindReload(repository, published) {
  return evaluate(reloadCode, ['reload'], {
    useCallback: callback => callback, conversationId: 'synthetic-conversation', repository,
    setAnnotations: value => published.push(['annotations', value]),
    setNotebook: value => published.push(['notebook', value]),
    setNotebookConflicts: value => published.push(['conflicts', value]),
  }).reload;
}
const annotationFailures = [];
for (const failedPart of ['notebook', 'conflicts']) {
  const published = [];
  const reload = bindReload({
    list: async () => [{ id: 'synthetic-existing-annotation' }],
    getNotebook: async () => { if (failedPart === 'notebook') throw new Error('synthetic-notebook-read'); return { id: 'synthetic-notebook' }; },
    listNotebookConflicts: async () => { if (failedPart === 'conflicts') throw new Error('synthetic-conflict-read'); return []; },
  }, published);
  await assert.rejects(reload()); assert.equal(published.length, 0);
  annotationFailures.push({ failed_part: failedPart, successful_annotation_read_published: false, reload_rejected: true });
}
let resolveOlder;
const older = new Promise(resolve => { resolveOlder = resolve; });
let readNumber = 0;
const publications = [];
const reload = bindReload({ list: () => ++readNumber === 1 ? older : Promise.resolve([{ id: 'synthetic-newer' }]), getNotebook: async () => ({}), listNotebookConflicts: async () => [] }, publications);
const first = reload(); await reload(); resolveOlder([{ id: 'synthetic-older' }]); await first;
const order = publications.filter(([kind]) => kind === 'annotations').map(([, rows]) => rows[0].id);
assert.deepEqual(order, ['synthetic-newer', 'synthetic-older']);

const annotations = [
  { id: 'synthetic-visible', annotation_type: 'highlight' },
  { id: 'synthetic-hidden', annotation_type: 'highlight' },
];
const styleTargets = [], deleteTargets = [], notebookTargets = [], confirmations = [];
const bindings = {
  annotations, visibleAnnotations: [annotations[0]], selectedAnnotationIds: new Set(annotations.map(item => item.id)),
  notebook: { id: 'synthetic-notebook', blocks: [] }, batchType: 'underline', batchColor: 'green',
  repository: {
    update: async annotation => { styleTargets.push(annotation.id); },
    delete: async annotation => { deleteTargets.push(annotation.id); },
    saveNotebook: async (notebook, blocks) => { notebookTargets.push(...blocks.map(block => block.annotation_id)); return { ...notebook, blocks }; },
  },
  dialog: { confirm: async options => { confirmations.push(options.title); return true; } },
  setNotebook: () => {}, setView: () => {}, setSelectedAnnotationIds: () => {},
  setFocusedAnnotationId: () => {}, setContextAnnotation: () => {}, reload: async () => {},
  crypto: { randomUUID: () => 'synthetic-notebook-reference' },
};
const batch = evaluate(['applyBatchStyle', 'addSelectedToNotebook', 'deleteAnnotations'].map(name => fn(workspace, name)).join('\n'), ['applyBatchStyle', 'addSelectedToNotebook', 'deleteAnnotations'], bindings);
await batch.applyBatchStyle(); await batch.addSelectedToNotebook(); await batch.deleteAnnotations(bindings.selectedAnnotationIds);
assert.deepEqual(styleTargets, ['synthetic-visible', 'synthetic-hidden']);
assert.deepEqual(deleteTargets, styleTargets);
assert.deepEqual(notebookTargets, ['synthetic-visible']);
assert.deepEqual(confirmations, ['删除 2 条批注？']);

const { parseDelimitedRows } = evaluate(fn(table, 'parseDelimitedRows'), ['parseDelimitedRows']);
const wideRow = Array.from({ length: 257 }, (_, index) => 'field-' + index).join(',');
const wide = parseDelimitedRows(wideRow + '\n' + wideRow, ',');
const mixed = parseDelimitedRows(wideRow + '\nshort,value', ',');
assert.equal(wide.length, 0); assert.deepEqual(mixed, [['short', 'value']]);
const oversizedField = 'x'.repeat(65 * 1024);
const longField = parseDelimitedRows('field\n' + oversizedField, ',');
assert.equal(longField[1][0].length, 65 * 1024);
const { DelimitedTableViewer } = evaluate(fn(viewer, 'DelimitedTableViewer'), ['DelimitedTableViewer'], { useMemo: callback => callback(), parseDelimitedRows });
const smallRow = Array.from({ length: 64 }, (_, index) => 'cell-' + index).join(',');
const tree = DelimitedTableViewer({ text: Array.from({ length: 101 }, () => smallRow).join('\n'), delimiter: ',' });
const tags = {};
function visitTree(value) {
  if (Array.isArray(value)) { value.forEach(visitTree); return; }
  if (!value || typeof value !== 'object' || !value.props) return;
  if (typeof value.type === 'string') tags[value.type] = (tags[value.type] ?? 0) + 1;
  visitTree(value.props.children);
}
visitTree(tree); assert.equal(tags.td, 6400); assert.equal(tags.span, 6400);

class ApiRequestError extends Error { constructor(message, status, requestPath, code) { super(message); this.status = status; this.path = requestPath; this.code = code; } }
const { getApiRequestError } = evaluate(fn(files[5], 'getApiRequestError'), ['getApiRequestError'], { ApiRequestError, localizedImportError: () => null });
const genericError = await getApiRequestError(new Response(JSON.stringify({ detail: 'synthetic-private-upstream-detail' }), { status: 503 }), '/api/synthetic');
assert.equal(genericError.message, '服务暂时不可用，请稍后重试。');
assert.equal(genericError.message.includes('private'), false);

process.stdout.write(JSON.stringify({
  schema_version: 2, recorded_at_utc: new Date().toISOString(), source_commit: sourceCommit,
  scope: 'Read-only next-batch audit. Candidate production source is unchanged.',
  confidence: 'Observed extracted production callbacks, parser output and React element tree. No browser execution, real data, network request, CPU/RSS or rendered DOM measurement.',
  executed_source: 'Committed git blobs; worktree equality verified after CRLF/LF normalization only',
  source_matches_commit_after_checkout_line_endings: true,
  annotation_subread_failures: annotationFailures,
  overlapping_reload_publication_order: order,
  annotation_bulk_scope: { selection_count: 2, visible_selected_count: 1, style_targets: styleTargets, delete_targets: deleteTargets, note_targets: notebookTargets, confirmation_names_total_count: true, hidden_item_disclosure_in_confirmation: false },
  csv_over_256_columns: { all_wide_rows_returned: wide.length, wide_header_then_short_row_returned: mixed.length, short_data_row_becomes_first_row: true },
  csv_field_limit: { input_code_units: oversizedField.length, accepted_code_units: longField[1][0].length, nominal_64_KiB_field_limit_enforced: false },
  table_element_probe: { data_rows: 100, columns: 64, tags, extrapolated_max_data_cells_from_code_limits: 2560000, extrapolation_is_browser_measurement: false },
  generic_503_error: { fixed_chinese_message: true, upstream_detail_hidden: true },
  source_sha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(root + file)).digest('hex')])),
  executed_commit_blob_sha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(source[file]).digest('hex')])),
}, null, 2) + '\n');
