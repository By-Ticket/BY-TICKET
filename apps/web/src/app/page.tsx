import Link from "next/link";
import { BadgeCheck, Gift, ScanLine, ShieldCheck, Ticket, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const pillars = [
  { word: "Buy.", text: "Pay in USDC or XLM, see prices in Kwacha.", icon: Ticket, tone: "bg-sun/30 text-night" },
  { word: "Attend.", text: "Rotating QR tickets that can't be screenshotted.", icon: ScanLine, tone: "bg-copper/20 text-copper" },
  { word: "Earn.", text: "BY Points on every ticket and every check-in.", icon: Gift, tone: "bg-hibiscus/15 text-hibiscus" },
  { word: "Connect.", text: "Proof-of-attendance badges for real fans.", icon: Users, tone: "bg-emerald/15 text-emerald" },
];

const trust = [
  { icon: ShieldCheck, text: "No oversold shows — capacity is enforced on-chain." },
  { icon: BadgeCheck, text: "Resale caps set by organizers stop scalpers." },
  { icon: ScanLine, text: "Scanners keep working when the network drops." },
];

export default function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-night text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_10%_-20%,rgb(255_200_61_/_0.45),transparent_55%),radial-gradient(700px_380px_at_100%_10%,rgb(226_54_107_/_0.4),transparent_50%)]"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-12 md:py-20">
          <p className="mb-3 text-[13px] font-medium tracking-wide text-sun">
            Lusaka · Kitwe · Ndola · Livingstone · and beyond
          </p>
          <h1 className="font-heading max-w-3xl text-[34px] leading-9 font-bold md:text-6xl md:leading-none">
            Tickets for the <span className="text-brand">culture</span>.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-6 text-white/80">
            Gigs, festivals, comedy nights, church conferences and pop-ups. Real tickets, verified on Stellar, with
            rewards every time you show up.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/events" className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-2xl px-5 text-[15px] font-semibold")}>
              Find events
            </Link>
            <Link
              href="/organizer"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "h-12 rounded-2xl border-white/25 bg-white/10 px-5 text-[15px] font-semibold text-white hover:bg-white/20 hover:text-white",
              )}
            >
              Sell tickets
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-8">
        <ul className="grid gap-3 sm:grid-cols-2">
          {pillars.map(({ word, text, icon: Icon, tone }) => (
            <li key={word} className="shadow-soft rounded-2xl border border-border bg-card p-4">
              <span className={cn("mb-3 inline-flex size-10 items-center justify-center rounded-xl", tone)}>
                <Icon className="size-5" aria-hidden />
              </span>
              <h2 className="text-[17px] leading-6 font-semibold">{word}</h2>
              <p className="text-muted-foreground mt-1 text-[15px] leading-5">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-2 pb-10">
        <ul className="space-y-3">
          {trust.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-[15px] leading-5">
              <Icon className="mt-0.5 size-5 shrink-0 text-hibiscus" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
