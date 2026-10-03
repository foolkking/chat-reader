"""Writer-side continuation maintenance runtime.

Depends on the shared read-only `_context_package` runtime and must never
redefine Canonical Raw parsing or continuation fingerprint semantics.
"""

RUNTIME_NAME = "chat-reader-continuation-maintenance-runtime"
RUNTIME_VERSION = "1.0.0"
