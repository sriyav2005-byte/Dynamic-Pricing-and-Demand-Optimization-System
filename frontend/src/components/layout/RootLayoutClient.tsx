"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/ui/Sidebar";

export default function RootLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLandingPage = pathname === "/";

  return (
    <div className="flex min-h-screen">
      {!isLandingPage && <Sidebar />}
      <main className={`flex-1 min-h-screen transition-all duration-300 ${isLandingPage ? "ml-0" : "ml-64"}`}>
        {children}
      </main>
    </div>
  );
}
