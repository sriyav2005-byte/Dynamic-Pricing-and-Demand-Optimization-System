"use client";

/**
 * AuthGuard.tsx
 * ─────────────
 * Wraps every protected page. On mount it checks localStorage for the
 * `priceiq_auth` token that the login page sets. If missing, it
 * immediately redirects to /login.
 *
 * Public routes (/, /login) skip this guard entirely via RootLayoutClient.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu } from "lucide-react";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("priceiq_auth");
    if (!token) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  // Show a minimal branded splash while verifying (avoids flash of protected content)
  if (!checked) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)" }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
            boxShadow: "0 0 40px rgba(124,58,237,0.5)",
            animation: "pulse-logo 1.6s ease-in-out infinite",
          }}
        >
          <Cpu size={26} className="text-white" />
        </div>
        <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>
          Verifying session…
        </p>
        <style>{`
          @keyframes pulse-logo {
            0%, 100% { transform: scale(1);    opacity: 1;   }
            50%       { transform: scale(1.08); opacity: 0.85; }
          }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
}
