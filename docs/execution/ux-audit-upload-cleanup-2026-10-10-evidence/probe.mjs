import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = 'E:/1project/chat-reader';
const commit = '96b31b011a7ad161f2b98f39f409ef39caf399b3';
const file = 'apps/web/e2e/attachment-upload-flow.spec.ts';
const source = execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8' });
const requireApp = createRequire(root + '/apps/web/package.json');
const ts = requireApp('typescript');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'deleteConversation');
assert.ok(fn);
const compiled = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const cleanup = new Function('expect', compiled + '\nreturn deleteConversation;')(value => ({ toBe: expected => assert.equal(value, expected) }));
async function probe(priorFailure) {
  const calls = [];
  const transport = new Error('apiRequestContext.delete: read ECONNRESET');
  const business = new Error('Synthetic prior business assertion');
  const request = {
    delete: async () => { calls.push('DELETE'); throw transport; },
    get: async () => { calls.push('GET'); return { status: () => 404 }; },
  };
  let observed;
  try {
    if (priorFailure) {
      try { throw business; } finally { await cleanup(request, 'synthetic-cleanup-conversation'); }
    } else await cleanup(request, 'synthetic-cleanup-conversation');
  } catch (error) { observed = error; }
  assert.equal(observed, transport);
  assert.deepEqual(calls, ['DELETE']);
  return { prior_business_failure: priorFailure, calls, read_back_performed: false,
    cleanup_rejected_despite_available_404: true, prior_failure_masked: priorFailure };
}
console.log(JSON.stringify({ source_sha: commit, source_file: file,
  source_blob_sha256: createHash('sha256').update(source).digest('hex'),
  executed: 'Frozen committed E2E cleanup function with explicit transport doubles; no browser, API, production data or network.',
  cases: [await probe(false), await probe(true)],
}, null, 2));
