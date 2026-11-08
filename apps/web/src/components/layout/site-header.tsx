import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { stellarConfig } from "@/lib/stellar/config";
import { AccountButton } from "./account-button";
import { customerNav, staffNav } from "./nav-items";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" aria-label="BY Tickets home">
          <Logo />
        </Link>
        {stellarConfig.isTestnet && (
          <Badge variant="secondary" className="bg-sun/40 text-night border-transparent font-semibold">
            Testnet
          </Badge>
        )}
        <nav className="ml-auto hidden items-center gap-1 text-sm md:flex" aria-label="Main">
          {[...customerNav.slice(1), ...staffNav].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full px-3 py-2 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto md:ml-2">
          <AccountButton />
        </div>
      </div>
    </header>
  );
}
