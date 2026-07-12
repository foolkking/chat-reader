export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4 text-[#111827]">
      <section className="w-full max-w-md rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#10a37f] text-sm font-semibold text-white">
            cr
          </span>
          <div>
            <h1 className="text-lg font-semibold">当前处于离线状态</h1>
            <p className="text-sm text-[#6b7280]">重新连接后即可继续访问会话资料库。</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-[#4b5563]">
          为保护私有内容，chat-reader 不会在浏览器离线缓存中保存会话正文、分享数据或 API 响应。
        </p>
      </section>
    </main>
  );
}
