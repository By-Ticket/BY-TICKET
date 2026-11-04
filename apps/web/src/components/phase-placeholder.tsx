import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Temporary page body for routes whose features land in a later build phase. */
export function PhasePlaceholder({
  title,
  phase,
  icon: Icon,
  description,
  features,
}: {
  title: string;
  phase: number;
  icon: LucideIcon;
  description: string;
  features: string[];
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-5" aria-hidden />
        <h1 className="text-[28px] leading-8 font-semibold">{title}</h1>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{description}</CardTitle>
            <Badge variant="secondary">Phase {phase}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border border-t border-border">
            {features.map((f) => (
              <li key={f} className="text-muted-foreground py-3 text-[15px] leading-5">
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
