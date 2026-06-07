import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upside Down Gaming Cafe | Admin Dashboard",
  description: "Upside Down Gaming Cafe admin dashboard for station and booking management.",
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
