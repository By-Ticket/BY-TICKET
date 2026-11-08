import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <p className="text-7xl font-semibold tracking-tight">404</p>
      <h1 className="font-heading mt-4 text-2xl font-bold">This show isn&apos;t on the lineup</h1>
      <p className="text-muted-foreground mt-2">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Link href="/events" className={buttonVariants({ className: "mt-6 h-11 px-5" })}>
        Browse events
      </Link>
    </div>
  );
}
