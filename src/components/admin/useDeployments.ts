"use client";
/**
 * Live deployment registry for the admin tabs. Reads the effective registry on mount and re-reads
 * on same-tab saves (the `lexi:deployments` custom event) and cross-tab edits (the native `storage`
 * event), so every operations tab and the status strip stay in sync without a page reload.
 */
import { useEffect, useState } from "react";
import { loadDeployments, type Deployments } from "@/lib/admin/deployments";

export function useDeployments(): Deployments | null {
  const [d, setD] = useState<Deployments | null>(null);
  useEffect(() => {
    setD(loadDeployments());
    const refresh = () => setD(loadDeployments());
    window.addEventListener("lexi:deployments", refresh); // same-tab saves
    window.addEventListener("storage", refresh); // other tabs
    return () => {
      window.removeEventListener("lexi:deployments", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return d;
}
