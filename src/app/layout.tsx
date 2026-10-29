import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Wave — Your music, your language",
  description: "A personal music app for friends. Originals only — search, play, and discover Indian music across every language. Free forever.",
};

export const viewport: Viewport = {
  themeColor: "#030303",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${roboto.variable} min-h-screen bg-[var(--bg)] text-foreground antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
