# Tiến độ thi công chi nhánh

Trang web theo dõi tiến độ thi công và khai trương chi nhánh. Trang chạy trên GitHub Pages; dữ liệu chung lưu trên Google Sheet qua Apps Script. Mọi người mở cùng một link sẽ thấy và sửa chung dữ liệu, trang tự cập nhật thay đổi của người khác 15 giây/lần.

```
Trình duyệt (GitHub Pages: index.html + config.js)
        │  đọc / ghi (fetch)
        ▼
Apps Script web app (/exec)  ──►  Google Sheet: data (JSON) · TongHop · NhatKy
        │  đồng bộ task (UrlFetchApp, không bị CORS)
        ▼
API wshr.hasaki.vn (token HSK_TOKEN cài ở Apps Script)
```

## Bước 1 — Tạo kho dữ liệu Google Sheet (khoảng 5 phút)

1. Tạo một Google Sheet mới, ví dụ đặt tên `Tien do thi cong - DATA`.
2. Vào **Tiện ích mở rộng → Apps Script**. Xoá code mẫu, dán toàn bộ nội dung `apps-script/Code.gs`, rồi bấm **Lưu**.
3. Nếu cần tự đồng bộ task: vào **Cài đặt dự án** (biểu tượng bánh răng) → **Thuộc tính tập lệnh** → thêm `HSK_TOKEN` = token wshr. Token phải có `app="wshr"` và `sub` khác 0; lấy bằng cách mở wshr.hasaki.vn → F12 → Network → Copy as cURL → lấy phần sau `Bearer `.
4. Bấm **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**, rồi chọn:
   - Thực thi với tư cách: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**

   Bấm **Triển khai** và cấp quyền.
5. Copy **URL ứng dụng web**, dạng `https://script.google.com/macros/s/…/exec`.
6. (Tuỳ chọn) Trong Apps Script, chọn hàm `caiDatTuDongDongBo` rồi bấm **Chạy** một lần. Từ đó máy chủ tự đồng bộ task mỗi 30 phút.

## Bước 2 — Đẩy dữ liệu đang có lên Sheet (làm 1 lần)

1. Mở file `tien-do-thi-cong.html` trên máy anh (bản đang chứa dữ liệu).
2. Vào **Cấu hình → Nơi lưu dữ liệu**, dán URL ở bước 1 → **Kết nối**.
3. Trang báo Sheet đang trống → bấm **Đẩy dữ liệu lên Sheet**.

## Bước 3 — Đưa trang lên GitHub Pages

1. Trên github.com, tạo repo mới, ví dụ `tien-do-thi-cong`.
2. **Add file → Upload files**: kéo thả `index.html`, `config.js`, `.nojekyll`, `README.md` và thư mục `apps-script`, rồi **Commit**.
3. Mở `config.js` trên GitHub → bấm bút chì để sửa → dán URL `/exec` vào `window.TDTC_API = "…";` → **Commit**.
4. Vào **Settings → Pages**, chọn Source: **Deploy from a branch**, Branch: `main`, thư mục `/ (root)` → **Save**.
5. Sau 1–2 phút có link dạng `https://<tên-github>.github.io/tien-do-thi-cong/`. Gửi link này cho team.

## Cập nhật về sau

- **Sửa giao diện:** thay `index.html` trên GitHub. Dữ liệu không bị ảnh hưởng.
- **Sửa `Code.gs`:** dán code mới, rồi vào **Triển khai → Quản lý triển khai** → bút chì → Phiên bản: **Mới** → Triển khai. URL giữ nguyên.
- **Sao lưu:** Google Sheet tự có lịch sử phiên bản (Tệp → Nhật ký phiên bản). Trong trang cũng có nút **Sao lưu JSON**.

## Lưu ý về quyền truy cập

- Theo lựa chọn hiện tại, ai có link trang đều xem và sửa được dữ liệu. Ai có URL `/exec` cũng đọc/ghi được dữ liệu trực tiếp. Repo và trang GitHub Pages (gói miễn phí) là công khai, nên URL `/exec` trong `config.js` ai cũng xem được.
- File `index.html` không chứa dữ liệu chi nhánh. Dữ liệu chỉ nằm trên Google Sheet.
- Token wshr chỉ nằm trong Thuộc tính tập lệnh của Apps Script, không nằm trên GitHub.
- Không sửa tay sheet `data`. Sheet `TongHop` và `NhatKy` được ghi lại sau mỗi lần lưu, dùng để xem và xuất Excel.
