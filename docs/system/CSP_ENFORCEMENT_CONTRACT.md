# CSP Enforcement Contract

## Scope and current state

Release H promotes the application document policy from observation to
browser enforcement without changing Next, React, Webpack, Reader, Viewer,
Share, PWA, Offline package v2, Dexie v1, PDF.js, or database schemas.

Until the Release H image is accepted in production:

```text
RELEASE_H = PARTIAL_PASS
CSP_LOCAL_CANDIDATE = PASS
CSP_PRODUCTION = PENDING
```

The production runtime therefore remains Release G with Report-Only CSP until
the immutable Release H deployment completes. This distinction prevents local
candidate evidence from being presented as production fact.

## Policy authority

`apps/web/next.config.mjs` is the one application-document CSP authority. Its
`headers()` result applies the same policy to Next documents and same-origin
static responses. The tracked Nginx configuration does not add another CSP.
Production acceptance must still inspect the raw public response because an
external gateway can append a second policy and multiple CSP headers intersect.

Two response types deliberately own narrower, purpose-specific policies:

- FastAPI attachment bytes use `default-src 'none'; sandbox`.
- `library-sw.js` synthetic offline-incomplete HTML uses a locked-down policy
  that permits only its inline style and same-origin retry navigation.

These are response hardening boundaries, not alternate application policy
generators.

## Resource graph

| Resource | Actual production source | Enforced allowance |
| --- | --- | --- |
| Next scripts | same-origin Webpack chunks plus two nonce-less Next/RSC inline bootstrap scripts | `script-src 'self' 'wasm-unsafe-eval'`; `script-src-elem 'self' 'unsafe-inline'` |
| Inline handlers | no product requirement | `script-src-attr 'none'` |
| Styles | same-origin CSS plus React layout/virtualization/drag/Viewer style attributes | `style-src 'self' 'unsafe-inline'` |
| API/RSC/Range | same-origin only; browser API base is `/api` | `connect-src 'self'` |
| Images | same-origin icons/attachments, Mermaid data SVG, Offline/complex Viewer blob URLs | `img-src 'self' data: blob:` |
| Fonts | same-origin emitted KaTeX fonts | `font-src 'self'` |
| Media | same-origin attachments and Offline blob URLs | `media-src 'self' blob:` |
| Workers | `/library-sw.js`, PDF.js, Offline Search, and complex Viewer emitted same-origin workers | `worker-src 'self'` |
| Manifest | `/library/manifest.webmanifest` | `manifest-src 'self'` |
| Frames/objects | no product resource | `frame-src 'none'`; `object-src 'none'` |
| Base/form/embed | no base element, same-origin product mutations, no embedding | `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'` |

`EXTERNAL_RUNTIME_ORIGINS = 0`. The Offline Cache Storage identity
`offline.chat-reader.local` is not a network origin and is not allowlisted.
There is no wildcard, broad `http:`/`https:`, external CDN, data script, blob
worker, or data font allowance.

## Enforced policy

The production application policy is:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
script-src-elem 'self' 'unsafe-inline';
script-src-attr 'none';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
media-src 'self' blob:;
connect-src 'self';
worker-src 'self';
manifest-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none'
```

`'unsafe-eval'` is absent in production. Development may add it within the
same policy generator for Next development tooling; production-build browser
tests assert it is absent from the actual response.

`'wasm-unsafe-eval'` is narrowly required by the existing Shiki Oniguruma
engine. The Reader test requires real highlighted token spans and zero CSP
violations. PDF.js remains `useWasm: false`, so this allowance is not a PDF
worker requirement.

## Strictness decision

Actual Next 16 production HTML contains two nonce-less inline bootstrap/RSC
scripts. Their request-dependent payload prevents a stable hash policy. The
Reader and Viewer also contain many legitimate runtime style attributes.
Removing these allowances would require a nonce propagation and cached PWA
HTML architecture track, or a broad UI style rewrite.

```text
CSP_SCRIPT_UNSAFE_INLINE = RETAINED_WITH_EVIDENCE (script elements only)
CSP_STYLE_UNSAFE_INLINE = RETAINED_WITH_EVIDENCE
STRICT_SCRIPT_CSP_STRATEGY = CURRENT_ARCHITECTURE_CONSTRAINED
STRICT_NONCE_CSP = DEFERRED_WITH_ARCHITECTURE_EVIDENCE
NEXT_EXPERIMENTAL_SRI = NOT_EXECUTED
TRUSTED_TYPES = NOT_EXECUTED
```

Because Next inline script elements remain allowed, CSP alone cannot claim to
block every directly constructed `javascript:` URL. User content remains
protected by the existing Markdown sanitizer/inert renderer, whose browser
fixture removes `javascript:` links, script elements, event handlers, remote
images, and unsafe inline SVG behavior. Accordingly:

```text
CSP_INLINE_INJECTION_BLOCK = POLICY_LIMITED
```

Inline event attributes are independently blocked by `script-src-attr 'none'`.

## Offline synthetic response

The Service Worker can synthesize a 503 page when the last complete shell is
not usable. That response carries:

```text
default-src 'none';
style-src 'unsafe-inline';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

It is not marked Offline-ready, contains no script, and exposes only a visible
same-origin reconnect link. The scoped PWA negative matrix asserts the status,
header, state, recovery, and previous-shell preservation in a real browser.

## Violation harness and privacy

`apps/web/e2e/csp-enforcement.spec.ts` runs against a production build and
starts an ephemeral loopback attack origin inside the test process. It adds no
application route, query switch, fault bridge, or production bundle marker.
The browser must block external script, connect, image, object, cross-origin
frame embedding, blob worker, and inline event handler attempts with
`securitypolicyviolation.disposition = enforce`; the controlled server must
receive no prohibited resource request.

Evidence records only directive, disposition, and the bounded URI classes
`same-origin`, `external-origin`, `blob`, `data`, or `inline`. It never stores a
raw path, Share token, query, filename, content, Cookie, or Authorization value.

The same suite proves legitimate same-origin, data-image, blob-image, inline
style, manifest, and Service Worker resources remain available. Rich Markdown,
PDF, Reader, Share, Source Editor, mutation, default PWA, and the Release E
negative matrix remain separate functional gates under the enforced header.

## Reporting

The current release uses browser enforcement evidence and structured test
artifacts. It does not add an unauthenticated reporting endpoint or persist raw
violation bodies.

```text
CSP_REPORT_ONLY_SHADOW = NOT_USED
CSP_SERVER_REPORTING = NOT_IMPLEMENTED
```

An identical Report-Only duplicate is intentionally removed to avoid duplicate
noise. A future shadow policy must be strictly narrower than the enforced
policy and must retain the privacy boundary above.

## Release and rollback

Release H follows the frozen immutable release contract:

```text
quality and zero-skip CSP/PWA gates
-> image build, inspect, manifest, archive SHA-256
-> verified PostgreSQL + imports/exports/offline/assets backup
-> immutable API_IMAGE/WEB_IMAGE binding
-> Alembic preflight
-> recreate --no-build
-> running image identity comparison
-> health, public header, and isolated-Chromium acceptance
```

Production acceptance requires exactly one effective application enforcing
policy, no unexplained legitimate-path violation, real Service Worker and PDF
worker behavior, KaTeX/Shiki/Viewer/Reader/Share operation, and a harmless
controlled blocked-resource probe. Release G immutable images and verified
backup remain the direct rollback source. No Alembic, Dexie, Offline package,
Next, React, PDF.js, or bundler migration is part of Release H.
