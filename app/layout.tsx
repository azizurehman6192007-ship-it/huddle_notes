import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-bricolage",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter-tight",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Huddle",
  description: "Record your standup, get notes you can send.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Huddle", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#eff1f5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${interTight.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
