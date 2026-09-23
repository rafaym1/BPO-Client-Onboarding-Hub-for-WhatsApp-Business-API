"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { api, type Client, type PublicConfig } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// ---------- toasts ----------
type Tone = "success" | "error" | "warning";
interface ToastItem { id: number; tone: Tone; title: string; description?: string }
interface ToastApi { (t: Omit<ToastItem, "id">): void }

const ToastContext = createContext<ToastApi>(() => {});
export const useToast = () => useContext(ToastContext);

const toneStyles: Record<Tone, { box: string; icon: ReactNode }> = {
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-950", icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" /> },
  error: { box: "border-red-200 bg-red-50 text-red-950", icon: <XCircle className="h-4 w-4 text-red-600" /> },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-950", icon: <AlertTriangle className="h-4 w-4 text-amber-600" /> },
};

function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback<ToastApi>((t) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), t.tone === "error" ? 8000 : 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex gap-3 rounded-lg border p-3 text-sm shadow-md", toneStyles[t.tone].box)}>
            <span className="mt-0.5">{toneStyles[t.tone].icon}</span>
            <div className="min-w-0">
              <p className="font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 break-words text-[13px] opacity-90">{t.description}</p>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- public config (which integrations are mocked, dev tools) ----------
const ConfigContext = createContext<PublicConfig | null>(null);
export const useConfig = () => useContext(ConfigContext);

function ConfigProvider({ children }: { children: ReactNode }) {
  const { data } = useResource(() => api.config(), []);
  return <ConfigContext.Provider value={data}>{children}</ConfigContext.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfigProvider>{children}</ConfigProvider>
    </ToastProvider>
  );
}

// ---------- current client (shared by the 4 client sub-pages) ----------
interface ClientCtx { client: Client; reload: () => Promise<void>; setClient: (c: Client) => void }
export const ClientContext = createContext<ClientCtx | null>(null);
export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClient must be used inside the client layout");
  return ctx;
}
