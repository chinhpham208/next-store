"""Tạo epic, user story và task trên YouTrack (project NS) bằng YouTrack CLI (`yt`).

Chạy một lần: python3 scripts/youtrack/setup.py
Kết quả: scripts/youtrack/issue-map.json ánh xạ mã nội bộ (M1, US-01, M1-T1...) → mã YouTrack (NS-…).
Chạy lại an toàn: mục nào đã có trong issue-map.json thì bỏ qua.
"""

import json
import re
import subprocess
from pathlib import Path

PROJECT = "NS"
DOCS = "Tài liệu: thư mục `docs/` trong repo next-store"
MAP_FILE = Path(__file__).with_name("issue-map.json")

EPICS = {
    "M1": ("M1 Nền tảng", "Khởi tạo dự án, cấu trúc thư mục, công cụ kiểm tra, schema + seed, layout, trang chủ.", "docs/plans/M1.md"),
    "M2": ("M2 Danh mục sản phẩm", "Lọc / sắp xếp / tìm / phân trang qua URL, trang chi tiết, generateStaticParams, loading / error / not-found.", None),
    "M3": ("M3 Blog & SEO", "Blog MDX, metadata, OG image, sitemap, robots, next/image.", None),
    "M4": ("M4 Giỏ hàng", "Cookie giỏ hàng, Server Actions, Zod, useOptimistic, kiểm tra tồn kho.", None),
    "M5": ("M5 Cache & Admin", "Bật Cache Components, cache tag, đăng nhập admin, proxy.ts, sửa sản phẩm.", None),
    "M6": ("M6 Thanh toán", "PaymentProvider, webhook, đơn hàng, trang admin đơn hàng, Web Vitals.", None),
}

# (mã, tiêu đề, user story, tiêu chí chấp nhận, epic chính, epic liên quan)
STORIES = [
    ("US-01", "Xem sản phẩm nổi bật và bài blog mới trên trang chủ",
     "Là khách hàng, tôi muốn xem sản phẩm nổi bật và bài blog mới ngay trên trang chủ, để biết cửa hàng có gì.",
     ["**Cho** dữ liệu mẫu, **khi** mở `/`, **thì** thấy 6 sản phẩm nổi bật, mỗi sản phẩm có ảnh, tên, giá dạng `199.000 ₫`, tên danh mục.",
      "**Cho** không có sản phẩm nổi bật, **thì** thấy \"Chưa có sản phẩm nổi bật.\"",
      "**Cho** có bài blog, **thì** thấy 3 bài mới nhất (từ M3)."], "M1", ["M3"]),
    ("US-02", "Lọc, sắp xếp, tìm và phân trang sản phẩm",
     "Là khách hàng, tôi muốn lọc sản phẩm theo danh mục, sắp xếp theo giá hoặc mới nhất, và tìm theo tên, để nhanh chóng tìm được món mình cần.",
     ["**Khi** mở `/products?category=ao-thun`, **thì** chỉ thấy áo thun.",
      "**Khi** thêm `&sort=price-asc`, **thì** giá tăng dần.",
      "**Khi** tìm `?q=git`, **thì** chỉ thấy sản phẩm có \"git\" trong tên (không phân biệt hoa thường).",
      "**Khi** có hơn 12 kết quả, **thì** chia trang, `?page=2` hiện 12 sản phẩm tiếp theo."], "M2", []),
    ("US-03", "Chia sẻ link danh sách đã lọc",
     "Là khách hàng, tôi muốn gửi link danh sách đã lọc cho bạn bè và họ thấy đúng kết quả như tôi.",
     ["**Cho** một URL có bộ lọc, **khi** mở ở trình duyệt khác, **thì** thấy đúng cùng kết quả.",
      "**Khi** đổi bộ lọc trên giao diện, **thì** URL cập nhật theo.",
      "**Cho** tham số không hợp lệ (`?page=abc`, `?sort=xyz`), **thì** dùng giá trị mặc định, không lỗi."], "M2", []),
    ("US-04", "Xem chi tiết sản phẩm",
     "Là khách hàng, tôi muốn xem chi tiết sản phẩm: ảnh, mô tả, giá, còn hàng hay không.",
     ["**Khi** mở `/products/<slug>`, **thì** thấy ảnh, tên, mô tả, giá, và \"Còn N sản phẩm\" hoặc \"Hết hàng\"."], "M2", []),
    ("US-05", "Trang lỗi thân thiện",
     "Là khách hàng, khi mở một sản phẩm không tồn tại, tôi muốn thấy trang báo lỗi thân thiện thay vì trang trắng.",
     ["**Khi** mở `/products/khong-ton-tai`, **thì** nhận status 404 và trang báo không tìm thấy có link về danh sách sản phẩm.",
      "**Cho** lỗi khi đọc DB, **thì** thấy trang lỗi có nút thử lại."], "M2", []),
    ("US-06", "Thêm vào giỏ hàng, cập nhật ngay",
     "Là khách hàng, tôi muốn thêm sản phẩm vào giỏ và thấy số lượng trong giỏ cập nhật ngay lập tức.",
     ["**Khi** bấm \"Thêm vào giỏ\", **thì** số trên biểu tượng giỏ tăng ngay (trước khi server trả lời).",
      "**Cho** server báo lỗi, **thì** số trở lại như cũ và hiện thông báo lỗi."], "M4", []),
    ("US-07", "Sửa giỏ hàng, giỏ được lưu lại",
     "Là khách hàng, tôi muốn sửa số lượng hoặc xoá sản phẩm trong giỏ, và giỏ vẫn còn khi tôi quay lại sau.",
     ["**Cho** giỏ có hàng, **khi** sửa số lượng hoặc xoá, **thì** tổng tiền cập nhật.",
      "**Khi** đóng trình duyệt và mở lại, **thì** giỏ vẫn còn.",
      "**Khi** đặt số lượng về 0, **thì** sản phẩm bị xoá khỏi giỏ."], "M4", []),
    ("US-08", "Báo lỗi khi vượt tồn kho",
     "Là khách hàng, tôi muốn được báo rõ nếu số lượng tôi muốn mua vượt quá tồn kho.",
     ["**Cho** sản phẩm còn 3, **khi** thêm 4 vào giỏ, **thì** bị từ chối với thông báo \"Chỉ còn 3 sản phẩm\".",
      "**Cho** sản phẩm hết hàng, **thì** nút \"Thêm vào giỏ\" bị vô hiệu."], "M4", []),
    ("US-09", "Thanh toán và xác nhận đơn",
     "Là khách hàng, tôi muốn thanh toán và nhận trang xác nhận đơn hàng.",
     ["**Cho** giỏ hợp lệ, **khi** thanh toán thành công, **thì** đơn chuyển `paid`, tồn kho giảm đúng số lượng, giỏ trống, và thấy trang xác nhận có mã đơn.",
      "**Khi** webhook gửi lặp lại cùng một thanh toán, **thì** tồn kho chỉ giảm một lần.",
      "**Cho** hai người cùng mua món cuối, **thì** đơn sau chuyển `needs_refund`."], "M6", []),
    ("US-10", "Đọc blog",
     "Là khách hàng, tôi muốn đọc các bài blog của cửa hàng.",
     ["**Khi** mở `/blog`, **thì** thấy danh sách bài mới nhất trước.",
      "**Khi** mở `/blog/<slug>`, **thì** thấy nội dung MDX đã render. Slug không tồn tại trả 404."], "M3", []),
    ("US-11", "Link chia sẻ có ảnh và tiêu đề",
     "Là khách hàng, khi chia sẻ link sản phẩm hoặc bài blog lên mạng xã hội, tôi muốn link hiện ảnh và tiêu đề đẹp.",
     ["**Khi** đọc HTML của trang sản phẩm hoặc bài blog, **thì** có `og:title`, `og:description`, `og:image` đúng nội dung trang.",
      "`/sitemap.xml` liệt kê mọi sản phẩm và bài blog."], "M3", []),
    ("US-12", "Đăng nhập khu quản trị",
     "Là admin, tôi muốn đăng nhập vào khu quản trị; người khác không vào được.",
     ["**Khi** chưa đăng nhập mà mở `/admin/products`, **thì** bị chuyển tới `/admin/login`.",
      "**Khi** nhập sai mật khẩu, **thì** thấy lỗi.",
      "**Khi** nhập đúng, **thì** vào được; cookie phiên bị sửa tay thì bị đá ra."], "M5", []),
    ("US-13", "Sửa sản phẩm, cửa hàng cập nhật ngay",
     "Là admin, tôi muốn sửa tên, giá, mô tả, tồn kho của sản phẩm và thấy thay đổi trên cửa hàng ngay sau khi lưu.",
     ["**Khi** admin đổi giá một sản phẩm và lưu, **thì** trang sản phẩm đó hiện giá mới ở lần tải kế tiếp, còn các trang sản phẩm khác không bị render lại.",
      "**Cho** giá âm hoặc tên trống, **thì** bị từ chối với lỗi cạnh ô nhập."], "M5", []),
    ("US-14", "Xem danh sách đơn hàng",
     "Là admin, tôi muốn xem danh sách đơn hàng, đặc biệt các đơn cần hoàn tiền vì hết hàng.",
     ["**Khi** admin mở `/admin/orders`, **thì** thấy danh sách đơn mới nhất trước, có lọc theo trạng thái; đơn `needs_refund` được làm nổi bật."], "M6", []),
]

# (mã, tiêu đề, mô tả, user story liên quan)
M1_TASKS = [
    ("M1-T1", "Khởi tạo dự án Next.js và git", "Plan: `docs/plans/M1.md` — Task 1.", []),
    ("M1-T2", "Công cụ kiểm tra và tiện ích lib/", "Plan: `docs/plans/M1.md` — Task 2. Vitest, dependency-cruiser, `cn`, `formatPrice`.", []),
    ("M1-T3", "Database: schema, client, migration, seed", "Plan: `docs/plans/M1.md` — Task 3.", ["US-01"]),
    ("M1-T4", "Feature products: truy vấn sản phẩm nổi bật", "Plan: `docs/plans/M1.md` — Task 4.", ["US-01"]),
    ("M1-T5", "Layout và trang chủ", "Plan: `docs/plans/M1.md` — Task 5.", ["US-01"]),
    ("M1-T6", "README, tài liệu học M1, kiểm tra clone mới", "Plan: `docs/plans/M1.md` — Task 6.", []),
]


def yt(*args: str) -> str:
    result = subprocess.run(["yt", *args], capture_output=True, text=True)
    output = result.stdout + result.stderr
    if result.returncode != 0:
        raise RuntimeError(f"yt {' '.join(args[:3])} failed:\n{output}")
    return output


def create_issue(summary: str, issue_type: str, description: str) -> str:
    output = yt("issues", "create", PROJECT, summary, "--type", issue_type, "--description", description)
    match = re.search(rf"\b({PROJECT}-\d+)\b", output)
    if not match:
        raise RuntimeError(f"Không đọc được mã issue từ:\n{output}")
    return match.group(1)


def link(source: str, target: str, link_type: str) -> None:
    yt("issues", "links", "create", source, target, link_type)


def ensure(issue_map: dict[str, str], key: str, summary: str, issue_type: str, description: str) -> str:
    if key in issue_map:
        return issue_map[key]
    issue_id = create_issue(summary, issue_type, description)
    issue_map[key] = issue_id
    MAP_FILE.write_text(json.dumps(issue_map, indent=2, ensure_ascii=False) + "\n")
    print(f"{key:7} → {issue_id}  {summary}")
    return issue_id


def main() -> None:
    issue_map: dict[str, str] = json.loads(MAP_FILE.read_text()) if MAP_FILE.exists() else {}

    for key, (summary, goal, plan) in EPICS.items():
        stories = [s[0] for s in STORIES if s[4] == key or key in s[5]]
        description = "\n".join([
            f"**Mục tiêu:** {goal}",
            "",
            f"**User stories:** {', '.join(stories) or '—'}",
            f"**Plan:** `{plan}`" if plan else "**Plan:** viết khi bắt đầu mốc (`docs/plans/" + key + ".md`).",
            "",
            DOCS,
        ])
        ensure(issue_map, key, summary, "Epic", description)

    for code, title, story, criteria, epic, related_epics in STORIES:
        description = "\n".join([
            story,
            "",
            "### Tiêu chí chấp nhận",
            *[f"- {c}" for c in criteria],
            "",
            f"Nguồn: `docs/requirements.md` ({code})",
        ])
        is_new = code not in issue_map
        issue_id = ensure(issue_map, code, f"{code} {title}", "User Story", description)
        if is_new:
            link(issue_id, issue_map[epic], "subtask of")
            for related in related_epics:
                link(issue_id, issue_map[related], "relates to")

    for code, title, description, stories in M1_TASKS:
        is_new = code not in issue_map
        issue_id = ensure(issue_map, code, title, "Task", description)
        if is_new:
            link(issue_id, issue_map["M1"], "subtask of")
            for story in stories:
                link(issue_id, issue_map[story], "relates to")


if __name__ == "__main__":
    main()
