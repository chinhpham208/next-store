# ADR-0002: Thanh toán qua interface `PaymentProvider`, có bản Fake

- Trạng thái: Thay thế một phần bởi [ADR-0004](./0004-payment-vietnam.md) — giữ interface và `FakeProvider`, bỏ `StripeProvider`
- Ngày: 2026-11-19

## Bối cảnh

Luồng thanh toán (tạo phiên → khách trả tiền → webhook → tạo đơn, trừ kho) là phần quan trọng để học Route Handler và xử lý webhook. Nhưng yêu cầu "dễ chạy" nói không cần tài khoản thanh toán, và môi trường build không gọi được API Stripe.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Chỉ dùng Stripe | Thật nhất | Bắt buộc có tài khoản + Stripe CLI để nhận webhook ở local; không kiểm tra tự động được |
| Bỏ thanh toán, bấm là tạo đơn | Đơn giản | Mất bài học về webhook, idempotency, race condition |
| **Interface + hai bản cài đặt (Stripe, Fake)** | Chạy được không cần tài khoản; luồng webhook giống thật; thử Stripe thật khi muốn | Thêm một lớp abstraction |

## Quyết định

```ts
type PaymentProvider = {
  createCheckout: (order: Order) => Promise<{ redirectUrl: string }>
  verifyWebhook: (request: Request) => Promise<PaymentEvent>
}
```

- `StripeProvider`: Stripe Checkout chế độ test; dùng khi có `STRIPE_SECRET_KEY`.
- `FakeProvider`: mặc định. Chuyển khách tới `/checkout/fake`; trang này gửi request tới đúng `/api/webhooks/payment`, ký bằng HMAC với một secret local — giống cách Stripe ký webhook.

## Hệ quả

- Route Handler webhook không biết đang dùng nhà cung cấp nào; logic tạo đơn / trừ kho chỉ viết một lần.
- Người đọc thấy rõ khái niệm webhook: request đến từ bên ngoài, phải xác minh chữ ký, có thể bị gửi lặp.
- Abstraction này nhỏ và có lý do rõ ràng; không phải thứ che khuất API Next.js.
