import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "نظام إدارة الموارد الشامل | ERP System",
  description: "نظام متكامل لإدارة المخازن والمبيعات",
};

// بدون هذا يفترض الجوال عرضاً ~980px ثم يصغّر الصفحة، فتظهر مجهرية.
// maximumScale مفتوح عمداً حتى لا نمنع المستخدم من التكبير.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070b16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body>
        <div className="app-container">
          <AuthGate>{children}</AuthGate>
        </div>
      </body>
    </html>
  );
}
