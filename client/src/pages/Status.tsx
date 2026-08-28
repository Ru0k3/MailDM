import { useEffect, useState } from "react";

type MaildmStatus = {
  service: string;
  status: "ready" | "setup_required";
  checks: Record<string, boolean>;
  generatedAt: string;
};

const label: Record<string, string> = {
  discordInteractions: "Discord interactions",
  gmailOAuth: "Gmail OAuth",
  credentialEncryption: "Credential encryption",
  scheduledDelivery: "Scheduled delivery",
};

export default function Status() {
  const [status, setStatus] = useState<MaildmStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/maildm/status", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("status unavailable")))
      .then(setStatus)
      .catch(() => setError(true));
  }, []);

  const stateLabel = error ? "Status unavailable" : status?.status === "ready" ? "All systems ready" : "Setup in progress";
  const stateDetail = error ? "The status endpoint could not be reached." : status?.status === "ready" ? "MailDM is prepared to receive interactions, connect Gmail, and deliver scheduled briefs." : "MailDM is online. A remaining integration setting must be completed before Gmail linking is active.";

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f1e9] px-5 text-[#21312b]">
      <section className="w-full max-w-2xl rounded-[2rem] border border-[#20312c]/10 bg-[#fdfbf6] p-7 shadow-[0_24px_70px_rgba(33,52,45,0.12)] sm:p-12">
        <a className="inline-flex items-center gap-3 text-sm font-extrabold tracking-[-0.03em]" href="/"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#20312c] font-['Playfair_Display'] text-lg text-[#fdfbf6]">M</span> MailDM</a>
        <div className="mt-12 flex items-start justify-between gap-5">
          <div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[0.16em] text-[#668271]">System status</p><h1 className="mt-3 font-['Playfair_Display'] text-4xl tracking-[-0.05em] sm:text-5xl">{stateLabel}</h1></div>
          <span className={`mt-2 h-3 w-3 rounded-full ${status?.status === "ready" ? "bg-[#64a274]" : "bg-[#d4a651]"}`} />
        </div>
        <p className="mt-5 max-w-xl text-[15px] leading-7 text-[#607069]">{stateDetail}</p>
        <div className="mt-10 grid overflow-hidden rounded-2xl border border-[#20312c]/10 sm:grid-cols-2">
          {Object.entries(status?.checks ?? { discordInteractions: false, gmailOAuth: false, credentialEncryption: false, scheduledDelivery: false }).map(([key, healthy]) => (
            <div className="flex items-center justify-between border-b border-[#20312c]/10 px-5 py-4 last:border-b-0 even:sm:border-l sm:nth-[3]:border-b-0" key={key}>
              <span className="text-sm font-semibold">{label[key] ?? key}</span><span className={`font-['DM_Mono'] text-[10px] uppercase tracking-[0.12em] ${healthy ? "text-[#3c7d53]" : "text-[#a07b34]"}`}>{healthy ? "Ready" : "Awaiting"}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 font-['DM_Mono'] text-[10px] text-[#7e8b84]">{status ? `Last checked ${new Date(status.generatedAt).toLocaleString()}` : "Checking configuration…"}</p>
      </section>
    </main>
  );
}
