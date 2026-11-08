import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Toaster } from "@/components/ui/sonner";
import { publicEnv } from "@/lib/env";
import "./globals.css";

// next/font self-hosts fonts at build time: no runtime requests to Google, and
// `display: swap` keeps text readable while fonts load on slow networks.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: {
    default: "BY Tickets — Buy. Attend. Earn. Connect.",
    template: "%s · BY Tickets",
  },
  description:
    "Blockchain-verified event tickets and rewards for Zambia and Africa's creative scene. Built on Stellar.",
  applicationName: "BY Tickets",
  appleWebApp: { capable: true, title: "BY Tickets", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <BottomNav />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
