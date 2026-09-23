import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BPO Onboarding Hub",
  description: "Onboard clients to the WhatsApp Business API — templates, GDPR opt-in and CRM sync in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
