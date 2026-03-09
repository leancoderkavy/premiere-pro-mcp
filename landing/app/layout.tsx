import type { Metadata } from "next";
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

const siteUrl = "https://premiere-pro-mcp.fly.dev";
const title = "Premiere Pro MCP – AI Control for Adobe Premiere Pro";
const description =
  "Give AI full control over Adobe Premiere Pro. 269 tools across 28 modules for automated video editing via the Model Context Protocol (MCP).";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL(siteUrl),
  keywords: [
    "Premiere Pro",
    "MCP",
    "Model Context Protocol",
    "Adobe Premiere Pro",
    "AI video editing",
    "automation",
    "Claude",
    "LLM",
  ],
  authors: [{ name: "Premiere Pro MCP" }],
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Premiere Pro MCP",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Premiere Pro MCP - AI Control for Adobe Premiere Pro",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: siteUrl,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
