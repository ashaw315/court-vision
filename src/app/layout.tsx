import type { Metadata } from "next";
import "./globals.css";

// No font loading here yet — typefaces are chosen in the Phase 6 design pass.
// The scaffold's Geist imports were removed rather than left as an accidental default.

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
