"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// client-side redirect so it also works in the static (GitHub Pages) export
export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/clients"); }, [router]);
  return null;
}
