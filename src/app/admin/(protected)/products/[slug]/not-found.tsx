import Link from "next/link";
import { StatusMessage } from "@/components/layout/status-message";
import { buttonVariants } from "@/components/ui/button";

// Gate 2 M5 decision 5: inside the admin shell, a way back to the list, not to the shop. Fixed text only: it renders
// without a page check (src/admin-session-checks.test.ts).
export default function AdminProductNotFound() {
  return (
    <StatusMessage title="Không tìm thấy sản phẩm" description="Không có sản phẩm nào với đường dẫn này.">
      <Link href="/admin/products" className={buttonVariants({ variant: "primary", className: "w-full md:w-auto" })}>
        Về danh sách sản phẩm
      </Link>
    </StatusMessage>
  );
}
