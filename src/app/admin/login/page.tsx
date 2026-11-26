import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { AdminHeader, LoginForm, redirectSignedInAdmin } from "@/features/admin";

export const metadata: Metadata = { title: "Đăng nhập" };

// Reads the cookie, so it renders inside <Suspense> and the rest of the page stays static. Already signed in →
// /admin/products. In a stream that redirect is a meta tag (plan M5 D5); nothing here is protected anyway.
const SignedInRedirect = async () => {
  await redirectSignedInAdmin();
  return null;
};

export default function AdminLoginPage() {
  return (
    <>
      <AdminHeader layout="login">
        <nav aria-label="Quản trị" className="-mr-2 ml-auto flex">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center px-2 font-medium whitespace-nowrap underline-offset-8 hover:underline"
          >
            Về cửa hàng
          </Link>
        </nav>
      </AdminHeader>
      <main className="flex-1">
        <Suspense fallback={null}>
          <SignedInRedirect />
        </Suspense>
        <Container className="flex flex-col gap-6 pt-10 pb-16 md:gap-8 md:pt-16 md:pb-24">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Đăng nhập quản trị</h1>
          <p className="max-w-xl text-muted-foreground md:text-lg">
            Khu quản lý sản phẩm của next-store. Chỉ chủ cửa hàng có mật khẩu.
          </p>
          <LoginForm />
        </Container>
      </main>
    </>
  );
}
