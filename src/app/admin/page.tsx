import { redirect } from "next/navigation";

// /admin has no page of its own: the product list is the admin home (plan M5 Task 8). The proxy answers /admin
// without a session with a 307 to /admin/login before this runs.
export default function AdminIndexPage() {
  redirect("/admin/products");
}
