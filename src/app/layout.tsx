import type { Metadata } from "next";
import { JetBrains_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";

/**
 * The two typefaces the design resolves on: JetBrains Mono for every label and datum,
 * Playfair Display for the serif title and the italic reading annotations. Loaded via
 * next/font so they are self-hosted and non-blocking rather than a render-blocking
 * stylesheet from Google.
 */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Court Vision",
  description:
    "Reading the Brooklyn Nets' offensive identity through ball movement and shot geography.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${playfair.variable}`}>
      <body>{children}</body>
    </html>
  );
}
