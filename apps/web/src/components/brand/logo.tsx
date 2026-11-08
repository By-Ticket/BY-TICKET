import { useId } from "react";
import { cn } from "@/lib/utils";

/** Colorful ticket stub used in the header, matching /icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc83d" />
          <stop offset="0.5" stopColor="#f0782a" />
          <stop offset="1" stopColor="#e2366b" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#1a1220" />
      <path
        d="M6 9.4a2.5 2.5 0 0 1 2.5-2.5h15a2.5 2.5 0 0 1 2.5 2.5v4.1a2.5 2.5 0 0 0 0 5v4.1a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 22.6v-4.1a2.5 2.5 0 0 0 0-5z"
        fill={`url(#${gid})`}
      />
      <path d="M21.2 9.2v2.4M21.2 14.8v2.4M21.2 20.4v2.4" stroke="#1a1220" strokeWidth="1.6" strokeLinecap="round" />
      <text x="8" y="20.6" fontSize="8.5" fontWeight="800" fill="#1a1220" fontFamily="ui-sans-serif, system-ui">
        BY
      </text>
    </svg>
  );
}

/** BY Tickets wordmark: ticket-stub mark + "BY Tickets" in the display face. */
export function Logo({ className, withTagline = false }: { className?: string; withTagline?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="font-heading text-[17px] font-bold tracking-tight">BY Tickets</span>
        {withTagline && (
          <span className="text-muted-foreground text-[0.65rem] tracking-wide">Buy. Attend. Earn. Connect.</span>
        )}
      </span>
    </span>
  );
}
