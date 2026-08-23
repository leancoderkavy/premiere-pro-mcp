import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { MarketingPageView } from "@/components/analytics/marketing-page-view";
import { product } from "@/lib/product";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://premiere-pro-mcp.com";
const title = "Premiere Pro Workflow Automation | Local MCP Server";
const description =
  "Use a compatible AI client to inspect local Premiere projects, preview bounded work, and verify supported workflow results before you rely on them.";
const googleAnalyticsId =
  process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID ?? "G-XSH74T16E4";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s | MCP for Adobe Premiere Pro",
  },
  description,
  metadataBase: new URL(siteUrl),
  applicationName: product.name,
  category: "developer tools",
  creator: "MCP for Adobe Premiere Pro contributors",
  publisher: product.name,
  verification: {
    google: "DYKtInlwQzKguGVKyDbZY55-7gKySyg3N9yl9fERiho",
  },
  keywords: [
    "MCP for Adobe Premiere Pro",
    "Adobe Premiere Pro AI",
    "Model Context Protocol",
    "AI video editing",
    "Premiere Pro automation",
    "Premiere Pro extension",
    "Premiere Pro scripting",
    "Claude MCP server",
    "MCP server for Adobe Premiere Pro",
    "Cursor Premiere Pro integration",
    "Claude Premiere Pro integration",
    "AI video editor tools",
    "video editing automation",
  ],
  authors: [{ name: "MCP for Adobe Premiere Pro contributors", url: "https://github.com/leancoderkavy/premiere-pro-mcp/graphs/contributors" }],
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: product.name,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/marketing/premiere-pro-mcp-social-square-v1.png",
        width: 1254,
        height: 1254,
        alt: "MCP for Adobe Premiere Pro — local-first, reviewable workflow automation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/marketing/premiere-pro-mcp-social-square-v1.png"],
  },
  icons: {
    icon: "/marketing/premiere-pro-mcp-mark-v1.png",
    apple: "/marketing/premiere-pro-mcp-mark-v1.png",
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
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <MarketingPageView />
        {children}
        {googleAnalyticsId ? (
          <>
            <Script
              src="/analytics.js"
              strategy="lazyOnload"
              data-google-analytics-id={googleAnalyticsId}
            />
          </>
        ) : null}
      </body>
    </html>
  );
}
