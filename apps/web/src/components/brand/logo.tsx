import { cn } from "@/lib/utils";

/** BY Tickets wordmark: ticket-stub mark + "BY" in the display face. */
export function Logo({ className, withTagline = false }: { className?: string; withTagline?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-8 shrink-0">
        <path
          d="M4 7a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v5a4 4 0 0 0 0 8v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a4 4 0 0 0 0-8z"
          fill="#131517"
        />
        <path d="M20 8v3M20 14.5v3M20 21v3" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
        <text x="7.5" y="20.5" fontSize="10" fontWeight="700" fill="#ffffff" fontFamily="Inter, system-ui">
          BY
        </text>
      </svg>
      <span className="flex flex-col leading-none">
        <span className="font-heading text-[17px] font-semibold tracking-tight">
          BY Tickets
        </span>
        {withTagline && <span className="text-muted-foreground text-[0.65rem] tracking-wide">Buy. Attend. Earn. Connect.</span>}
      </span>
    </span>
  );
}
