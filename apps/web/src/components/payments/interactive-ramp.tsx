"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InteractiveRamp({
  url,
  status,
  message,
  onCancel,
}: {
  url: string;
  status: string;
  message: string;
  onCancel: () => void;
}) {
  const opened = useRef<Window | null>(null);

  useEffect(() => {
    if (!url) return;
    opened.current = window.open(url, "by-sep24", "popup,width=480,height=720");
    return () => {
      opened.current?.close();
    };
  }, [url]);

  const tone =
    status === "error" || status === "failed" || status === "refunded" || status === "expired"
      ? "text-destructive"
      : "text-muted-foreground";

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className={`text-sm ${tone}`}>{message}</p>
      {url ? (
        <iframe title="Anchor checkout" src={url} className="h-80 w-full rounded-lg border bg-background" />
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Waiting on the anchor…
        </p>
      )}
      <Button type="button" variant="ghost" className="h-8 px-3" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
