import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClaGames — Instant Play, No Download",
  description:
    "Play casual browser games instantly — no installs, no app store. Match-3 and endless runner, mobile-first and tuned for low-end Android.",
  applicationName: "ClaGames",
  keywords: [
    "play games online",
    "free browser games",
    "match 3",
    "endless runner",
    "no download games",
    "casual games",
    "html5 games",
  ],
  authors: [{ name: "ClaGames" }],
  openGraph: {
    title: "ClaGames — Instant Play, No Download",
    description:
      "Play casual browser games instantly — no installs. Mobile-first, works on low-end Android.",
    type: "website",
  },
  manifest: "/manifest.webmanifest",
};

// Mobile-first: lock zoom and scaling so games feel native on touch screens.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b1020",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
