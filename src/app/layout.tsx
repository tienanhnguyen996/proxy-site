import type { Metadata } from "next";
import { Inter, Lora, Be_Vietnam_Pro, Literata } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "vietnamese"],
});

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  weight: ["300", "400", "500", "700"],
  subsets: ["latin", "vietnamese"],
});

const literata = Literata({
  variable: "--font-literata",
  weight: ["300", "400", "500", "700"],
  subsets: ["latin", "vietnamese"],
});

export const metadata: Metadata = {
  title: "AetherRead | Clean Novel Reader",
  description: "A premium, ad-free web novel proxy reader designed for distraction-free reading.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable} ${beVietnamPro.variable} ${literata.variable}`}>
      <body>{children}</body>
    </html>
  );
}
