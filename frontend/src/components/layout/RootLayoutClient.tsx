"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import AppProvider, { useApp } from "@/components/providers/AppProvider";
import Sidebar from "@/components/ui/Sidebar";
import { EmptyState } from "@/components/ui/kit";

const PUBLIC_PATHS = ["/", "/login", "/reset-password"];

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, store } = useApp();
  const [open, setOpen] = useState(false);
  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;
  if (!me) return null; // AppProvider redirects to /login
  return (
    <div className="flex min-h-screen">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:ml-64">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><Menu size={20} /></button>
          <span className="font-bold gradient-text">PriceIQ</span>
          {store && <span className="truncate text-xs text-slate-500">· {store.store_name}</span>}
        </div>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">
          {store ? children : (
            <EmptyState title="No store access yet" message="Your account is not a member of any store. Ask an organization admin to add you, or register a new store from the login page." />
          )}
        </main>
      </div>
    </div>
  );
}

export default function RootLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
