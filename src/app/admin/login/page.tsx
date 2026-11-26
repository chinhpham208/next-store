import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { redirectSignedInAdmin } from "@/features/admin";
import { AdminHeader, LoginForm } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Đăng nhập" };

// Reads the cookie inside <Suspense>, so the form streams first. Already signed in → /admin/products. In a stream that redirect is a meta tag (plan M5 D5); nothing here is protected anyway.
const SignedInRedirect = async () => {
  await redirectSignedInAdmin();
  return null;
};

// ADR-0020: the page runs under the proxy's nonce CSP ('strict-dynamic'), and Next.js puts the nonce only on what it
// renders for the request (D3). A prerendered shell (◐) is served with scripts that carry no nonce: the browser
// refuses them and the form never hydrates (audit PR #105 L3, e2e/ns-csp.spec.ts). Awaiting `connection` before
// anything, outside any <Suspense>, leaves the route no static shell (ƒ in the route table); `instant = false` is
// what Cache Components requires for such a route (else the build stops with "blocking-prerender-dynamic").
export const instant = false;

export default async function AdminLoginPage() {
  await connection();
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
