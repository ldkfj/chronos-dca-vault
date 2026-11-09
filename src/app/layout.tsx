import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Chronos Vault | Atomic DCA & Limit Order Router to Solana Liquidity",
  description:
    "Automated Dollar-Cost Averaging (DCA) and Target-Price Limit Order Vault for EVM and Solana wallets on Rome Protocol. Settles batches atomically against Solana liquidity via CPI (0xFF...08) with slippage revert protection.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-[#060913] text-slate-100 min-h-screen bg-chronos-grid`}
      >
        {children}
      </body>
    </html>
  );
}
