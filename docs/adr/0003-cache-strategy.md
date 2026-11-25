# ADR-0003: Chiến lược cache bằng Cache Components

- Trạng thái: Đã chấp nhận; bổ sung bởi [ADR-0014](./0014-cart-storage-and-cookie.md) (header của mọi trang `(shop)` có lỗ động biểu tượng giỏ; blog không còn "tĩnh hoàn toàn"); bổ sung bởi [ADR-0019](./0019-product-edits-and-cache-tags.md) (đề xuất, M5: `getCatalogSlugs` mang tag riêng `product-slugs` thay cho `products`; danh sách tag của mỗi lần ghi sản phẩm là `tagsForProductWrite`)
- Bổ sung (2026-11-24, NS-105): mỗi hàm `"use cache"` cũng là một Server Function: client gọi thẳng được bằng action id với đối số tuỳ ý (đối số là khoá cache). Hàm có tham số phải tự kiểm đối số trước khi `cacheTag` / truy vấn: sai dạng thì ném lỗi cố định, đúng dạng mà không có thật (slug, danh mục, trang) thì trả rỗng với `cacheLife` expire 0 để không lưu entry. `getFeaturedProducts` chỉ nhận `limit` 1..8; `product:<slug>` chỉ lưu cho slug có thật. Xem [ADR-0008](./0008-listing-cache-keys.md), `conventions.md` §2.
- Bổ sung (2026-11-24, NS-109): `cacheLife(SKIP_CACHE_ENTRY)` (expire 0) chỉ được chạm tới khi hàm cache bị gọi thẳng như Server Function, **không bao giờ trên đường render**. Trong prerender (cả ISR lúc chạy của route có `generateStaticParams`), Next.js 16.4.6 coi entry có `revalidate: 0` hoặc `expire` dưới 5 phút là động (`use-cache-wrapper.js`, nhánh `case 'prerender'`, `MIN_PRERENDERABLE_EXPIRE`): trang PPR để lại lỗ động và vẫn chạy, nhưng route handler (ảnh Open Graph) không có lỗ để resume nên trả 500 `DYNAMIC_SERVER_USAGE` trước khi `notFound()` chạy. Vì vậy khoá đúng dạng mà không có thật phải được trả lời **trước** hàm cache theo khoá đó, bằng dữ liệu cache có khoá cố định: `getProductBySlug` tra danh sách slug `getCatalogSlugs()` (không tham số, tag `products`, `hours`) rồi mới gọi `getCachedProductBySlug`; `listCatalog` vốn đã chỉ truyền danh mục đã xác nhận và trang đã kẹp. Không thay `SKIP_CACHE_ENTRY` bằng `notFound()` trong hàm cache: Next mã hoá lỗi điều hướng vào stream nên entry **vẫn được lưu** (đã đo, `NEXT_PRIVATE_DEBUG_CACHE`). Giá: sản phẩm mới tạo đọc như không có cho tới khi tag `products` bị xoá (M5 tạo / xoá / đổi slug phải `updateTag('products')`), hoặc tối đa thời hạn `hours`. Xem `conventions.md` §2, `src/lib/cache-args.ts`.
- Ngày: 2026-11-19

## Bối cảnh

Trang sản phẩm và blog cần nhanh (đa số người xem, ít thay đổi). Nhưng một số phần của trang phụ thuộc người xem (giỏ hàng trong cookie), và dữ liệu sản phẩm phải cập nhật ngay khi admin sửa hoặc khi có người mua (tồn kho).

Next.js 16 có Cache Components (`cacheComponents: true`): mặc định mọi thứ là động, muốn cache phải khai báo rõ bằng `"use cache"`. Phần động trong trang tĩnh được bọc `<Suspense>` để phần vỏ vẫn được render trước.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Mọi trang động, không cache | Đơn giản, luôn đúng | Chậm, truy vấn DB mỗi request |
| Cache theo thời gian (ví dụ 1 giờ) | Đơn giản | Admin sửa giá phải chờ tới 1 giờ; tồn kho sai |
| **Cache + tag + làm mới theo sự kiện** | Nhanh, và cập nhật ngay khi dữ liệu đổi | Phải gắn tag và gọi `updateTag` đúng chỗ |

## Quyết định

- Hàm đọc sản phẩm dùng `"use cache"`, `cacheLife('hours')` làm mức an toàn, và gắn tag:
  - danh sách: `products`
  - từng sản phẩm: `product:<slug>`
- Sự kiện làm mới:
  - admin sửa sản phẩm → `updateTag('product:<slug>')` + `updateTag('products')`
  - webhook trừ kho → `revalidateTag('product:<slug>', 'max')` cho từng sản phẩm trong đơn (Route Handler không gọi được `updateTag`)
- Phần phụ thuộc cookie (số lượng giỏ hàng, trạng thái nút "thêm vào giỏ") không cache, bọc trong `<Suspense>`.
- Blog: tĩnh hoàn toàn lúc build.

`cacheComponents: true` bật từ M1 (cập nhật 2026-11-19), để mọi trang được viết theo mô hình này ngay từ đầu thay vì phải chuyển đổi ở M5.

## Hệ quả

- Có thể kiểm chứng: sửa giá trong admin → trang sản phẩm đổi ngay; trang sản phẩm khác không bị render lại.
- Phải nhớ gọi `updateTag` ở mọi nơi ghi dữ liệu sản phẩm. Các nơi ghi được gom trong `features/products` để không bị sót.
