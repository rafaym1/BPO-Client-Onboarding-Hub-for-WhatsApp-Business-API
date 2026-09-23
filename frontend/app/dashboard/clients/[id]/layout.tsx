import ClientShell from "./client-shell";

// The static GitHub Pages demo can't resolve client ids at runtime, so it pre-renders c1..c30
// (see MAX_DEMO_CLIENTS in lib/demo-backend.ts). In the normal server build this is a no-op.
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? Array.from({ length: 30 }, (_, i) => ({ id: `c${i + 1}` })) : [];
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <ClientShell>{children}</ClientShell>;
}
