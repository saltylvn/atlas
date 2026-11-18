import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts live in the repo (app/fonts, SIL OFL; see LICENSES.txt) and are served from this
// origin (CSP font-src 'self'). Bundling them means a build never depends on reaching
// Google Fonts, which had failed builds intermittently.
const inter = localFont({ src: "./fonts/inter-latin.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const manrope = localFont({ src: "./fonts/manrope-latin.woff2", weight: "500 700", variable: "--font-manrope", display: "swap" });
const sourceCode = localFont({ src: "./fonts/source-code-pro-latin.woff2", weight: "400 500", variable: "--font-source-code", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Atlas", template: "%s · Atlas" },
  description: "Your personal chief of staff: the brief, the plan, your people, your job search.",
  applicationName: "Atlas",
  appleWebApp: { capable: true, title: "Atlas", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable} ${sourceCode.variable}`}>
      <body>{children}</body>
    </html>
  );
}
