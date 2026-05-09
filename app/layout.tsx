import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upside Down Gaming Cafe | Book Your Station",
  description: "Premium gaming cafe experience. Book your PC, PlayStation, or VR station online.",
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
