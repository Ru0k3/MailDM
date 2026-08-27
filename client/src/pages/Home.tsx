export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f5f1e9] text-[#1e2926]">
      <div className="pointer-events-none fixed inset-0 -z-0 opacity-[0.38] [background-image:linear-gradient(rgba(52,69,62,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(52,69,62,0.07)_1px,transparent_1px)] [background-size:52px_52px]" />
      <main className="relative z-10 mx-auto max-w-[1440px] px-5 pb-8 pt-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-[#1e2926]/15 pb-5">
          <a aria-label="MailDM home" className="group flex items-center gap-3" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#1e2926] font-['Playfair_Display'] text-xl text-[#f7f4ed] transition-transform duration-200 group-hover:scale-105">M</span>
            <span className="text-sm font-extrabold tracking-[-0.03em]">MailDM</span>
          </a>
          <a className="hidden items-center gap-2 font-['DM_Mono'] text-[10px] uppercase tracking-[0.16em] text-[#53635d] transition-colors hover:text-[#1e2926] sm:flex" href="/status"><span className="h-2 w-2 rounded-full bg-[#80a694]" /> Gmail preview · read only</a>
          <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[0.14em] text-[#53635d] sm:hidden">Private brief</span>
        </header>

        <section className="grid min-h-[610px] items-center gap-12 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20 lg:py-20">
          <div className="max-w-2xl">
            <p className="mb-6 flex items-center gap-2 font-['DM_Mono'] text-[10px] uppercase tracking-[0.16em] text-[#52645c]"><span className="h-px w-8 bg-[#52645c]" /> A quieter way to start</p>
            <h1 className="max-w-[760px] font-['Playfair_Display'] text-[clamp(3.4rem,8vw,7.2rem)] leading-[0.91] tracking-[-0.065em] text-[#1d2925]">Your unread mail,<br /><em className="font-normal text-[#6d8f7f]">distilled.</em></h1>
            <p className="mt-8 max-w-lg text-base leading-7 text-[#53635d] sm:text-lg">MailDM gathers only your unread Gmail messages, finds the signal, and delivers a considered daily brief straight to Discord.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-[#1f302b] px-6 text-sm font-bold text-[#fbf7ee] transition duration-200 hover:-translate-y-0.5 hover:bg-[#31473f] focus:outline-none focus:ring-2 focus:ring-[#1f302b] focus:ring-offset-2" href="#start">Start in Discord <span aria-hidden="true">↗</span></a>
              <a className="inline-flex h-12 items-center justify-center rounded-full border border-[#2d4039]/20 px-6 text-sm font-semibold text-[#304139] transition-colors hover:border-[#2d4039]/50 hover:bg-white/50" href="#how-it-works">How it works</a>
            </div>
            <p className="mt-5 font-['DM_Mono'] text-[10px] leading-5 text-[#73827a]">Read-only Gmail access · Your AI key stays yours · No inbox changes</p>
          </div>

          <div className="relative mx-auto w-full max-w-[520px] lg:mx-0 lg:justify-self-end">
            <div className="absolute -left-5 top-[13%] hidden h-28 w-28 rounded-full border border-[#92ae9d]/60 lg:block" />
            <div className="absolute -right-5 bottom-[9%] h-28 w-28 rounded-[2rem] bg-[#dce6d7] sm:h-36 sm:w-36" />
            <div className="relative rounded-[2rem] border border-white/80 bg-[#fdfbf6]/85 p-3 shadow-[0_24px_70px_rgba(33,52,45,0.12)] backdrop-blur-sm sm:p-4">
              <div className="rounded-[1.45rem] bg-[#20312c] p-5 text-[#f6f1e7] sm:p-6">
                <div className="flex items-center justify-between border-b border-white/15 pb-4"><div><p className="font-['DM_Mono'] text-[9px] uppercase tracking-[0.18em] text-[#b7c8bd]">MailDM · daily brief</p><p className="mt-1 text-sm font-bold">Good morning, Alex.</p></div><span className="grid h-8 w-8 place-items-center rounded-full border border-white/15 font-['Playfair_Display'] text-sm">M</span></div>
                <div className="py-5"><p className="text-lg font-bold tracking-[-0.03em]">3 things worth your attention</p><p className="mt-1 text-xs leading-5 text-[#bdccc2]">A sample view only. Your data stays private.</p></div>
                <div className="space-y-3">{[["01", "Time-sensitive", "A deadline is approaching in your work inbox."], ["02", "Needs a reply", "A conversation is waiting for your decision."], ["03", "Worth reading", "One update has useful context for today."]].map(([number, title, detail]) => <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-3.5" key={number}><span className="font-['DM_Mono'] text-[10px] text-[#91af9f]">{number}</span><div><p className="text-xs font-bold">{title}</p><p className="mt-1 text-[11px] leading-4 text-[#b7c8bd]">{detail}</p></div></div>)}</div>
                <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4 font-['DM_Mono'] text-[9px] uppercase tracking-[0.12em] text-[#b7c8bd]"><span>08:00 · your time</span><span>Delivered by DM</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-[1.5rem] border border-[#1d2925]/15 bg-[#1d2925]/15 md:grid-cols-3" id="how-it-works">
          {[["01", "Connect Gmail", "Approve strictly read-only access for one or more accounts."], ["02", "Choose your intelligence", "Bring your own API key and select a recommended model."], ["03", "Receive the signal", "Set your local time. A concise brief arrives in Discord DM."]].map(([number, title, detail]) => <article className="bg-[#f7f4ed] p-7 sm:p-8" key={number}><p className="font-['DM_Mono'] text-[10px] tracking-[0.18em] text-[#7a9a8b]">{number}</p><h2 className="mt-10 text-lg font-extrabold tracking-[-0.035em] text-[#24342e]">{title}</h2><p className="mt-2 max-w-[270px] text-sm leading-6 text-[#62716a]">{detail}</p></article>)}
        </section>

        <section className="mt-5 grid gap-5 rounded-[1.5rem] bg-[#dce6d7] px-7 py-8 sm:px-10 lg:grid-cols-[1fr_auto] lg:items-center" id="start"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[0.16em] text-[#638372]">Ready when you are</p><h2 className="mt-3 font-['Playfair_Display'] text-3xl tracking-[-0.045em] text-[#273a33] sm:text-4xl">Open Discord. Type <span className="rounded-lg bg-[#f5f1e9] px-2 py-1 font-['DM_Mono'] text-lg">/start</span>.</h2></div><p className="max-w-sm text-sm leading-6 text-[#52645c]">MailDM will guide account linking, AI setup, and your daily delivery time privately.</p></section>
        <footer className="flex flex-col gap-3 px-1 py-8 font-['DM_Mono'] text-[10px] uppercase tracking-[0.12em] text-[#78867e] sm:flex-row sm:items-center sm:justify-between"><span>MailDM · Gmail first</span><span>Private by design · Read only</span></footer>
      </main>
    </div>
  );
}
