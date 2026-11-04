import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

/** GitHub Pages monta el juego en /VECINOS/ — manifest e iconos también cuelgan de ahí. */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VECINOS — el simulador de vecindario",
  description:
    "Mudanzas, ruido, olores, wifi, plagas, humo y derramas: el simulador de vecindario. Sim determinista + render Babylon.js.",
  keywords: ["VECINOS", "juego", "simulación", "vecinos", "Babylon.js", "prototipo"],
  authors: [{ name: "Z.ai Team" }],
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  applicationName: "VECINOS",
  appleWebApp: {
    capable: true,
    title: "VECINOS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: `${BASE_PATH}/icons/icon-96.png`, sizes: "96x96", type: "image/png" },
      { url: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${BASE_PATH}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
