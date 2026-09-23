"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/ui/Sidebar";
import AuthGuard from "@/components/layout/AuthGuard";

const PUBLIC_PATHS = ["/", "/login"];

export default function RootLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (isPublic) {
    // Public pages (landing + login) — no sidebar, no auth check
    return <>{children}</>;
  }

  // Protected pages — verify session, then show sidebar + content
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-h-screen transition-all duration-300 ml-64">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
