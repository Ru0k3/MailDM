import { Check, ShieldAlert } from "lucide-react";

export default function OAuthResult({ outcome }: { outcome: "success" | "error" }) {
  const success = outcome === "success";
  const title = success ? "Gmail is connected." : "The connection did not complete.";
  const copy = success
    ? "You can close this window and return to Discord. MailDM will confirm the linked account privately."
    : "No Gmail access was saved. Return to Discord and use /connect gmail to try again.";

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f1e9] px-5 text-[#21312b]">
      <div className="w-full max-w-lg rounded-[2rem] border border-[#20312c]/10 bg-[#fdfbf6] p-8 shadow-[0_24px_70px_rgba(33,52,45,0.12)] sm:p-12">
        <div className={`grid h-14 w-14 place-items-center rounded-full ${success ? "bg-[#dce9df] text-[#2d674c]" : "bg-[#f5e1dc] text-[#9d3d2f]"}`}>
          {success ? <Check size={28} strokeWidth={2.2} /> : <ShieldAlert size={27} strokeWidth={2.2} />}
        </div>
        <p className="mt-8 font-['DM_Mono'] text-[10px] uppercase tracking-[0.17em] text-[#6c887a]">MailDM · secure connection</p>
        <h1 className="mt-3 font-['Playfair_Display'] text-4xl tracking-[-0.05em] sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-md text-[15px] leading-7 text-[#607069]">{copy}</p>
        <div className="mt-8 rounded-xl border border-[#20312c]/10 bg-[#f4f1ea] px-4 py-3 font-['DM_Mono'] text-[10px] leading-5 text-[#61726a]">
          {success ? "Gmail access is read-only. MailDM cannot send, delete, archive, label, or mark your messages as read." : "For your protection, expired or already-used connection links are rejected."}
        </div>
        <a className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2f5848] underline decoration-[#9abbab] underline-offset-4 hover:text-[#183f30]" href="/">
          Return to MailDM <span aria-hidden="true">→</span>
        </a>
      </div>
    </main>
  );
}
