import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@wrksz/themes/next";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import {
  PromptDialogProvider,
  ConfirmDialogProvider,
} from "@/components/cloud/prompt-dialog";
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRAND_SHORT,
  BRAND_TITLE,
} from "@/lib/cloud/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: BRAND_TITLE,
  description: `${BRAND_NAME} — ${BRAND_DESCRIPTION}`,
  applicationName: BRAND_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND_SHORT,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon-apple.png",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf8ef" },
    { media: "(prefers-color-scheme: dark)", color: "#2a241d" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storage="localStorage"
          storageKey="theme"
        >
          {children}
          <SonnerToaster
            position="top-center"
            richColors
            closeButton
            style={{ top: "env(safe-area-inset-top)" } as React.CSSProperties}
          />
          <PromptDialogProvider />
          <ConfirmDialogProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
