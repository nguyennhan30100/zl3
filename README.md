# Bot Zalo tính điểm Free Fire

Port từ bot Discord gốc sang **Zalo Bot Platform** (bot-api.zapps.me) — nền
tảng bot chính thức, kiểu giống Telegram Bot API, đơn giản hơn nhiều so với
Zalo OA OpenAPI cũ.

## Những gì đã port nguyên vẹn
- Toàn bộ logic gọi API Garena (`ffGarena.js`)
- Toàn bộ logic tính điểm / gộp đội / luật "vô địch" CPR (`ffChampion.js`)
- Toàn bộ 5 kiểu vẽ ảnh bảng xếp hạng bằng canvas (`ffImages.js`)
- Luồng hội thoại nhiều bước: `.td [ID]` → chọn khung giờ → nhập ngày → chọn mẫu ảnh

## ⚠️ Bạn cần tự mang theo 2 thứ (không có trong file gốc bạn upload)
1. **Font**: copy `assets/fonts/DejaVuSans-Bold.ttf` từ project bot Discord cũ vào đúng đường dẫn đó.
2. **4 ảnh mẫu** (nếu muốn dùng mẫu 2-5): copy vào `assets/templates/`.
   Nếu chưa có, **mẫu 1 (mặc định)** vẫn chạy ngay, không cần ảnh gì thêm.

---

## Bước 1 — Deploy code lên Railway trước (để có Webhook URL)
1. Push project này lên GitHub repo.
2. railway.app → New Project → Deploy from GitHub repo.
3. Sau khi build xong, Railway cấp domain dạng `https://xxx.up.railway.app`.
   Webhook URL của bạn sẽ là `https://xxx.up.railway.app/webhook`.
4. Chưa cần điền biến môi trường vội — làm bước 2 trước để lấy đủ giá trị.

## Bước 2 — Điền màn hình "Thiết lập chung" của Bot (đúng màn hình bạn chụp)
- **Webhook URL**: dán `https://xxx.up.railway.app/webhook` (domain Railway ở bước 1)
- **Secret Token**: tự nghĩ 1 chuỗi bất kỳ dài 8-256 ký tự (VD: 1 đoạn random), nhớ chuỗi này
- Bấm **Lưu thay đổi**
- Kéo xuống mục **Bot Token** → bấm icon con mắt / copy để lấy token (dạng `12345:AbCdEf...`)

## Bước 3 — Điền biến môi trường trên Railway
Vào tab **Variables** trên Railway, thêm:
- `ZALO_BOT_TOKEN` = Bot Token vừa copy ở Bước 2
- `ZALO_WEBHOOK_SECRET` = đúng Secret Token bạn đã đặt ở Bước 2
- `GARENA_COOKIE` = cookie đăng nhập của bạn trên congdong.ff.garena.vn (F12 → tab Network → copy header Cookie của 1 request tới trang đó)
- `PREFIX` = `.` (hoặc ký tự khác nếu muốn)

Railway sẽ tự redeploy sau khi lưu biến môi trường.

## Bước 4 — Test
Vào Zalo, tìm bot của bạn (theo tên bạn đặt, VD "Bot NguyenNhan"), nhắn thử:
```
.help
```
Nếu bot chưa trả lời, vào **Railway → Deployments → View Logs** để xem lỗi.
Dòng log `[DEBUG] Webhook body không có field message...` (nếu xuất hiện) nghĩa
là cấu trúc dữ liệu Zalo gửi về khác với dự kiến — copy nguyên dòng log đó gửi
lại cho mình để mình chỉnh `server.js` cho khớp chính xác.

## ✅ Tính năng mới: Admin cấp/thu số ngày sử dụng bot cho từng người

Mặc định, **không ai dùng được lệnh `.td` cho tới khi admin cấp ngày** (trừ
chính admin). Người dùng vẫn dùng được `.help`, `.conlai` (xem số ngày còn
lại), `.whoami` (xem ID Zalo của mình) mà không cần được cấp ngày.

**Bước 1 — Khai báo admin trên Railway:**
- `ADMIN_IDS` = ID Zalo thật của bạn (và người khác nếu có), cách nhau dấu
  phẩy. VD: `ADMIN_IDS=1234567890,9876543210`
- Chưa biết ID của mình? Nhắn `.whoami` (chat riêng hoặc `@Tên Bot whoami`
  trong nhóm) — bot trả lời đúng ID Zalo của bạn, copy dán vào biến này rồi
  redeploy.

**Bước 2 — Cấp/thu ngày cho người khác (chỉ admin dùng được):**
- Cấp ngày: `@Tên Bot add 7 @Người dùng` → cấp thêm 7 ngày.
- Thu ngày: `@Tên Bot tru 3 @Người dùng` → thu lại 3 ngày.
- **Cách chắc chắn hoạt động nhất** (khuyên dùng, vì Zalo chưa xác nhận rõ
  cấu trúc mention trong webhook): bấm giữ 1 tin nhắn bất kỳ của người đó
  trong nhóm → chọn **Trả lời (Reply/Quote)** → gõ `@Tên Bot add 7` (không
  cần gõ @ tên người dùng nữa, bot tự biết bạn đang trả lời ai).

**Bước 3 — Người dùng tự kiểm tra:**
- Nhắn `.conlai` (hoặc `@Tên Bot conlai` trong nhóm) → bot báo còn bao
  nhiêu ngày.

⚠️ **Lưu ý về độ tin cậy:** cách dùng `@Người dùng` (không Reply) phụ thuộc
vào cấu trúc dữ liệu mention mà Zalo gửi về, hiện chưa có tài liệu công khai
xác nhận 100%. Nếu cấp bằng cách TAG tên mà bot báo "Không xác định được
người cần cấp/thu ngày", hãy **dùng cách Reply** ở trên — cách này không
phụ thuộc cấu trúc mention nên luôn hoạt động. Nếu vẫn muốn dùng cách TAG,
gửi lại dòng log `[DEBUG] ... entities=...` trên Railway để mình chỉnh
`extractMentionedUserIds()` cho khớp đúng field Zalo trả về.

## ✅ Cập nhật: bot giờ trả lời được cả trong NHÓM lẫn chat riêng

Theo quy định của Zalo Bot Platform, khi bot ở trong **nhóm**, bot chỉ nhận
được tin nhắn khi có người **@ TAG tên bot** (VD: `@Bot NguyenNhan .help`)
hoặc **Trả lời (Reply/Quote)** 1 tin bot đã gửi trước đó — nhắn trơn `.help`
không TAG sẽ không tới được bot, đây là giới hạn của Zalo chứ không phải lỗi
code. `server.js` giờ tự cắt bỏ phần `@Tên Bot ` khỏi tin nhắn trước khi xử
lý, để lệnh và các câu trả lời từng bước (`.td` → khung giờ → ngày → mẫu
ảnh) đều nhận diện được dù gõ trong nhóm.

**Bạn nên đặt thêm 1 biến môi trường trên Railway để việc cắt mention chính
xác 100%:**
- `BOT_DISPLAY_NAME` = đúng tên bạn đặt cho bot, VD: `Bot NguyenNhan`

Nếu không đặt, code vẫn tự đoán bằng heuristic (dựa vào ký tự `.` hoặc số/ngày
ở cuối câu), nhưng đặt đúng tên vẫn chắc chắn hơn.

**Cách dùng trong nhóm:**
- Gõ lệnh: `@Bot NguyenNhan .help` hoặc `@Bot NguyenNhan .td 60967899`
- Trả lời các bước tiếp theo (chọn khung giờ, ngày, mẫu ảnh): TAG bot lại
  kèm câu trả lời, VD `@Bot NguyenNhan 3`, hoặc bấm giữ tin nhắn gần nhất
  của bot rồi chọn **Trả lời (Reply)** và gõ câu trả lời vào đó.
- Nhắn riêng (1-1) với bot thì dùng như bình thường, không cần TAG.

**Lưu ý quan trọng khác đã sửa:** trước đây nếu 2 người trong cùng 1 nhóm
cùng dùng `.td`, dữ liệu và trạng thái hội thoại của họ sẽ bị đè lên nhau
(vì code cũ lưu theo ID của **nhóm**, không phải theo từng người). Giờ đã
sửa để lưu theo ID người gửi thật, nên nhiều người trong cùng nhóm dùng bot
song song vẫn không bị lẫn dữ liệu.

Nếu sau khi deploy mà bot vẫn im lặng trong nhóm, vào **Railway → Deployments
→ View Logs**, tìm dòng bắt đầu bằng `[DEBUG] chatId=...` — dòng đó cho biết
chính xác Zalo gửi text gì về khi bạn TAG bot, gửi lại dòng đó để chỉnh tiếp
`stripMention()` cho khớp 100% nếu cần.

## Lưu ý vận hành
- `data.json` lưu trên Railway sẽ **mất khi container restart** — nếu cần lưu lâu dài, cân nhắc dùng DB (Railway có Postgres/Redis add-on miễn phí ở mức nhỏ).
- Zalo Bot Platform còn khá mới, một vài chi tiết API (tên field trong webhook, giới hạn sendPhoto) có thể lệch so với những gì mình viết dựa trên tài liệu hiện có — nếu gặp lỗi cụ thể, gửi log lại để mình chỉnh tiếp.
