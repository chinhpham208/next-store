import { redirect } from "next/navigation";

// /admin has no page of its own: the product list is the admin home (plan M5 Task 8). The proxy answers /admin
// without a session with a 307 to /admin/login before this runs. Outside (protected) on purpose, with no
// requireAdminPage: it reads and renders nothing, so it stays a static redirect, and /admin/products checks the
// session itself (audit PR #106 N2; src/admin-session-checks.test.ts lists it).
export default function AdminIndexPage() {
  redirect("/admin/products");
}
