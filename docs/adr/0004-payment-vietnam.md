# ADR-0004: Thanh toán hướng tới cổng Việt Nam, bỏ Stripe

- Trạng thái: Đã chấp nhận
- Ngày: 2026-11-19
- Thay thế một phần: [ADR-0002](./0002-payment-provider.md) (giữ interface `PaymentProvider` và `FakeProvider`; bỏ `StripeProvider`)

## Bối cảnh

Sản phẩm được deploy thật, nhưng giai đoạn hiện tại chưa thu tiền thật. Khi mở bán, khách hàng ở Việt Nam và người bán đăng ký tại Việt Nam. Stripe không hỗ trợ tài khoản merchant cho doanh nghiệp đăng ký tại Việt Nam, nên `StripeProvider` trong ADR-0002 sẽ không bao giờ dùng được cho production. Các cổng phổ biến ở Việt Nam: PayOS (chuyển khoản VietQR), VNPay, MoMo, ZaloPay.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Giữ Stripe (chế độ test) | Tài liệu tốt | Không dùng được khi mở bán; công sức bỏ đi |
| Tích hợp ngay một cổng Việt Nam ở chế độ sandbox | Gần production nhất | Cần tài khoản merchant / sandbox ngay bây giờ; chọn cổng quá sớm |
| **Chỉ `FakeProvider` bây giờ, thiết kế interface theo đặc điểm chung của các cổng Việt Nam** | Không cần tài khoản; luồng đặt hàng hoàn chỉnh; cắm cổng thật sau chỉ thêm một adapter | Chưa kiểm chứng với cổng thật cho đến khi mở bán |

## Quyết định

Chỉ có `FakeProvider` trong 6 mốc hiện tại. Interface được thiết kế theo mẫu chung của các cổng Việt Nam (tạo link thanh toán → chuyển hướng → webhook có chữ ký):

```ts
type PaymentProvider = {
  id: 'fake' | 'payos' | 'vnpay' | 'momo'
  createCheckout: (input: {
    orderCode: number      // orders.id — nhiều cổng VN yêu cầu mã đơn là số nguyên
    amount: number         // VND, số nguyên
    description: string    // ngắn, không dấu nếu cổng yêu cầu
    returnUrl: string
    cancelUrl: string
  }) => Promise<{ checkoutUrl: string; paymentRef: string }>
  verifyWebhook: (request: Request) => Promise<PaymentEvent>  // ném lỗi nếu chữ ký sai
}

type PaymentEvent =
  | { type: 'paid'; paymentRef: string; orderCode: number; amount: number }
  | { type: 'cancelled'; paymentRef: string; orderCode: number }
```

- Provider được chọn bằng biến môi trường `PAYMENT_PROVIDER` (mặc định `fake`).
- `FakeProvider` ký webhook bằng HMAC-SHA256 với `FAKE_PAYMENT_SECRET`, giống cách các cổng thật ký dữ liệu.
- Trang `/checkout/test` hiển thị rõ "Môi trường thử nghiệm — không thu tiền".
- Webhook kiểm tra `amount` khớp `orders.total` trước khi đánh dấu `paid`.

## Hệ quả

- Khi mở bán: chọn cổng (ứng viên đầu tiên: PayOS — có SDK Node và hàm xác minh webhook), thêm `src/features/checkout/providers/<cổng>.ts`, đặt biến môi trường. Không đổi luồng đặt hàng, schema hay Route Handler.
- Cột `orders.provider` ghi provider đã xử lý đơn, để đơn test không lẫn với đơn thật.
- Biến `STRIPE_*` bị bỏ khỏi `.env.example`.
