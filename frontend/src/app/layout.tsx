import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LLM Benchmark Lab",
  description: "Enterprise-grade LLM benchmarking",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-black text-white h-screen flex overflow-hidden`}>
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-transparent flex flex-col min-w-0">
          <div className="p-2 md:p-2.5 w-full h-full flex flex-col overflow-hidden">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
