import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { Container } from "@/components/ui/container";
import { requireAdminPage } from "@/features/admin";
import { renderProductName } from "@/features/products";
import { getProductForAdmin, ProductEditForm } from "@/features/products/admin";

// US-13 (plan M5 Task 10). Both functions check the session first, before params or data (audit PR #106 H1). No
// generateStaticParams: an admin page is rendered per request, from the database, never cached.

export async function generateMetadata({ params }: PageProps<"/admin/products/[slug]">): Promise<Metadata> {
  await requireAdminPage();
  const product = await getProductForAdmin((await params).slug);
  return { title: product === null ? "Không tìm thấy sản phẩm" : `Sửa ${product.name}` };
}

export default async function AdminProductEditPage({ params }: PageProps<"/admin/products/[slug]">) {
  await requireAdminPage();
  const product = await getProductForAdmin((await params).slug);
  if (product === null) notFound();
  return (
    <Container className="flex flex-col gap-6 pt-4 pb-16 md:gap-8 md:pt-6 md:pb-24">
      <Breadcrumb crumbs={[{ href: "/admin/products", label: "Sản phẩm" }]} />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-label text-muted-foreground uppercase">Sửa sản phẩm</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance break-words md:text-4xl">
          {renderProductName(product.name)}
        </h1>
        <p className="text-sm text-muted-foreground">
          Slug (không đổi được): <code className="font-mono text-foreground">{product.slug}</code>
        </p>
      </div>
      <ProductEditForm product={product} />
    </Container>
  );
}
