"use client";

import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../../components/preferences-provider";
import { readAuthSession } from "../../../lib/auth-client";

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
type ProjectRequest = { owner: string, device: string, state: string, name: string };
type Status = "loading" | "ready" | "invalid" | "account" | "conflict" | "uncertain" | "saving";

export default function ImportProjectPage() {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const [request, setRequest] = useState<ProjectRequest | null>(null);
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.hash.slice(1));
    const read = (key: string) => params.get(key) ?? "";
    const draft = { owner: read("owner"), device: read("device"), state: read("state"), name: read("name").trim() };
    if (![draft.owner, draft.device, draft.state].every(value => uuid.test(value))
      || !draft.name || [...draft.name].length > 120) {
      setStatus("invalid");
      return;
    }
    setRequest(draft);
    readAuthSession(controller.signal).then(session => {
      if (controller.signal.aborted) return;
      setAccount(session.display_name || session.email || "Reader");
      setStatus(session.authenticated && session.user_id === draft.owner ? "ready" : "account");
    }).catch(() => { if (!controller.signal.aborted) setStatus("account"); });
    return () => controller.abort();
  }, []);

  async function confirm() {
    if (!request || submitting.current || status !== "ready") return;
    submitting.current = true;
    setStatus("saving");
    try {
      const res = await fetch("/api/extension-devices/import-project", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: request.name, expected_user_id: request.owner, device_id: request.device }),
      });
      if (res.status === 401 || res.status === 403) { setStatus("account"); return; }
      if (res.status === 409) { setStatus("conflict"); return; }
      if (!res.ok) throw Error();
      const result = await res.json();
      if (!uuid.test(result.id) || !/^[a-p]{32}$/.test(result.client)) throw Error();
      const callback = new URL(`https://${result.client}.chromiumapp.org/reader-project`);
      callback.hash = new URLSearchParams({ state: request.state, project: result.id }).toString();
      window.location.replace(callback.href);
    } catch {
      setStatus("uncertain");
    } finally {
      submitting.current = false;
    }
  }

  const messages = {
    loading: zh ? "正在核对 Reader 账号…" : "Checking your Reader account…",
    invalid: zh ? "请关闭此窗口，回到导入页重新打开项目确认。" : "Close this window and reopen project confirmation from the import.",
    account: zh ? "请在 Reader 登录插件连接的账号，再从导入页重试。" : "Sign in to Reader with the account connected to the extension, then reopen this step.",
    conflict: zh ? "此名称已用于归档项目或默认项目。可在 Reader 恢复归档项目，或回到导入页选择其他目标。" : "An archived or default project uses this name. Restore the archived project in Reader or choose another destination in the import.",
    uncertain: zh ? "未收到确认，项目可能已创建。请关闭此窗口，在导入页刷新项目后核对名称。" : "Confirmation was lost; the project may already exist. Close this window and refresh projects in the import to check the name.",
    saving: zh ? "正在确认项目…" : "Confirming project…",
    ready: "",
  };
  return <main className="mx-auto max-w-md space-y-4 px-4 py-8 text-primary">
    <h1 className="text-lg font-semibold">{zh ? "在 Reader 中新建项目" : "Create a project in Reader"}</h1>
    {account && <p className="break-words text-sm text-secondary">{account}</p>}
    {request && !["loading", "account", "invalid"].includes(status) && <p className="break-words font-medium">{request.name}</p>}
    {status === "ready" && <p className="text-sm">{zh ? "若已有同名活动项目，将选用它。确认后返回导入页。" : "An existing active project with this name will be used. Confirmation returns you to the import."}</p>}
    <p role="status" className="text-sm">{messages[status]}</p>
    <div className="flex flex-wrap gap-2">
      {(status === "ready" || status === "saving") && <button className="btn-primary min-h-11 px-4" disabled={status === "saving"} onClick={confirm}>
        {zh ? "确认并返回导入" : "Confirm and return to import"}
      </button>}
      <button className="btn-secondary min-h-11 px-4" disabled={status === "saving"} onClick={() => window.close()}>{zh ? "关闭窗口" : "Close window"}</button>
    </div>
  </main>;
}
