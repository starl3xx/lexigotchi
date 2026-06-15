import { AdminGate } from "@/components/admin/AdminGate";

/** Operator console. The gate (client) resolves the viewer identity and checks the allowlist. */
export default function AdminPage() {
  return <AdminGate />;
}
