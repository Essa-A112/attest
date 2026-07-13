import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attest",
  description:
    "Turn written policies into scenario-based training with a tamper-evident completion ledger.",
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
