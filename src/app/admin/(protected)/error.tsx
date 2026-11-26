"use client";

import { StatusMessage } from "@/components/layout/status-message";
import { Button } from "@/components/ui/button";

type AdminErrorProps = { error: unknown; retry: () => void };

// Gate 2 M5 decision 5: a render error of an admin page stays inside the admin shell (the bar is the layout's, above
// this boundary) instead of the root boundary and its link to the shop. Fixed text only: the thrown value never
// reaches the screen. A Client Component cannot export metadata; React hoists this <title> into <head>.
export default function AdminError({ retry }: AdminErrorProps) {
  return (
    <>
      <title>Đã có lỗi xảy ra · Quản trị</title>
      <StatusMessage title="Đã có lỗi xảy ra" description="Không tải được dữ liệu lúc này. Thử lại sau vài giây.">
        <Button variant="primary" className="w-full md:w-auto" onClick={() => retry()}>
          Thử lại
        </Button>
      </StatusMessage>
    </>
  );
}
