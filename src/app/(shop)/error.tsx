"use client";

import Link from "next/link";
import { StatusMessage } from "@/components/layout/status-message";
import { Button, buttonVariants } from "@/components/ui/button";

const ACTION_CLASS = "w-full md:w-auto";

type ShopErrorProps = { error: unknown; retry: () => void };

// Sits inside (shop)/layout.tsx's <main>, so the header and footer stay. Only fixed text is shown: the thrown
// value never reaches the screen (a client-side error keeps its original message, which may hold SQL or hosts).
// Client Components cannot export metadata; React hoists this <title> into <head> (no root template applies).
export default function ShopError({ retry }: ShopErrorProps) {
  return (
    <>
      <title>Đã có lỗi xảy ra · next-store</title>
      <StatusMessage
        title="Đã có lỗi xảy ra"
        description="Không tải được dữ liệu lúc này. Thử lại sau vài giây, hoặc quay về trang chủ."
      >
        <Button variant="primary" className={ACTION_CLASS} onClick={() => retry()}>
          Thử lại
        </Button>
        <Link href="/" className={buttonVariants({ variant: "secondary", className: ACTION_CLASS })}>
          Về trang chủ
        </Link>
      </StatusMessage>
    </>
  );
}
