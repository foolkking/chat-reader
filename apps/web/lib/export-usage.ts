import { ApiRequestError, exportArtifactApi, type ExportArtifactStatus } from "./api";
import { authenticationGeneration } from "./offline-access";

// Scope owners signal actual closure. React disposal, resize, blur and hiding
// only detach the observer; none of those is permission to reclaim a file.
const sessions = new Set<ExportUsage>();
export function releaseExportScope(scope: string) {
  for (const session of sessions) if (session.scope === scope) session.close();
}
export function releaseExportRoute(pathname: string) {
  for (const session of sessions) if (session.pathname === pathname) session.close();
}
export type ExportUsageState = { status: ExportArtifactStatus | null; error: boolean };

export class ExportUsage {
  readonly generation = authenticationGeneration();
  readonly sessionId = crypto.randomUUID();
  readonly pathname = window.location.pathname;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private observer?: (value: ExportUsageState) => void;
  private poll?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private retirement: ReturnType<typeof setTimeout>;
  state: ExportUsageState = { status: null, error: false };

  constructor(readonly artifactId: string, readonly scope: string) {
    sessions.add(this);
    // Dormant entries survive responsive remounts until explicit scope/route
    // departure. This cap exceeds the maximum configured lifetime, not the lease.
    this.retirement = setTimeout(() => this.dispose(), 61 * 60_000);
  }
  private valid() { return this.generation === authenticationGeneration(); }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(() => {
      if (!this.valid()) throw new Error("Account changed");
      return work();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  private publish(status: ExportArtifactStatus) {
    if (!this.valid() || this.closed) return;
    this.state = { status, error: false };
    this.observer?.(this.state);
    clearTimeout(this.expiry);
    if (status.status === "available") {
      const remaining = Date.parse(status.expires_at) - Date.parse(status.server_now);
      this.expiry = setTimeout(() => {
        if (!this.valid() || this.closed) return;
        this.state = { status: { ...status, status: "expired", download_url: null }, error: false };
        this.observer?.(this.state);
      }, Math.max(0, Math.min(remaining, 2_147_483_647)));
    }
  }
  observe(observer: (value: ExportUsageState) => void) {
    this.observer = observer;
    observer(this.state);
    void this.refresh();
    return () => { this.observer = undefined; clearTimeout(this.poll); };
  }
  async refresh() {
    clearTimeout(this.poll);
    if (this.closed || !this.valid()) return;
    try {
      const status = await this.enqueue(async () => {
        try { return await exportArtifactApi.usage(this.artifactId, this.sessionId); }
        catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 410) throw error;
          return exportArtifactApi.status(this.artifactId);
        }
      });
      this.publish(status);
    } catch {
      if (this.valid() && !this.closed) { this.state = { ...this.state, error: true }; this.observer?.(this.state); }
    }
    if (!this.closed && this.observer && this.valid() && (!this.state.status || this.state.status.status === "available")) {
      this.poll = setTimeout(() => void this.refresh(), 20_000);
    }
  }
  download() {
    if (this.closed) return Promise.reject(new Error("Export closed"));
    // Enqueue synchronously on the click, before any close event. Release waits
    // for the claim and dispatch; a claimed transfer survives closing the panel.
    return this.enqueue(async () => {
      const claim = await exportArtifactApi.claim(this.artifactId, crypto.randomUUID());
      if (!this.valid()) return;
      const link = document.createElement("a");
      link.href = claim.download_url;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispose();
    void this.enqueue(() => exportArtifactApi.release(this.artifactId, this.sessionId)).catch(() => undefined);
  }
  private dispose() {
    clearTimeout(this.poll); clearTimeout(this.expiry); clearTimeout(this.retirement);
    this.observer = undefined;
    sessions.delete(this);
  }
}
