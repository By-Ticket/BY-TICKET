import Link from "next/link";
import { BadgeCheck, Gift, ScanLine, ShieldCheck, Ticket, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const pillars = [
  { word: "Buy.", text: "Pay in USDC or XLM, see prices in Kwacha.", icon: Ticket },
  { word: "Attend.", text: "Rotating QR tickets that can't be screenshotted.", icon: ScanLine },
  { word: "Earn.", text: "BY Points on every ticket and every check-in.", icon: Gift },
  { word: "Connect.", text: "Proof-of-attendance badges for real fans.", icon: Users },
];

const trust = [
  { icon: ShieldCheck, text: "No oversold shows — capacity is enforced on-chain." },
  { icon: BadgeCheck, text: "Resale caps set by organizers stop scalpers." },
  { icon: ScanLine, text: "Scanners keep working when the network drops." },
];

export default function HomePage() {
  return (
    <div>
      <section className="border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-8 md:py-16">
          <p className="text-muted-foreground mb-2 text-[13px] font-medium">
            Lusaka · Kitwe · Ndola · Livingstone · and beyond
          </p>
          <h1 className="font-heading max-w-3xl text-[32px] leading-9 font-semibold md:text-5xl md:leading-none">
            Tickets for the culture.
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-[17px] leading-6">
            Gigs, festivals, comedy nights, church conferences and pop-ups. Real tickets, verified on Stellar, with
            rewards every time you show up.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/events" className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-xl px-4 text-[15px] font-semibold")}>
              Find events
            </Link>
            <Link
              href="/organizer"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11 rounded-xl px-4 text-[15px] font-semibold")}
            >
              Sell tickets
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-4">
        <ul className="divide-y divide-border border-y border-border">
          {pillars.map(({ word, text, icon: Icon }) => (
            <li key={word} className="flex items-start gap-4 py-4">
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <h2 className="text-[17px] leading-6 font-semibold">{word}</h2>
                <p className="text-muted-foreground mt-1 text-[15px] leading-5">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-2 pb-8">
        <ul className="space-y-3">
          {trust.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-[15px] leading-5">
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
