export default function ConversationLoading() {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f7f7f8]">
      <aside className="hidden w-[268px] shrink-0 border-r border-[#e5e5e5] bg-[#f9f9f9] md:block" />
      <section className="min-w-0 flex-1">
        <div className="h-0.5 w-1/4 bg-[#10a37f]" />
        <div className="mx-auto max-w-3xl animate-pulse space-y-10 px-4 py-20 md:px-8">
          <div className="h-5 w-48 rounded bg-[#e5e7eb]" />
          <div className="ml-auto h-28 w-full rounded-2xl bg-[#ececeb] sm:w-2/3" />
          <div className="space-y-3"><div className="h-4 w-full rounded bg-[#e5e7eb]" /><div className="h-4 w-5/6 rounded bg-[#e5e7eb]" /><div className="h-4 w-3/4 rounded bg-[#e5e7eb]" /></div>
        </div>
      </section>
    </main>
  );
}
