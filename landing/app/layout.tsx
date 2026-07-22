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

const siteUrl = "https://premiere-pro-mcp.com";
const title = "Premiere Pro MCP Server – AI Video Editing Tools";
const description =
  "Connect AI assistants to Adobe Premiere Pro with 269 local-first MCP tools for timeline editing, effects, color, media management, automation, and export.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s | Premiere Pro MCP",
  },
  description,
  metadataBase: new URL(siteUrl),
  applicationName: "Premiere Pro MCP",
  category: "developer tools",
  creator: "Premiere Pro MCP contributors",
  publisher: "Premiere Pro MCP",
  keywords: [
    "Premiere Pro MCP",
    "Adobe Premiere Pro AI",
    "Model Context Protocol",
    "AI video editing",
    "Premiere Pro automation",
    "Premiere Pro extension",
    "Premiere Pro scripting",
    "Claude MCP server",
    "Premiere Pro MCP server",
    "Cursor Premiere Pro integration",
    "Claude Premiere Pro integration",
    "AI video editor tools",
    "video editing automation",
  ],
  authors: [{ name: "Premiere Pro MCP contributors", url: "https://github.com/leancoderkavy/premiere-pro-mcp/graphs/contributors" }],
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
        alt: "Premiere Pro MCP — control Adobe Premiere Pro with AI",
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
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
