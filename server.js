require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const { sendText, sendPhotoByUrl, deleteMessage } = require("./zaloApi");
const SECRET_TOKEN = process.env.ZALO_WEBHOOK_SECRET;
const {
  KHUNG_GIO, XOA_REGEX,
  findMatches, getMatchDetail, findPlayer,
  toTimestamp, todayVN,
} = require("./ffGarena");
const { computeChampionBoard, mergeTeams } = require("./ffChampion");
const {
  drawBxhImage,
  drawStandingsTemplateImage,
  drawBluelockTemplateImage,
  drawHkTemplateImage,
  drawChainTemplateImage,
  drawFreefireTemplateImage,
  drawFreefire2TemplateImage,
  drawHxhTemplateImage,
  drawMinecraftTemplateImage,
  drawKittyScrimTemplateImage,
  drawFreefireClassicTemplateImage,
  drawBluelockScrimTemplateImage,
  drawOverallStandingTemplateImage,
  drawSimpleBxhTemplateImage,
  drawBxhTongTemplateImage,
  drawKaitoDarkTemplateImage,
  drawKaitoLightTemplateImage,
  drawTetBxhTongTemplateImage,
  drawOnepieceTemplateImage,
  drawSrimTemplateImage,
  drawZoroTemplateImage,
} = require("./ffImages");

// ============================================================
// LƯỚI AN TOÀN TOÀN CỤC — QUAN TRỌNG
// Mặc định, Node.js (từ bản 15 trở lên) sẽ TỰ SẬP TOÀN BỘ PROCESS nếu
// có 1 promise bị reject mà không ai .catch()/try-catch bắt kịp lúc đó
// ("unhandled rejection"). Trước đây điều này từng xảy ra: 1 người dùng
// gõ lệnh gặp lỗi nhỏ (VD: thiếu 1 file ảnh mẫu) → cả bot sập, ảnh hưởng
// TẤT CẢ người dùng khác, không riêng người gặp lỗi.
// 2 handler dưới đây chặn việc sập toàn bộ: chỉ log lỗi ra, KHÔNG kill
// process. Đây là lưới an toàn cuối cùng — không thay thế cho việc bắt
// lỗi đúng chỗ trong code, nhưng đảm bảo 1 lỗi lẻ không giết cả server.
// ============================================================
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection (đã chặn, server KHÔNG sập):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught Exception (đã chặn, server KHÔNG sập):", err);
});

const app = express();
app.use(express.json());

// ============================================================
// HOST ẢNH TẠM QUA 1 ROUTE CÔNG KHAI — QUAN TRỌNG
// Zalo Bot Platform's sendPhoto yêu cầu 1 URL ảnh công khai (photo_url),
// KHÔNG nhận upload file nhị phân trực tiếp qua multipart như Telegram
// (đã xác nhận qua SDK chính thức khác: send_photo(chat_id, caption,
// photo_url)). Vì bot tự vẽ ảnh động (canvas), không có sẵn URL — nên
// phải tự lưu buffer tạm trong bộ nhớ, phát ra 1 link dạng
// "<domain>/img/<id>.png", rồi đưa link đó cho Zalo tải về.
// Ảnh tự xoá sau IMAGE_TTL_MS để không phình bộ nhớ theo thời gian.
// ============================================================
const imageStore = new Map(); // id -> { buffer, mime, createdAt }
const IMAGE_TTL_MS = 10 * 60 * 1000; // giữ ảnh 10 phút là đủ để Zalo tải về

function storeImage(buffer, mime = "image/png") {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  imageStore.set(id, { buffer, mime, createdAt: Date.now() });
  return id;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, v] of imageStore.entries()) {
    if (now - v.createdAt > IMAGE_TTL_MS) imageStore.delete(id);
  }
}, 60 * 1000);

app.get("/img/:id.png", (req, res) => {
  const item = imageStore.get(req.params.id);
  if (!item) return res.sendStatus(404);
  res.set("Content-Type", item.mime);
  res.send(item.buffer);
});

// Domain công khai của bot — PHẢI đặt biến môi trường PUBLIC_BASE_URL
// trên Railway = đúng domain bạn dùng làm Webhook URL, VD:
// PUBLIC_BASE_URL=https://xxx.up.railway.app  (KHÔNG có dấu / ở cuối)
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

// Lưu buffer ảnh + trả về URL công khai để gửi cho Zalo. Nếu thiếu biến
// PUBLIC_BASE_URL, báo lỗi rõ ràng ngay thay vì tạo ra link hỏng.
function publicImageUrl(buffer) {
  if (!PUBLIC_BASE_URL) {
    throw new Error(
      "Thiếu biến môi trường PUBLIC_BASE_URL trên Railway (cần đặt = domain Railway của bạn, VD https://xxx.up.railway.app) để tạo link ảnh công khai cho Zalo."
    );
  }
  const id = storeImage(buffer);
  return `${PUBLIC_BASE_URL}/img/${id}.png`;
}

// ============================================================
// LỆNH .anh — RANDOM 1 ẢNH TRONG THƯ MỤC /images — QUAN TRỌNG
// Bạn tự bỏ file ảnh (jpg/jpeg/png/gif/webp) vào thư mục "images" nằm
// CÙNG CẤP với server.js. Mỗi lần ai đó gõ ".anh", bot sẽ:
//   1) Đọc danh sách file trong thư mục "images"
//   2) Chọn ngẫu nhiên 1 file
//   3) Gửi ảnh đó qua Zalo (dùng chính route tĩnh /images/<tên file>)
// Thêm ảnh mới: chỉ cần copy file vào thư mục "images", KHÔNG cần sửa
// code hay khởi động lại bot — lần gõ .anh tiếp theo sẽ tự thấy ảnh mới.
// ============================================================
const IMAGES_DIR = path.join(__dirname, "images");
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
app.use("/images", express.static(IMAGES_DIR));

const ALLOWED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
function pickRandomImageUrl() {
  if (!PUBLIC_BASE_URL) {
    throw new Error(
      "Thiếu biến môi trường PUBLIC_BASE_URL trên Railway (cần đặt = domain Railway của bạn) để tạo link ảnh công khai cho Zalo."
    );
  }
  const files = fs.readdirSync(IMAGES_DIR)
    .filter((f) => ALLOWED_IMAGE_EXT.has(path.extname(f).toLowerCase()));
  if (files.length === 0) return null;
  const picked = files[Math.floor(Math.random() * files.length)];
  return `${PUBLIC_BASE_URL}/images/${encodeURIComponent(picked)}`;
}

const PREFIX = process.env.PREFIX || ".";
const DATA_FILE = path.join(__dirname, "data.json");

// Tỷ giá quy đổi TIỀN → LƯỢT dùng cho lệnh "thanhtoan" (admin/CTV xác nhận
// đã nhận tiền chuyển khoản, bot tự quy đổi ra số lượt tương ứng). Đặt biến
// môi trường RATE_VND_PER_LUOT trên Railway nếu muốn đổi tỷ giá, mặc định
// 250đ = 1 lượt.
const RATE_VND_PER_LUOT = parseInt(process.env.RATE_VND_PER_LUOT || "250", 10);

// Phiên bản bot — chỉ dùng để hiện trong lệnh ".version" cho người dùng/
// admin biết đang chạy bản nào. Tự tay đổi số này mỗi khi deploy bản mới
// (không có gì tự động cập nhật).
const BOT_VERSION = "1.0.0";
// Mốc thời gian server KHỞI ĐỘNG — dùng để tính ".uptime" (bot đã chạy
// liên tục bao lâu kể từ lần start/deploy gần nhất, KHÔNG phải tổng thời
// gian tồn tại của bot).
const SERVER_STARTED_AT = Date.now();

// ============================================================
// TÊN HIỂN THỊ CỦA BOT — dùng để cắt bỏ phần "@Tên Bot " khi người dùng
// TAG bot trong nhóm. Đặt biến môi trường BOT_DISPLAY_NAME đúng tên bạn
// đặt cho bot (VD: "Bot NguyenNhan") để việc cắt mention chính xác 100%.
// Nếu không đặt, code vẫn cố tự đoán bằng heuristic bên dưới, nhưng kém
// chắc chắn hơn.
// ============================================================
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || "";

// ============================================================
// XỬ LÝ TIN NHẮN CÓ TAG (@Tên Bot) — QUAN TRỌNG CHO NHÓM
// Theo tài liệu Zalo Bot Platform, khi bot ở trong NHÓM, bot CHỈ nhận
// được tin nhắn khi: (1) người dùng @ nhắc tên Bot, hoặc (2) người dùng
// "Trả lời" (Reply/Quote) 1 tin nhắn mà Bot đã gửi trước đó. Ở dạng (1),
// nội dung text gửi về webhook thường có dạng "@Tên Bot phần lệnh thật",
// ví dụ "@Bot NguyenNhan .help" hoặc "@Bot NguyenNhan 3" (khi đang trả
// lời bước chọn khung giờ/mẫu ảnh). Nếu không cắt bỏ phần "@Tên Bot "
// này thì text.startsWith(PREFIX) sẽ luôn sai, và số "3" gõ trong bước
// hội thoại cũng không khớp regex — bot sẽ im lặng dù đã "Đã nhận".
// Hàm dưới đây cắt phần mention đi, chỉ giữ lại nội dung thật sự.
// ============================================================
function stripMention(rawText) {
  let t = (rawText || "").trim();
  if (!t.startsWith("@")) return t;

  // Ưu tiên cắt chính xác theo BOT_DISPLAY_NAME nếu đã cấu hình.
  if (BOT_DISPLAY_NAME) {
    const escaped = BOT_DISPLAY_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("^@\\s*" + escaped + "\\s*", "i");
    if (re.test(t)) return t.replace(re, "").trim();
  }

  // Heuristic dự phòng #1: nếu phần còn lại chứa PREFIX lệnh (VD "."),
  // cắt thẳng tới đó — phù hợp với các tin dạng "@Bot NguyenNhan .help".
  const idxPrefix = t.indexOf(PREFIX);
  if (idxPrefix > 0) return t.slice(idxPrefix).trim();

  // Heuristic dự phòng #2: nếu phần còn lại là 1 câu trả lời ngắn cho
  // luồng hội thoại (số 1-8, số 1-5, hoặc ngày DD/MM/YYYY) nằm ở CUỐI
  // chuỗi, lấy đúng "từ" cuối cùng đó — phù hợp với "@Bot NguyenNhan 3".
  const wordsForFallback = t.split(/\s+/);
  const lastWord = wordsForFallback[wordsForFallback.length - 1];
  if (/^([1-8]|\d{2}\/\d{2}\/\d{4})$/.test(lastWord)) return lastWord;

  // Không đoán được chắc chắn — trả về nguyên văn (đã trim) để log lại
  // và người phát triển có thể xem log Railway rồi chỉnh BOT_DISPLAY_NAME.
  return t;
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (e) { console.error("loadData error:", e.message); }
  return {};
}
function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveData error:", e.message); }
}
const playerData = loadData();

// ============================================================
// QUẢN LÝ SỐ NGÀY ĐƯỢC PHÉP DÙNG BOT (ADMIN CẤP/THU HỒI)
// ============================================================
// ADMIN_IDS: danh sách ID Zalo (id thật của người dùng, KHÔNG phải tên)
// được phép cấp/thu ngày sử dụng cho người khác. Đặt trên Railway, cách
// nhau bằng dấu phẩy, VD: ADMIN_IDS=1234567890,9876543210
// Cách lấy ID của chính bạn: nhắn .whoami với bot (lệnh thêm bên dưới),
// bot sẽ trả lời đúng ID Zalo của bạn để bạn tự thêm mình vào ADMIN_IDS.
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const ACCESS_FILE = path.join(__dirname, "access.json");
function loadAccess() {
  try {
    if (fs.existsSync(ACCESS_FILE)) return JSON.parse(fs.readFileSync(ACCESS_FILE, "utf-8"));
  } catch (e) { console.error("loadAccess error:", e.message); }
  return {}; // { userId: { expiresAt: <timestamp ms>, name: "..." } }
}
function saveAccess(data) {
  try { fs.writeFileSync(ACCESS_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveAccess error:", e.message); }
}
const accessData = loadAccess();

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// ============================================================
// CTV (CỘNG TÁC VIÊN) — dưới quyền admin, chỉ được CẤP ngày (add), KHÔNG
// được THU ngày (tru), và không được tự thêm/xoá CTV khác (chỉ admin mới
// quản lý danh sách CTV). Lưu vào file riêng để admin thêm/xoá CTV bằng
// lệnh chat, không cần sửa biến môi trường + redeploy như ADMIN_IDS.
// ============================================================
const CTV_FILE = path.join(__dirname, "ctv.json");
function loadCtv() {
  try {
    if (fs.existsSync(CTV_FILE)) return JSON.parse(fs.readFileSync(CTV_FILE, "utf-8"));
  } catch (e) { console.error("loadCtv error:", e.message); }
  return []; // [ "id1", "id2", ... ]
}
function saveCtv(list) {
  try { fs.writeFileSync(CTV_FILE, JSON.stringify(list, null, 2), "utf-8"); }
  catch (e) { console.error("saveCtv error:", e.message); }
}
let ctvIds = loadCtv();

function isCtv(userId) {
  return ctvIds.includes(String(userId));
}
function addCtv(userId) {
  const id = String(userId);
  if (!ctvIds.includes(id)) { ctvIds.push(id); saveCtv(ctvIds); }
}
function removeCtv(userId) {
  const id = String(userId);
  if (ctvIds.includes(id)) { ctvIds = ctvIds.filter(x => x !== id); saveCtv(ctvIds); }
}

// Không có mục trong access.json = chưa từng được cấp ngày nào = 0 ngày.
function daysLeft(userId) {
  const entry = accessData[String(userId)];
  if (!entry || !entry.expiresAt) return 0;
  const ms = entry.expiresAt - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

// Định dạng số mili-giây bot đã chạy liên tục thành chuỗi dễ đọc, dùng
// cho lệnh ".uptime" (VD: "2 ngày 3h 15p").
function formatUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const parts = [];
  if (days) parts.push(`${days} ngày`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}p`);
  if (!days && !hours) parts.push(`${secs}s`);
  return parts.join(" ") || "0s";
}

// ============================================================
// LƯỢT SỬ DỤNG LỆNH .td (NẠP LƯỢT) — QUAN TRỌNG
// Đây là 1 LỚP QUYỀN DÙNG BOT RIÊNG, chạy SONG SONG với hệ "ngày sử dụng"
// (accessData) ở trên — KHÔNG thay thế. Khi ai đó gõ .td, thứ tự ưu tiên
// kiểm tra (xem checkTdAccess()) là:
//   1) Admin              → luôn dùng được, không tốn ngày lẫn lượt.
//   2) Box đang vô hạn    → mọi người trong nhóm dùng được, không tốn gì.
//   3) Còn NGÀY sử dụng   → dùng được, KHÔNG trừ lượt (ngày ưu tiên hơn).
//   4) Còn LƯỢT (luotData)→ dùng được, trừ đúng 1 lượt cho lần gõ .td này.
//   Không rơi vào cả 4 trường hợp trên → báo lỗi, mời liên hệ admin/CTV.
//
// Lượt bị trừ NGAY khi lệnh .td được chấp nhận (accountId hợp lệ, chuẩn bị
// hỏi khung giờ) — KHÔNG chờ tới bước cuối cùng (chọn mẫu ảnh) mới trừ, để
// logic đơn giản, dễ hiểu cho người dùng ("gõ .td 1 phát là tốn 1 lượt").
// File luot.json lưu độc lập, không đụng access.json / boxaccess.json.
// ============================================================
const LUOT_FILE = path.join(__dirname, "luot.json");
function loadLuot() {
  try {
    if (fs.existsSync(LUOT_FILE)) return JSON.parse(fs.readFileSync(LUOT_FILE, "utf-8"));
  } catch (e) { console.error("loadLuot error:", e.message); }
  return {}; // { userId: { luot: <số lượt còn>, name: "..." } }
}
function saveLuot(data) {
  try { fs.writeFileSync(LUOT_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveLuot error:", e.message); }
}
const luotData = loadLuot();

// Không có mục trong luot.json = chưa từng được nạp = 0 lượt.
function luotLeft(userId) {
  const entry = luotData[String(userId)];
  return entry?.luot > 0 ? entry.luot : 0;
}

// Cộng/trừ N lượt cho userId. Không cho xuống dưới 0 (thu quá số đang có
// thì về 0, không âm).
function addLuot(userId, deltaLuot, targetName) {
  const key = String(userId);
  const next = Math.max(0, luotLeft(key) + deltaLuot);
  luotData[key] = { luot: next, name: targetName || luotData[key]?.name || "" };
  saveLuot(luotData);
  return next;
}

// Trừ đúng 1 lượt của userId (gọi khi họ gõ .td và access CHỈ đến từ lượt,
// không phải từ ngày/box/admin). Trả về số lượt còn lại sau khi trừ.
function consumeOneLuot(userId) {
  return addLuot(userId, -1);
}

// Xác định 1 người có được phép gõ .td hay không, VÀ nhờ đâu mà được phép
// (để biết có cần trừ lượt hay không). Trả về:
//   { allowed: true,  source: "admin" | "box" | "ngay" | "luot" }
//   { allowed: false, source: null }
function checkTdAccess(userId, chatId) {
  if (isAdmin(userId)) return { allowed: true, source: "admin" };
  if (chatId && boxDaysLeft(chatId) > 0) return { allowed: true, source: "box" };
  if (daysLeft(userId) > 0) return { allowed: true, source: "ngay" };
  if (luotLeft(userId) > 0) return { allowed: true, source: "luot" };
  return { allowed: false, source: null };
}

// ============================================================
// VOHANBOX — cấp "vô hạn" cho CẢ 1 NHÓM (box) trong N ngày. Trong thời
// gian đó, MỌI thành viên nhắn lệnh .td trong nhóm này đều được dùng bot,
// không cần admin cấp ngày riêng cho từng người. Lưu theo chatId (không
// phải theo userId) vào file riêng.
// ============================================================
const BOX_FILE = path.join(__dirname, "boxaccess.json");
function loadBoxAccess() {
  try {
    if (fs.existsSync(BOX_FILE)) return JSON.parse(fs.readFileSync(BOX_FILE, "utf-8"));
  } catch (e) { console.error("loadBoxAccess error:", e.message); }
  return {}; // { chatId: { expiresAt: <timestamp ms> } }
}
function saveBoxAccess(data) {
  try { fs.writeFileSync(BOX_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveBoxAccess error:", e.message); }
}
const boxAccessData = loadBoxAccess();

// ============================================================
// CHỐNG PHÁ BOX (ANTI-RAID) — 3 luật độc lập, BẬT/TẮT RIÊNG theo từng
// nhóm (chatId): antispam (spam tin liên tục), antitag (tag toàn bộ
// nhóm), antilink (gửi link ngoài). Admin/CTV và người trong whitelist
// LUÔN được miễn trừ (không bị áp luật này).
//
// GIỚI HẠN QUAN TRỌNG (đã xác nhận ở phần "sổ danh bạ" bên dưới): Zalo
// Bot Platform hiện KHÔNG gửi kèm entities/mentions trong webhook — nên
// antitag chỉ phát hiện được qua CHỮ trong tin nhắn (VD gõ "@all",
// "@mọi người"), KHÔNG phát hiện được việc bấm chọn "Tag mọi người" từ
// menu Zalo nếu Zalo không chèn chữ tương ứng vào text. Cần TEST THỰC TẾ
// sau khi deploy — nếu tag qua menu Zalo không bị bắt, xem log Railway
// dòng "[DEBUG]" của tin đó rồi báo lại để bổ sung thêm mẫu chữ nhận
// diện.
// ============================================================
const ANTIRAID_FILE = path.join(__dirname, "antiraid.json");
function loadAntiraid() {
  try {
    if (fs.existsSync(ANTIRAID_FILE)) return JSON.parse(fs.readFileSync(ANTIRAID_FILE, "utf-8"));
  } catch (e) { console.error("loadAntiraid error:", e.message); }
  return {}; // { chatId: { antispam: bool, antitag: bool, antilink: bool } }
}
function saveAntiraid(data) {
  try { fs.writeFileSync(ANTIRAID_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveAntiraid error:", e.message); }
}
const antiraidData = loadAntiraid();

function getAntiraidRules(chatId) {
  return antiraidData[String(chatId)] || { antispam: false, antitag: false, antilink: false };
}
function setAntiraidRule(chatId, rule, value) {
  const key = String(chatId);
  if (!antiraidData[key]) antiraidData[key] = { antispam: false, antitag: false, antilink: false };
  antiraidData[key][rule] = value;
  saveAntiraid(antiraidData);
}

// Whitelist chống phá box — GLOBAL (áp dụng cho mọi nhóm), quản lý bằng
// lệnh chat, không phải sửa biến môi trường + redeploy.
const ANTIRAID_WHITELIST_FILE = path.join(__dirname, "antiraid-whitelist.json");
function loadAntiraidWhitelist() {
  try {
    if (fs.existsSync(ANTIRAID_WHITELIST_FILE)) return JSON.parse(fs.readFileSync(ANTIRAID_WHITELIST_FILE, "utf-8"));
  } catch (e) { console.error("loadAntiraidWhitelist error:", e.message); }
  return [];
}
function saveAntiraidWhitelist(list) {
  try { fs.writeFileSync(ANTIRAID_WHITELIST_FILE, JSON.stringify(list, null, 2), "utf-8"); }
  catch (e) { console.error("saveAntiraidWhitelist error:", e.message); }
}
let antiraidWhitelist = loadAntiraidWhitelist();
function isAntiraidWhitelisted(userId) {
  return antiraidWhitelist.includes(String(userId));
}
function addAntiraidWhitelist(userId) {
  const id = String(userId);
  if (!antiraidWhitelist.includes(id)) { antiraidWhitelist.push(id); saveAntiraidWhitelist(antiraidWhitelist); }
}
function removeAntiraidWhitelist(userId) {
  const id = String(userId);
  if (antiraidWhitelist.includes(id)) {
    antiraidWhitelist = antiraidWhitelist.filter(x => x !== id);
    saveAntiraidWhitelist(antiraidWhitelist);
  }
}

// Theo dõi SPAM trong bộ nhớ (KHÔNG lưu file — chỉ cần biết trong vài
// giây gần nhất, mất khi bot restart cũng không sao). Key: "chatId:fromId".
const spamTracker = {};
const SPAM_WINDOW_MS = 3000; // 3 giây
const SPAM_MAX_MSG = 2;      // ≥2 tin trong khung giờ trên = vi phạm
function isSpamming(chatId, fromId) {
  const key = `${chatId}:${fromId}`;
  const now = Date.now();
  const recent = (spamTracker[key] || []).filter(t => now - t < SPAM_WINDOW_MS);
  recent.push(now);
  spamTracker[key] = recent;
  return recent.length >= SPAM_MAX_MSG;
}
// Dọn bộ nhớ định kỳ để không phình theo thời gian.
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(spamTracker)) {
    spamTracker[key] = spamTracker[key].filter(t => now - t < SPAM_WINDOW_MS);
    if (spamTracker[key].length === 0) delete spamTracker[key];
  }
}, 30 * 1000);

// Phát hiện "tag toàn bộ nhóm" — chỉ nhận diện được qua CHỮ trong tin
// nhắn (xem ghi chú giới hạn ở trên).
function containsTagAll(text) {
  return /@all\b/i.test(text) || /@everyone\b/i.test(text) || /@\s*m[oọ]i\s*ng[uư][oờ]i/i.test(text);
}

// Phát hiện link BÊN NGOÀI (không phải domain Zalo, và không phải link
// ảnh do chính bot tạo ra qua PUBLIC_BASE_URL).
const ANTILINK_ALLOWED_HOSTS = ["zalo.me", "zaloapp.com", "zapps.me"];
function containsExternalLink(text) {
  const matches = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,})/gi);
  if (!matches) return false;
  return matches.some((m) => {
    try {
      const withScheme = /^https?:\/\//i.test(m) ? m : `http://${m}`;
      const host = new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
      if (PUBLIC_BASE_URL && withScheme.startsWith(PUBLIC_BASE_URL)) return false;
      return !ANTILINK_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    } catch {
      return true; // không parse được URL nhưng có vẻ là link → coi là vi phạm cho chắc
    }
  });
}

// ============================================================
// XỬ LÝ CHÍNH — gọi ở ĐẦU handleMessage, TRƯỚC mọi lệnh khác. Nếu phát
// hiện vi phạm: xoá tin nhắn (nếu Zalo hỗ trợ) + THU HẾT ngày sử dụng
// bot của người vi phạm + cảnh báo trong nhóm + báo riêng cho admin.
// Trả về true nếu ĐÃ xử lý xong (server.js sẽ return luôn, không xử lý
// tin đó như lệnh bình thường nữa).
//
// ⚠️ KHÔNG TỰ KICK ĐƯỢC: đã xác nhận qua thực tế (ảnh chụp màn hình
// Zalo 15/08/2026) — Zalo KHÔNG cho gán tài khoản Bot làm phó nhóm/quản
// trị viên trong nhóm (menu "Thêm phó nhóm" khoá hẳn ô chọn của Bot, và
// menu thao tác với Bot chỉ có "Xem thông tin"/"Xoá khỏi nhóm", không có
// "Đặt làm phó nhóm"). Không có quyền quản trị viên thì không kick được
// ai — đây là giới hạn CỨNG của nền tảng Zalo, không phải lỗi code. Vì
// vậy hình phạt đổi thành: thu hết ngày dùng bot + cảnh báo để TRƯỞNG/
// PHÓ NHÓM THẬT tự tay kick thủ công.
// ============================================================
async function enforceAntiraid({ chatId, fromId, text, isGroup, message }) {
  if (!isGroup) return false; // chỉ áp dụng trong nhóm, không áp dụng chat riêng
  if (isAdmin(fromId) || isCtv(fromId) || isAntiraidWhitelisted(fromId)) return false;

  const rules = getAntiraidRules(chatId);
  if (!rules.antispam && !rules.antitag && !rules.antilink) return false;

  let reason = null;
  if (rules.antispam && isSpamming(chatId, fromId)) reason = "spam tin nhắn (≥2 tin trong 3 giây)";
  else if (rules.antitag && containsTagAll(text)) reason = "tag toàn bộ nhóm";
  else if (rules.antilink && containsExternalLink(text)) reason = "gửi link bên ngoài";

  if (!reason) return false;

  console.log(`[ANTIRAID] Vi phạm — chatId=${chatId} fromId=${fromId} lý do="${reason}" text=${JSON.stringify(text)}`);

  if (message?.message_id) {
    try { await deleteMessage(chatId, message.message_id); }
    catch (e) { console.error("[ANTIRAID] Xoá tin nhắn vi phạm thất bại:", e.response?.data || e.message); }
  }

  // Thu hết ngày sử dụng bot của người vi phạm (nếu họ đang có ngày dùng
  // .td thì mất luôn, coi như hình phạt).
  revokeAllDays(fromId);

  await sendText(
    chatId,
    `🚫 CẢNH BÁO CHỐNG PHÁ BOX\n` +
    `👤 ID: ${fromId}\n` +
    `⚠️ Lý do: ${reason}\n\n` +
    `Bot KHÔNG tự kick được (Zalo không cho Bot làm quản trị viên nhóm) — đã thu hết ngày sử dụng bot của người này. Nhờ Trưởng/Phó nhóm tự tay kick nếu cần.`
  );

  // Báo riêng cho từng admin để xử lý kịp thời.
  for (const adminId of ADMIN_IDS) {
    try {
      await sendText(
        adminId,
        `📩 [ANTIRAID] Vi phạm ở nhóm ${chatId}\n👤 ID: ${fromId}\n⚠️ Lý do: ${reason}\n(Đã thu hết ngày dùng bot của người này. Cần vào nhóm kick thủ công nếu muốn.)`
      );
    } catch (e) {
      console.error(`[ANTIRAID] Không báo được cho admin ${adminId}:`, e.response?.data || e.message);
    }
  }

  return true;
}

function boxDaysLeft(chatId) {
  const entry = boxAccessData[String(chatId)];
  if (!entry || !entry.expiresAt) return 0;
  const ms = entry.expiresAt - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}
function setBoxUnlimited(chatId, days) {
  const now = Date.now();
  const base = Math.max(now, boxAccessData[String(chatId)]?.expiresAt || 0);
  boxAccessData[String(chatId)] = { expiresAt: base + days * 86400000 };
  saveBoxAccess(boxAccessData);
  return boxDaysLeft(chatId);
}

// hasAccess giờ nhận thêm chatId (tuỳ chọn): nếu chatId đang trong thời
// gian "vô hạn box", TẤT CẢ thành viên trong nhóm đó đều được coi là có
// quyền, bất kể ngày riêng của họ còn hay hết.
function hasAccess(userId, chatId) {
  if (isAdmin(userId)) return true;
  if (chatId && boxDaysLeft(chatId) > 0) return true;
  return daysLeft(userId) > 0;
}

// ============================================================
// SETQR — lưu THÔNG TIN CHUYỂN KHOẢN + ẢNH QR THẬT (admin tự chụp/tải lên)
// cho từng nhóm/chat. Luồng 2 BƯỚC (giống .td):
//   BƯỚC 1: admin gõ "setqr Tên Chủ Khoản / Ngân Hàng / Số TK" (CHƯA cần
//           ảnh) → bot xác nhận lại thông tin, rồi yêu cầu gửi ẢNH QR.
//   BƯỚC 2: admin gửi 1 ẢNH QR (không cần caption) → bot tự nhận ảnh đó,
//           lưu lại cùng thông tin đã có ở bước 1.
// Sau khi hoàn tất, ai gõ "mã" hoặc "qr" trong nhóm/chat đó, bot tự trả
// lời đúng 3 dòng thông tin rồi gửi kèm CHÍNH ảnh QR đã lưu.
// ============================================================
const QR_FILE = path.join(__dirname, "qr.json");
function loadQrConfig() {
  try {
    if (fs.existsSync(QR_FILE)) return JSON.parse(fs.readFileSync(QR_FILE, "utf-8"));
  } catch (e) { console.error("loadQrConfig error:", e.message); }
  return {}; // { chatId: { name, bank, account, photoUrl } }
}
function saveQrConfig(data) {
  try { fs.writeFileSync(QR_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveQrConfig error:", e.message); }
}
const qrConfigData = loadQrConfig();

function setQrConfig(chatId, name, bank, account, photoUrl) {
  qrConfigData[String(chatId)] = { name, bank, account, photoUrl };
  saveQrConfig(qrConfigData);
}
function getQrConfig(chatId) {
  return qrConfigData[String(chatId)] || null;
}

// Cộng/trừ N ngày cho userId. Cộng thì tính từ hạn hiện tại nếu còn hạn,
// hoặc từ thời điểm hiện tại nếu đã hết/chưa có hạn. Trừ thì chỉ trừ vào
// hạn đang có, không lùi về quá khứ xa hơn cần thiết.
function addDays(userId, deltaDays, targetName) {
  const key = String(userId);
  const now = Date.now();
  const current = accessData[key]?.expiresAt || now;
  const base = current > now ? current : now;
  const newExpires = base + deltaDays * 86400000;
  accessData[key] = { expiresAt: newExpires, name: targetName || accessData[key]?.name || "" };
  saveAccess(accessData);
  return daysLeft(key);
}

// Thu HẾT ngày sử dụng bot của 1 người ngay lập tức (đặt hạn về "đã hết"
// = thời điểm hiện tại) — dùng làm hình phạt của CHỐNG PHÁ BOX khi
// KHÔNG kick được (xem ghi chú ở enforceAntiraid bên dưới).
function revokeAllDays(userId) {
  const key = String(userId);
  accessData[key] = { expiresAt: Date.now(), name: accessData[key]?.name || "" };
  saveAccess(accessData);
}

// ============================================================
// "SỔ DANH BẠ" TỰ HỌC: tên hiển thị ↔ ID Zalo
// ============================================================
// ĐÃ XÁC NHẬN qua log Railway thực tế (14/08/2026): payload webhook của
// Zalo Bot Platform hiện tại KHÔNG hề chứa reply_to_message lẫn bất kỳ
// field entities/mentions nào — dù người dùng Reply hay @tag đúng cách,
// object message chỉ có đúng {date, chat, message_id, from, text}. Vì
// vậy 2 hàm extractMentionedUserIds()/extractRepliedUserId() ở dưới sẽ
// LUÔN trả về null với dữ liệu Zalo gửi hiện nay — đây là giới hạn của
// nền tảng, không phải lỗi code, và không có cách nào lấy ID người được
// tag trực tiếp từ 1 tin nhắn duy nhất.
//
// Giải pháp thực tế: mỗi khi CÓ AI đó nhắn gì trong nhóm, object `from`
// luôn có {id, display_name} — nên bot tự lưu lại cặp tên↔ID này vào 1
// "sổ danh bạ" theo từng nhóm. Khi admin gõ "add 30 @Nam My", bot tra
// tên "Nam My" trong sổ danh bạ của đúng nhóm đó để tìm ra ID — chỉ cần
// người đó đã từng nhắn ÍT NHẤT 1 tin trong nhóm trước đó (kể cả tin cũ
// từ trước khi tính năng này được thêm cũng không tính, phải nhắn lại
// SAU khi bot đã redeploy bản này).
const DIRECTORY_FILE = path.join(__dirname, "directory.json");
function loadDirectory() {
  try {
    if (fs.existsSync(DIRECTORY_FILE)) return JSON.parse(fs.readFileSync(DIRECTORY_FILE, "utf-8"));
  } catch (e) { console.error("loadDirectory error:", e.message); }
  return {}; // { chatId: { [normalizedName]: { id, display_name } } }
}
function saveDirectory(data) {
  try { fs.writeFileSync(DIRECTORY_FILE, JSON.stringify(data, null, 2), "utf-8"); }
  catch (e) { console.error("saveDirectory error:", e.message); }
}
const directoryData = loadDirectory();

// Chuẩn hoá tên để so khớp không phân biệt hoa/thường, khoảng trắng thừa,
// hay dấu "@" người dùng có thể gõ kèm.
function normalizeName(name) {
  return (name || "").replace(/^@/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Gọi hàm này ở MỌI tin nhắn có fromId + display_name hợp lệ, để sổ danh
// bạ của nhóm luôn cập nhật theo thời gian thực.
function rememberSender(chatId, fromId, displayName) {
  if (!chatId || !fromId || !displayName) return;
  const key = String(chatId);
  if (!directoryData[key]) directoryData[key] = {};
  directoryData[key][normalizeName(displayName)] = { id: String(fromId), display_name: displayName };
  saveDirectory(directoryData);
}

// Tra tên trong sổ danh bạ của 1 nhóm cụ thể. Trả về ID nếu khớp chính
// xác tên đã chuẩn hoá; nếu không, thử khớp "chứa" (VD gõ thiếu dấu).
function lookupUserIdByName(chatId, name) {
  const book = directoryData[String(chatId)];
  if (!book) return null;
  const target = normalizeName(name);
  if (!target) return null;
  if (book[target]) return book[target].id;
  for (const [key, entry] of Object.entries(book)) {
    if (key.includes(target) || target.includes(key)) return entry.id;
  }
  return null;
}

// ============================================================
// XÁC ĐỊNH "NGƯỜI ĐƯỢC NHẮC TỚI" (@TAG người dùng) TRONG LỆNH ADMIN
// ============================================================
// Giữ lại 2 hàm này làm lớp thử đầu tiên (phòng khi Zalo sau này bổ sung
// field entities/reply vào payload) — nhưng với dữ liệu hiện tại chúng
// sẽ trả về null, và code sẽ tự rơi xuống dùng "sổ danh bạ" ở trên.
function extractMentionedUserIds(message) {
  const ids = [];
  const candidateArrays = [
    message.entities, message.mention_entities,
    message.mentions, message.mentioned_users,
  ].filter(Array.isArray);

  for (const arr of candidateArrays) {
    for (const e of arr) {
      const id = e?.user?.id ?? e?.user_id ?? e?.id;
      if (id) ids.push(String(id));
    }
  }
  return ids;
}
// Trả lời (Reply/Quote) — cách chắc chắn nhất để xác định người cần thao tác.
// Zalo Bot Platform chưa có tài liệu công khai xác nhận rõ tên field chứa
// tin nhắn được Reply, nên thử NHIỀU tên field phổ biến (kiểu Telegram và
// các biến thể khác) thay vì chỉ 1 field cố định như trước — nếu vẫn không
// bắt được, hàm sẽ trả về null và người dùng nên dùng cách gõ "add N" (mở
// hàm handleMessage) kèm chuyển sang @tag thay vì reply.
// extractRepliedUserInfo() trả về CẢ id lẫn display_name (dùng cho lệnh
// "id" — Reply vào ai đó để lấy ID của họ); extractRepliedUserId() bên
// dưới chỉ là bản rút gọn chỉ lấy id, giữ lại để không phải sửa các chỗ
// khác đang gọi nó.
function extractRepliedUserInfo(message) {
  const repliedMsg =
    message.reply_to_message ||
    message.replyToMessage ||
    message.reply_message ||
    message.replied_message ||
    message.quote ||
    message.quoted_message ||
    message.quoted_msg ||
    null;

  if (!repliedMsg) return null;

  const id =
    repliedMsg.from?.id ??
    repliedMsg.from_id ??
    repliedMsg.sender?.id ??
    repliedMsg.sender_id ??
    repliedMsg.user?.id ??
    repliedMsg.user_id ??
    repliedMsg.author?.id ??
    repliedMsg.author_id;

  const displayName =
    repliedMsg.from?.display_name ??
    repliedMsg.sender?.display_name ??
    repliedMsg.user?.display_name ??
    repliedMsg.author?.display_name ??
    repliedMsg.from?.name ??
    repliedMsg.sender?.name ??
    null;

  if (!id) return null;
  return { id: String(id), display_name: displayName || null };
}

function extractRepliedUserId(message) {
  return extractRepliedUserInfo(message)?.id || null;
}

// ============================================================
// TRA "NGƯỜI ĐÍCH" DÙNG CHUNG cho các lệnh tự phục vụ về LƯỢT (check,
// chuyenluot, thanhtoan) — cùng 4 lớp ưu tiên như "add"/"tru"/"naplt" ở
// trên: ID Zalo gõ thẳng → Reply → mention (Zalo hiện chưa gửi) → tra sổ
// danh bạ theo tên hiển thị (chỉ hoạt động trong nhóm).
function resolveTargetUserId(chatId, fromId, message, rest, isGroup) {
  const cleaned = (rest || "").trim();
  let targetId = /^[a-f0-9]{10,}$/i.test(cleaned) ? cleaned : null;
  if (!targetId) targetId = extractRepliedUserId(message);
  if (!targetId) {
    const mentioned = extractMentionedUserIds(message).filter((id) => id !== String(fromId));
    targetId = mentioned[mentioned.length - 1] || null;
  }
  if (!targetId && isGroup && cleaned) {
    targetId = lookupUserIdByName(chatId, cleaned);
  }
  return targetId;
}

// Lấy tên hiển thị đã học được (sổ danh bạ) của 1 ID trong 1 nhóm cụ thể,
// dùng để "auto nickname" khi báo kết quả check/chuyenluot/thanhtoan. Nếu
// chưa từng gặp tên nào khớp ID đó (VD chat riêng, hoặc họ chưa từng nhắn
// trong nhóm), trả về thẳng ID.
function getDisplayNameById(chatId, userId) {
  const book = directoryData[String(chatId)];
  if (book) {
    for (const entry of Object.values(book)) {
      if (entry.id === String(userId)) return entry.display_name;
    }
  }
  return String(userId);
}

// ============================================================
// TRÍCH URL ẢNH người dùng đính kèm (dùng cho lệnh "setqr ..." kèm ảnh).
// ============================================================
// GHI CHÚ QUAN TRỌNG (giống hệt tình huống Reply/mention trước đây): Zalo
// Bot Platform chưa có tài liệu công khai xác nhận field nào chứa ảnh
// người dùng gửi lên. Hàm dưới đây thử NHIỀU khả năng field phổ biến
// (kiểu Telegram "photo" là mảng, kiểu Messenger "attachments", hay field
// đơn giản "image_url"...). Nếu KHÔNG tìm thấy field ảnh nào phù hợp, hàm
// trả về null — lúc đó server.js sẽ tự in log "[DEBUG] full message
// (setqr, no photo found)=..." để gửi lại cho mình chỉnh đúng field, y
// hệt cách đã sửa thành công cho extractRepliedUserId() trước đó.
function extractPhotoUrl(message) {
  // Ưu tiên field nào rõ ràng LÀ URL (bắt đầu bằng http) trước — vì có
  // field chỉ chứa file_id nội bộ (không dùng gửi lại được).
  const candidates = [];

  // Kiểu Telegram: message.photo = [{file_id, url?, width, height}, ...]
  // — phần tử cuối thường là ảnh độ phân giải cao nhất.
  if (Array.isArray(message.photo) && message.photo.length) {
    const last = message.photo[message.photo.length - 1];
    candidates.push(last?.url, last?.file_url, last?.file_id);
  }
  // Kiểu field đơn: message.image / message.image_url / message.file
  if (message.image) {
    candidates.push(message.image.url, message.image.file_url, message.image.file_id, message.image);
  }
  candidates.push(message.image_url, message.photo_url);
  if (message.file) {
    candidates.push(message.file.url, message.file.file_url, message.file.file_id);
  }
  // Kiểu Messenger: message.attachments = [{type:"image", payload:{url}}]
  if (Array.isArray(message.attachments)) {
    for (const att of message.attachments) {
      candidates.push(att?.payload?.url, att?.url, att?.file_url);
    }
  }
  // Kiểu Zalo OA cũ: message.attachment.payload.url
  if (message.attachment) {
    candidates.push(message.attachment?.payload?.url, message.attachment?.url);
  }

  // Chọn candidate ĐẦU TIÊN là URL thật (http/https) — bỏ qua file_id nội
  // bộ vì sendPhotoByUrl cần 1 URL công khai để gửi lại được.
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

// ============================================================
// TRÍCH DANH SÁCH THÀNH VIÊN MỚI VÀO NHÓM (dùng để gửi tin chào mừng).
// ============================================================
// GHI CHÚ QUAN TRỌNG (giống hệt tình huống Reply/ảnh ở trên): Zalo Bot
// Platform chưa có tài liệu công khai xác nhận rõ tên field báo "có
// người mới vào nhóm". Hàm dưới đây thử NHIỀU khả năng phổ biến (kiểu
// Telegram "new_chat_members" là mảng user, và vài biến thể khác). Nếu
// sau khi deploy mà chào mừng KHÔNG hoạt động, xem log Railway dòng
// "[DEBUG] full update (chào mừng)=..." rồi gửi lại để chỉnh đúng field
// — y hệt cách đã sửa thành công cho extractRepliedUserId()/
// extractPhotoUrl() trước đó.
function extractNewMembers(message, update) {
  const raw =
    message?.new_chat_members ||
    message?.new_chat_participants ||
    message?.newChatMembers ||
    message?.new_members ||
    update?.new_chat_members ||
    update?.chat_member?.new_chat_member ||
    (message?.new_member ? [message.new_member] : null) ||
    (message?.member ? [message.member] : null);
  if (Array.isArray(raw) && raw.length) return raw;
  if (raw && typeof raw === "object") return [raw];
  return null;
}

// Lấy tên hiển thị của nhóm — cũng thử nhiều field phổ biến vì cùng lý
// do chưa có tài liệu chính thức xác nhận tên field.
function extractChatTitle(message, update) {
  return (
    message?.chat?.title ||
    message?.chat?.name ||
    update?.chat?.title ||
    update?.chat?.name ||
    message?.group?.name ||
    message?.group_name ||
    message?.chat_title ||
    null
  );
}

// Khoá theo "chatId:fromId" (xem pendingKey bên dưới) để hỗ trợ cả chat
// riêng (1-1) LẪN chat nhóm — trong nhóm, nhiều người có thể cùng lúc ở
// giữa luồng .td mà không bị đè state của nhau.
const pendingStep = {}; // { "chatId:fromId": { step, accountId, mode, ... } }

// Timeout riêng cho BƯỚC 2 của "setqr" (chờ ảnh QR): nếu quá 1 PHÚT admin
// không gửi ảnh, tự động xoá state đang chờ để tránh treo mãi (VD: admin
// gõ "setqr ..." xong rồi quên/bỏ dở, sau đó không muốn ảnh cũ tự dưng
// được gán nhầm vào QR nếu họ gõ setqr lại nhiều lần).
const SETQR_PHOTO_TIMEOUT_MS = 60 * 1000;
const setqrTimeouts = {}; // { pendingKey: NodeJS.Timeout }

function armSetqrTimeout(pendingKey, chatId) {
  if (setqrTimeouts[pendingKey]) clearTimeout(setqrTimeouts[pendingKey]);
  setqrTimeouts[pendingKey] = setTimeout(() => {
    if (pendingStep[pendingKey]?.step === "setqr_photo") {
      delete pendingStep[pendingKey];
      sendText(chatId, "⌛ Đã huỷ chờ ảnh QR do quá 1 phút không gửi. Gõ lại lệnh setqr nếu cần.")
        .catch(e => console.error("setqr timeout notice error:", e.message));
    }
    delete setqrTimeouts[pendingKey];
  }, SETQR_PHOTO_TIMEOUT_MS);
}
function disarmSetqrTimeout(pendingKey) {
  if (setqrTimeouts[pendingKey]) {
    clearTimeout(setqrTimeouts[pendingKey]);
    delete setqrTimeouts[pendingKey];
  }
}

// ============================================================
// WEBHOOK — Zalo gửi sự kiện tin nhắn người dùng gửi tới OA vào đây
// ============================================================
app.post("/webhook", async (req, res) => {
  // Xác minh request thật sự đến từ Zalo bằng Secret Token đã đặt lúc setWebhook
  const incomingSecret = req.get("X-Bot-Api-Secret-Token");
  if (SECRET_TOKEN && incomingSecret !== SECRET_TOKEN) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // trả 200 ngay, xử lý bất đồng bộ bên dưới

  try {
    const body = req.body || {};
    // Payload dạng "update" giống Telegram Bot API. Một số client bọc trong
    // {result: {...}}, một số gửi thẳng — thử cả hai để chắc chắn bắt được.
    const update = body.result || body;
    const message = update.message;

    // ══════════════════════════════════════════════════════════
    // SỰ KIỆN THÀNH VIÊN MỚI VÀO NHÓM — chào mừng tự động.
    // Kiểm tra TRƯỚC bước "if (!message) return" bên dưới vì sự kiện này
    // có thể không có field "message" bình thường (tuỳ Zalo gửi dạng gì).
    // Gửi 2 tin: (1) chào mừng kèm tên nhóm, (2) lưu ý phải @ TAG bot mới
    // dùng được lệnh trong nhóm (do giới hạn nền tảng Zalo — xem ghi chú
    // ở groupHint trong handleMessage()).
    // ══════════════════════════════════════════════════════════
    const newMembers = extractNewMembers(message, update);
    if (newMembers) {
      const welcomeChatId = message?.chat?.id || update.chat_id || update.chat?.id;
      const groupTitle = extractChatTitle(message, update);
      console.log(`[DEBUG] full update (chào mừng)=${JSON.stringify(body)}`);
      if (welcomeChatId) {
        try {
          await sendText(
            welcomeChatId,
            `👋 Chào Mừng bạn đến với ${groupTitle || "nhóm"}!`
          );
          await sendText(
            welcomeChatId,
            `⚠️ Lưu ý: trong nhóm, bạn cần @ TAG bot kèm lệnh thì bot mới nhận được (VD: @Tên Bot .help) — nhắn trơn không tag, bot sẽ không phản hồi.`
          );
        } catch (e) {
          console.error("Gửi tin chào mừng thất bại:", e.response?.data || e.message);
        }
      } else {
        console.log("[DEBUG] Phát hiện thành viên mới nhưng không xác định được chatId để chào mừng.");
      }
      return;
    }

    if (!message) {
      console.log("[DEBUG] Webhook body không có field message, log để kiểm tra cấu trúc:", JSON.stringify(body));
      return;
    }

    // chatId = nơi để TRẢ LỜI (group id khi ở trong nhóm, user id khi chat riêng)
    const chatId = message.chat?.id || update.chat_id || message.from?.id;
    // fromId = người THẬT SỰ gửi tin (khác chatId khi ở trong nhóm — nhiều
    // người có thể cùng thao tác trong 1 nhóm, không được gộp chung data)
    const fromId = message.from?.id || chatId;
    // Ở nhóm, chat.id (id nhóm) khác id người gửi. Ở chat riêng, 2 giá trị
    // này thường trùng nhau. Đây là cách suy ra isGroup mà không cần biết
    // trước tên field "type"/"chat_type" chính xác của Zalo.
    const isGroup = String(chatId) !== String(fromId);

    const rawText = (message.text || message.caption || "").trim();
    const text = stripMention(rawText);

    // Ảnh người dùng đính kèm (dùng cho BƯỚC 2 của "setqr" — gửi ẢNH QR
    // sau khi đã xác nhận thông tin ở bước 1, có thể KHÔNG kèm caption gì
    // — nên phải trích TRƯỚC khi return sớm vì tin ảnh có thể không có
    // text/rawText nào cả).
    const photoUrl = extractPhotoUrl(message);

    if (!chatId) return;

    // Khoá lưu trạng thái hội thoại nhiều bước: khoá theo CẢ nhóm lẫn người
    // gửi, để 2 người khác nhau trong cùng 1 nhóm cùng dùng .td/setqr không
    // bị đè state của nhau. Phải tính TRƯỚC bước lọc "!text" bên dưới, vì
    // BƯỚC 2 của setqr (chờ ảnh QR) cần tra được state dù tin nhắn ảnh đó
    // không hề có text/caption nào.
    const pendingKey = `${chatId}:${fromId}`;
    // Khoá lưu data.json: luôn theo NGƯỜI THẬT (fromId), không theo chatId,
    // để nhiều người trong cùng nhóm không bị ghi đè dữ liệu của nhau.
    const dataKey = fromId;

    // Đang ở BƯỚC 2 của "setqr" (chờ admin gửi ẢNH QR) — cho phép đi tiếp
    // dù tin nhắn này không có text/caption nào, miễn là có ảnh đính kèm.
    const waitingQrPhoto = pendingStep[pendingKey]?.step === "setqr_photo";

    // Cho phép đi tiếp nếu có text, HOẶC đang chờ ảnh QR và tin này có ảnh.
    // Các trường hợp còn lại (ảnh không liên quan, sticker...) vẫn bỏ qua.
    if (!text && !(waitingQrPhoto && photoUrl)) return;

    console.log(
      `[DEBUG] chatId=${chatId} fromId=${fromId} isGroup=${isGroup} rawText=${JSON.stringify(rawText)} → text=${JSON.stringify(text)}` +
      (message.entities || message.mentions ? ` entities=${JSON.stringify(message.entities || message.mentions)}` : "") +
      (message.reply_to_message ? ` reply_to=${JSON.stringify(message.reply_to_message.from)}` : "") +
      (photoUrl ? ` photoUrl=${photoUrl}` : "")
    );
    // Nếu tin nhắn có vẻ như 1 Reply/Quote (dùng lệnh add/tru) nhưng
    // extractRepliedUserId() chưa bắt được ID, log NGUYÊN VĂN message để
    // biết chính xác Zalo đặt tên field gì cho tin được Reply — copy dòng
    // "[DEBUG] full message=" này gửi lại để chỉnh extractRepliedUserId().
    if (/^(add|tru)\s+\d+/i.test(text.trim()) && !extractRepliedUserId(message)) {
      console.log(`[DEBUG] full message=${JSON.stringify(message)}`);
    }
    // Tương tự: nếu đang ở BƯỚC 2 (chờ ảnh QR) mà bot không tìm thấy ảnh
    // đính kèm nào trong tin nhắn này, in nguyên văn message để biết chính
    // xác field ảnh Zalo dùng là gì.
    if (waitingQrPhoto && !photoUrl) {
      console.log(`[DEBUG] full message (setqr, đang chờ ảnh nhưng không thấy)=${JSON.stringify(message)}`);
    }

    // Ghi lại tên↔ID vào sổ danh bạ của nhóm (xem giải thích ở định nghĩa
    // rememberSender) — cần thiết để lệnh "add N @Tên" tra được ID.
    if (isGroup) rememberSender(chatId, fromId, message.from?.display_name);

    await handleMessage({ chatId, dataKey, pendingKey, fromId, text, isGroup, message });
  } catch (e) {
    console.error("Webhook handler error:", e.message);
    // Trước đây lỗi ở bước gửi ảnh (sendImage không được await) sẽ rơi vào
    // đây và chỉ log ra console, người dùng không biết bot bị lỗi gì.
    // Giờ cố gắng báo lại cho họ luôn (nếu vẫn xác định được chatId).
    try {
      const body = req.body || {};
      const update = body.result || body;
      const chatId = update.message?.chat?.id || update.chat_id || update.message?.from?.id;
      if (chatId) await sendText(chatId, `❌ Lỗi hệ thống: ${e.message}`);
    } catch (e2) {
      console.error("Không gửi được thông báo lỗi cho user:", e2.message);
    }
  }
});

// Zalo verify webhook bằng GET đôi khi — trả 200 cho an toàn
app.get("/webhook", (req, res) => res.sendStatus(200));

app.get("/", (req, res) => res.send("FF Zalo OA bot đang chạy."));

// ============================================================
// XỬ LÝ TIN NHẮN — port từ messageCreate của bản Discord
// ============================================================
async function handleMessage({ chatId, dataKey, pendingKey, fromId, text, isGroup, message }) {
  // ══════════════════════════════════════════════════════════
  // CHỐNG PHÁ BOX — kiểm tra TRƯỚC MỌI LỆNH KHÁC. Nếu vi phạm (spam/tag
  // toàn nhóm/gửi link ngoài), bot xoá tin + thu hết ngày dùng bot của
  // người đó + cảnh báo, rồi return luôn, không xử lý tiếp như 1 lệnh
  // bình thường (Zalo không cho Bot làm quản trị viên nhóm nên KHÔNG tự
  // kick được — xem ghi chú đầy đủ ở enforceAntiraid()).
  //
  // ⚠️ GIỚI HẠN NỀN TẢNG QUAN TRỌNG: như ghi chú ngay bên dưới, Zalo Bot
  // Platform CHỈ chuyển tin nhắn nhóm tới bot khi người gửi @ TAG bot
  // hoặc Reply tin của bot — bot KHÔNG hề nhận được webhook cho tin nhắn
  // "nhắn trơn" không tag. Vì vậy tính năng chống phá box này CHỈ bắt
  // được vi phạm trong những tin có tag bot; spam/link/tag-all trong các
  // tin không tag bot sẽ không tới được bot để kiểm tra — đây là hạn chế
  // của nền tảng Zalo, không phải lỗi code này.
  // ══════════════════════════════════════════════════════════
  if (await enforceAntiraid({ chatId, fromId, text, isGroup, message })) return;

  // Ở NHÓM, Zalo chỉ chuyển tin nhắn tới bot khi người dùng @ TAG bot hoặc
  // Trả lời (Reply/Quote) 1 tin bot từng gửi. Vì vậy mọi bước hội thoại
  // nhiều bước (.td → khung giờ → ngày → mẫu ảnh) cần nhắc người dùng làm
  // đúng 1 trong 2 cách đó ở MỖI bước khi đang ở trong nhóm.
  const groupHint = isGroup
    ? "\n\n➡️ Đang ở NHÓM: hãy @ TAG bot kèm câu trả lời (VD: @Tên Bot 3), hoặc Trả lời (Reply/Quote) đúng tin nhắn này của bot."
    : "";

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN/CTV: CẤP / THU NGÀY SỬ DỤNG BOT CHO 1 NGƯỜI
  // Cú pháp: @Tên Bot add 7 <ID Zalo>   (cấp thêm 7 ngày) — Admin VÀ CTV dùng được
  //          @Tên Bot tru 3 <ID Zalo>   (thu lại 3 ngày)  — CHỈ Admin dùng được
  // Người cần cấp ngày tự nhắn "whoami" với bot để lấy ID của họ, gửi cho
  // admin/ctv, admin/ctv dùng thẳng ID đó — không phụ thuộc Reply/mention/
  // tên vì Zalo Bot Platform hiện không gửi kèm dữ liệu đó trong webhook
  // (đã xác nhận qua log thực tế). Nếu không có sẵn ID, có thể gõ tên hiển
  // thị thay thế — bot sẽ tra trong "sổ danh bạ" tự học của nhóm (chỉ hoạt
  // động nếu người đó đã từng nhắn ít nhất 1 tin trong nhóm này).
  // ══════════════════════════════════════════════════════════
  {
    const m = /^(add|tru)\s+(\d+)\b(.*)$/i.exec(text.trim());
    if (m) {
      const action = m[1].toLowerCase();
      const isTru = action === "tru";
      // CTV chỉ được "add", không được "tru" — chặn CTV dùng "tru" trước
      // khi chặn người không có quyền gì cả, để báo đúng lý do.
      if (isTru && !isAdmin(fromId)) {
        return sendText(chatId, "🚫 Chỉ admin mới được thu ngày (tru). CTV chỉ được cấp ngày (add).");
      }
      if (!isAdmin(fromId) && !isCtv(fromId)) {
        return sendText(chatId, "🚫 Bạn không có quyền cấp/thu ngày sử dụng bot.");
      }
      const days = parseInt(m[2]);
      const rest = (m[3] || "").trim();

      // Lớp 1 (ƯU TIÊN CAO NHẤT): rest là 1 chuỗi duy nhất trông giống ID
      // Zalo thật (VD "1ec6c750d902305c6913" — hex, không dấu cách, đủ
      // dài) → dùng thẳng, không cần tra cứu gì thêm.
      let targetId = /^[a-f0-9]{10,}$/i.test(rest) ? rest : null;

      // Lớp 2 & 3: thử Reply / entities (hiện Zalo chưa gửi, xem ghi chú ở
      // định nghĩa hàm — giữ lại phòng khi nền tảng bổ sung sau này).
      if (!targetId) targetId = extractRepliedUserId(message);
      if (!targetId) {
        const mentioned = extractMentionedUserIds(message).filter(id => id !== String(fromId));
        targetId = mentioned[mentioned.length - 1] || null;
      }

      // Lớp 4: tra "sổ danh bạ" tự học theo tên còn lại sau "add N " /
      // "tru N " (VD "add 30 @Nam My" → tên cần tra là "Nam My"). Chỉ áp
      // dụng trong nhóm, vì sổ danh bạ được lưu theo từng nhóm.
      const targetNameGuess = rest.replace(/^@/, "").trim() || undefined;
      if (!targetId && isGroup && targetNameGuess) {
        targetId = lookupUserIdByName(chatId, targetNameGuess);
      }

      if (!targetId) {
        return sendText(
          chatId,
          "❌ Không xác định được người cần cấp/thu ngày.\n" +
          `✅ Cách chắc chắn nhất: nhờ họ nhắn "whoami" với bot để lấy ID, rồi gõ "${action} ${days} <ID>".\n` +
          `Hoặc gõ đúng tên hiển thị Zalo: "${action} ${days} Tên Người Đó" (chỉ hoạt động nếu họ đã từng nhắn ít nhất 1 tin trong nhóm này).`
        );
      }

      const delta = action === "add" ? days : -days;
      const left = addDays(targetId, delta, targetNameGuess);

      return sendText(
        chatId,
        `✅ Đã ${action === "add" ? "cấp thêm" : "thu lại"} ${days} ngày cho user ${targetId}.\n` +
        `📆 Số ngày còn lại của họ: ${left} ngày.`
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN/CTV: CẤP / THU LƯỢT SỬ DỤNG LỆNH .td CHO 1 NGƯỜI
  // Cú pháp: @Tên Bot naplt 5 <ID Zalo>   (cấp thêm 5 lượt) — Admin VÀ CTV
  //          @Tên Bot trult 2 <ID Zalo>   (thu lại 2 lượt)  — CHỈ Admin
  // Y hệt cách xác định targetId của "add"/"tru" (ID Zalo trực tiếp, hoặc
  // tra "sổ danh bạ" theo tên hiển thị nếu đang ở trong nhóm).
  // ══════════════════════════════════════════════════════════
  {
    const m = /^(naplt|trult)\s+(\d+)\b(.*)$/i.exec(text.trim());
    if (m) {
      const action = m[1].toLowerCase();
      const isTru = action === "trult";
      // CTV chỉ được "naplt", không được "trult" — chặn CTV dùng "trult"
      // trước khi chặn người không có quyền gì cả, để báo đúng lý do.
      if (isTru && !isAdmin(fromId)) {
        return sendText(chatId, "🚫 Chỉ admin mới được thu lượt (trult). CTV chỉ được cấp lượt (naplt).");
      }
      if (!isAdmin(fromId) && !isCtv(fromId)) {
        return sendText(chatId, "🚫 Bạn không có quyền cấp/thu lượt sử dụng .td.");
      }
      const luot = parseInt(m[2]);
      const rest = (m[3] || "").trim();

      // Lớp 1 (ƯU TIÊN CAO NHẤT): rest là 1 chuỗi duy nhất trông giống ID
      // Zalo thật (hex, không dấu cách, đủ dài) → dùng thẳng.
      let targetId = /^[a-f0-9]{10,}$/i.test(rest) ? rest : null;

      // Lớp 2 & 3: thử Reply / entities (hiện Zalo chưa gửi, giữ lại phòng
      // khi nền tảng bổ sung sau này).
      if (!targetId) targetId = extractRepliedUserId(message);
      if (!targetId) {
        const mentioned = extractMentionedUserIds(message).filter(id => id !== String(fromId));
        targetId = mentioned[mentioned.length - 1] || null;
      }

      // Lớp 4: tra "sổ danh bạ" tự học theo tên còn lại sau "naplt N " /
      // "trult N " — chỉ áp dụng trong nhóm.
      const targetNameGuess = rest.replace(/^@/, "").trim() || undefined;
      if (!targetId && isGroup && targetNameGuess) {
        targetId = lookupUserIdByName(chatId, targetNameGuess);
      }

      if (!targetId) {
        return sendText(
          chatId,
          "❌ Không xác định được người cần cấp/thu lượt.\n" +
          `✅ Cách chắc chắn nhất: nhờ họ nhắn "whoami" với bot để lấy ID, rồi gõ "${action} ${luot} <ID>".\n` +
          `Hoặc gõ đúng tên hiển thị Zalo: "${action} ${luot} Tên Người Đó" (chỉ hoạt động nếu họ đã từng nhắn ít nhất 1 tin trong nhóm này).`
        );
      }

      const delta = action === "naplt" ? luot : -luot;
      const left = addLuot(targetId, delta, targetNameGuess);

      return sendText(
        chatId,
        `✅ Đã ${action === "naplt" ? "cấp thêm" : "thu lại"} ${luot} lượt .td cho user ${targetId}.\n` +
        `🎟️ Số lượt còn lại của họ: ${left} lượt.`
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH NGƯỜI DÙNG: "check" — Xem số LƯỢT + trạng thái VIP (đang dùng
  // .td được nhờ gì: ngày/box/admin) của CHÍNH MÌNH. Gõ kèm ID/tên phía
  // sau để xem của người khác — chỉ ADMIN/CTV mới được xem người khác,
  // người dùng thường chỉ xem được của bản thân.
  // Cú pháp: check            (xem của chính mình)
  //          check <ID/tên>   (admin/CTV xem của người khác)
  // ══════════════════════════════════════════════════════════
  {
    const m = /^check(?:\s+(.+))?$/i.exec(text.trim());
    if (m) {
      const rest = (m[1] || "").trim();
      let targetId = String(fromId);
      let isSelf = true;

      if (rest) {
        if (!isAdmin(fromId) && !isCtv(fromId)) {
          return sendText(chatId, "🚫 Bạn chỉ xem được lượt của chính mình. Gõ \"check\" (không kèm gì) để xem lượt của bạn.");
        }
        const found = resolveTargetUserId(chatId, fromId, message, rest, isGroup);
        if (!found) {
          return sendText(
            chatId,
            "❌ Không xác định được người cần kiểm tra.\n" +
            `✅ Cách chắc chắn nhất: nhờ họ nhắn "whoami" để lấy ID, rồi gõ "check <ID>".`
          );
        }
        targetId = found;
        isSelf = false;
      }

      const vip = isAdmin(targetId) || daysLeft(targetId) > 0 || (isGroup && boxDaysLeft(chatId) > 0);
      const label = isSelf ? "CỦA BẠN" : `— ${getDisplayNameById(chatId, targetId)}`;
      return sendText(
        chatId,
        `🧾 TRẠNG THÁI ${label}\n\n` +
        `🆔 ID: ${targetId}\n` +
        `🎟️ Lượt dùng .td: ${luotLeft(targetId)}\n` +
        `📆 Ngày sử dụng còn: ${daysLeft(targetId)} ngày\n` +
        `👑 VIP (đang dùng .td được): ${vip ? "Có" : "Không"}`
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH NGƯỜI DÙNG: "chuyenluot" — TỰ chuyển bớt LƯỢT của mình cho người
  // khác, KHÔNG cần quyền admin/CTV (giống chuyển tiền cho nhau). Không
  // cho chuyển âm, không cho chuyển nhiều hơn số đang có, không cho tự
  // chuyển cho chính mình.
  // Cú pháp: chuyenluot <ID/tên> <số lượt>
  // ══════════════════════════════════════════════════════════
  {
    const m = /^chuyenluot\s+(.+?)\s+(\d+)$/i.exec(text.trim());
    if (m) {
      const rest = m[1].trim();
      const amount = parseInt(m[2], 10);
      if (!amount || amount <= 0) {
        return sendText(chatId, "❌ Số lượt phải lớn hơn 0. VD: chuyenluot 1ec6c750d902305c6913 3");
      }

      const targetId = resolveTargetUserId(chatId, fromId, message, rest, isGroup);
      if (!targetId) {
        return sendText(
          chatId,
          "❌ Không xác định được người nhận lượt.\n" +
          `✅ Cách chắc chắn nhất: nhờ họ nhắn "whoami" để lấy ID, rồi gõ "chuyenluot <ID> ${amount}".`
        );
      }
      if (targetId === String(fromId)) {
        return sendText(chatId, "❌ Không thể tự chuyển lượt cho chính mình.");
      }

      const balance = luotLeft(fromId);
      if (balance < amount) {
        return sendText(chatId, `❌ Bạn chỉ còn ${balance} lượt, không đủ để chuyển ${amount} lượt.`);
      }

      const senderLeft = addLuot(fromId, -amount);
      const receiverLeft = addLuot(targetId, amount);
      return sendText(
        chatId,
        `✅ Đã chuyển ${amount} lượt cho ${getDisplayNameById(chatId, targetId)} (${targetId}).\n` +
        `🎟️ Lượt còn lại của bạn: ${senderLeft}.\n` +
        `🎟️ Lượt hiện có của họ: ${receiverLeft}.`
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN/CTV: "thanhtoan" — XÁC NHẬN đã nhận tiền chuyển khoản của 1
  // người, bot TỰ QUY ĐỔI số tiền đó ra lượt theo tỷ giá RATE_VND_PER_LUOT
  // (mặc định 250đ = 1 lượt) rồi cộng thẳng vào tài khoản lượt của họ.
  // Đây KHÔNG phải cổng thanh toán tự động — admin/CTV tự kiểm tra đã có
  // tiền về (qua QR/"mã" đã cấu hình ở lệnh setqr) rồi mới gõ lệnh này.
  // Cú pháp: thanhtoan <ID/tên> <số tiền (đồng)>
  // ══════════════════════════════════════════════════════════
  {
    const m = /^thanhtoan\s+(.+?)\s+(\d+)$/i.exec(text.trim());
    if (m) {
      if (!isAdmin(fromId) && !isCtv(fromId)) {
        return sendText(chatId, "🚫 Bạn không có quyền dùng lệnh xác nhận thanh toán (thanhtoan).");
      }
      const rest = m[1].trim();
      const money = parseInt(m[2], 10);
      if (!money || money <= 0) {
        return sendText(chatId, "❌ Số tiền phải lớn hơn 0. VD: thanhtoan 1ec6c750d902305c6913 5000");
      }

      const targetId = resolveTargetUserId(chatId, fromId, message, rest, isGroup);
      if (!targetId) {
        return sendText(
          chatId,
          "❌ Không xác định được người cần nạp.\n" +
          `✅ Cách chắc chắn nhất: nhờ họ nhắn "whoami" để lấy ID, rồi gõ "thanhtoan <ID> ${money}".`
        );
      }

      const luotCong = Math.floor(money / RATE_VND_PER_LUOT);
      if (luotCong <= 0) {
        return sendText(chatId, `❌ Số tiền ${money}đ chưa đủ 1 lượt (tỷ giá ${RATE_VND_PER_LUOT}đ = 1 lượt).`);
      }

      const left = addLuot(targetId, luotCong);
      return sendText(
        chatId,
        `💰 Đã xác nhận thanh toán ${money}đ cho ${getDisplayNameById(chatId, targetId)} (${targetId}).\n` +
        `🧮 Tỷ giá: ${RATE_VND_PER_LUOT}đ = 1 lượt → cộng ${luotCong} lượt.\n` +
        `🎟️ Lượt hiện có: ${left}.`
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN: QUẢN LÝ DANH SÁCH CTV (chỉ admin dùng được)
  // Cú pháp: @Tên Bot capctv <ID Zalo>   (thêm 1 người làm CTV)
  //          @Tên Bot thuctv <ID Zalo>   (gỡ 1 người khỏi CTV)
  //          @Tên Bot dsctv              (xem danh sách CTV hiện tại)
  // CTV chỉ được dùng lệnh "add" (cấp ngày), KHÔNG được "tru" (thu ngày),
  // và KHÔNG được tự thêm/gỡ CTV khác — chỉ admin mới quản lý được.
  // ══════════════════════════════════════════════════════════
  {
    const m = /^(capctv|thuctv)\s+(\S+)/i.exec(text.trim());
    if (m) {
      if (!isAdmin(fromId)) {
        return sendText(chatId, "🚫 Chỉ admin mới được quản lý danh sách CTV.");
      }
      const action = m[1].toLowerCase();
      const rawTarget = m[2];
      const targetId = /^[a-f0-9]{10,}$/i.test(rawTarget)
        ? rawTarget
        : lookupUserIdByName(chatId, rawTarget);

      if (!targetId) {
        return sendText(
          chatId,
          `❌ Không xác định được người cần ${action === "capctv" ? "thêm" : "gỡ"}.\n` +
          `Dùng ID Zalo (nhờ họ nhắn "whoami" để lấy), VD: "${action} 1ec6c750d902305c6913".`
        );
      }

      if (action === "capctv") {
        addCtv(targetId);
        return sendText(chatId, `✅ Đã thêm ${targetId} làm CTV (được dùng lệnh add, không được tru).`);
      } else {
        removeCtv(targetId);
        return sendText(chatId, `✅ Đã gỡ ${targetId} khỏi danh sách CTV.`);
      }
    }
  }
  if (/^dsctv$/i.test(text.trim())) {
    if (!isAdmin(fromId)) return sendText(chatId, "🚫 Chỉ admin mới xem được danh sách CTV.");
    return sendText(
      chatId,
      ctvIds.length ? `👥 Danh sách CTV (${ctvIds.length}):\n${ctvIds.join("\n")}` : "👥 Chưa có CTV nào."
    );
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN: VOHANBOX — cấp "vô hạn" cho CẢ NHÓM đang chat trong N
  // ngày (mặc định 30 nếu không ghi số). Trong thời gian đó, MỌI thành
  // viên trong nhóm này nhắn .td đều dùng được bot, không cần cấp riêng
  // từng người. Chỉ dùng được TRONG NHÓM (không dùng ở chat riêng với bot,
  // vì "box" nghĩa là nhóm).
  // Cú pháp: @Tên Bot vohanbox        → mặc định 30 ngày
  //          @Tên Bot vohanbox 60     → 60 ngày
  // ══════════════════════════════════════════════════════════
  {
    const m = /^vohanbox(?:\s+(\d+))?$/i.exec(text.trim());
    if (m) {
      if (!isAdmin(fromId)) {
        return sendText(chatId, "🚫 Chỉ admin mới được cấp vô hạn cho box.");
      }
      if (!isGroup) {
        return sendText(chatId, "❌ Lệnh này chỉ dùng được TRONG NHÓM (box), không dùng ở chat riêng.");
      }
      const days = m[1] ? parseInt(m[1]) : 30;
      const left = setBoxUnlimited(chatId, days);
      return sendText(
        chatId,
        `✅ Đã cấp VÔ HẠN cho box này thêm ${days} ngày.\n` +
        `📆 Box còn ${left} ngày vô hạn — trong thời gian này TẤT CẢ thành viên trong nhóm đều dùng bot được, không cần cấp ngày riêng.`
      );
    }
  }
  if (/^conlaibox$/i.test(text.trim())) {
    if (!isGroup) return sendText(chatId, "❌ Lệnh này chỉ dùng được trong nhóm.");
    const left = boxDaysLeft(chatId);
    return sendText(
      chatId,
      left > 0
        ? `📆 Box này đang được VÔ HẠN, còn ${left} ngày.`
        : "📆 Box này hiện KHÔNG có vô hạn — từng người cần được cấp ngày riêng."
    );
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN: SETQR — cấu hình QR chuyển khoản cho 1 box (nhóm/chat)
  // BƯỚC 1: gõ "setqr Tên Chủ Khoản / Ngân Hàng / Số TK" (CHƯA cần ảnh) —
  //         áp dụng cho CHÍNH chat đang gõ lệnh.
  //   HOẶC: gõ "setqr <ID nhóm> / Tên Chủ Khoản / Ngân Hàng / Số TK" từ
  //         CHAT RIÊNG (1-1) với bot — áp dụng cho nhóm có ID chỉ định.
  //         Dùng lệnh "idnhom" trong nhóm để lấy ID đó. Cách này giúp né
  //         hẳn giới hạn của Zalo: khi ở TRONG NHÓM, ảnh gửi kèm tag/reply
  //         vẫn thường KHÔNG được Zalo chuyển tới bot — nên bước 2 (gửi
  //         ảnh QR) nên luôn thực hiện ở chat riêng, không cần tag gì cả.
  // VD: setqr NGUYỄN HỮU THÀNH NHÂN / ZALOPAY / 0948301012
  //     setqr 4109384756201 / NGUYỄN HỮU THÀNH NHÂN / ZALOPAY / 0948301012
  // Bot xác nhận lại thông tin rồi chuyển sang BƯỚC 2 (chờ ảnh QR) — xem
  // khối xử lý pending.step === "setqr_photo" bên dưới.
  // ══════════════════════════════════════════════════════════
  {
    const m = /^setqr\s+(?:(\d{5,})\s*\/\s*)?(.+?)\s*\/\s*(.+?)\s*\/\s*(.+)$/i.exec(text.trim());
    if (m) {
      if (!isAdmin(fromId)) {
        return sendText(chatId, "🚫 Chỉ admin mới được cấu hình QR chuyển khoản.");
      }
      const targetChatId = m[1] || String(chatId);
      // Chỉ định ID nhóm khác trong khi vẫn đang gõ TRONG NHÓM là vô nghĩa
      // (vì bước 2 vẫn phải gửi ảnh trong nhóm đó, vẫn dính giới hạn cũ) —
      // chặn sớm và hướng dẫn đúng cách.
      if (m[1] && isGroup) {
        return sendText(
          chatId,
          `⚠️ Chỉ định ID nhóm khác chỉ có tác dụng khi gõ lệnh này ở CHAT RIÊNG (1-1) với bot — vì bước gửi ảnh QR tiếp theo cần thực hiện ở chat riêng để tránh giới hạn ảnh trong nhóm của Zalo.\n` +
          `Nhắn riêng cho bot rồi gõ lại: setqr ${m[1]} / ${m[2]} / ${m[3]} / ${m[4]}`
        );
      }
      const [, , name, bank, account] = m;
      pendingStep[pendingKey] = {
        step: "setqr_photo",
        targetChatId,
        name: name.trim(), bank: bank.trim(), account: account.trim(),
      };
      armSetqrTimeout(pendingKey, chatId);
      const targetNote = m[1] ? `\n🎯 Áp dụng cho box ID: ${targetChatId}` : "";
      return sendText(
        chatId,
        `✅ Đã nhận thông tin chuyển khoản:${targetNote}\n` +
        `👤 ${name.trim().toUpperCase()}\n` +
        `🏦 ${bank.trim().toUpperCase()}\n` +
        `🏧 ${account.trim()}\n\n` +
        `📸 Gửi tiếp 1 ẢNH QR trong vòng 1 PHÚT để hoàn tất cấu hình.` +
        (isGroup
          ? `\n\n⚠️ ĐANG Ở NHÓM: ảnh PHẢI kèm @ TAG bot trong caption, hoặc Trả lời (Reply/Quote) đúng tin nhắn này rồi đính kèm ảnh — nếu Zalo không hỗ trợ, hãy huỷ và làm lại từ CHAT RIÊNG với bot (xem .help).`
          : "")
      );
    }
  }

  // Bất kỳ ai gõ "mã" hoặc "qr" → bot trả lời 3 dòng thông tin + gửi kèm
  // ảnh QR thật đã lưu (nếu admin đã setqr trước đó cho box/chat này).
  if (/^(mã|ma|qr)$/i.test(text.trim())) {
    const cfg = getQrConfig(chatId);
    if (!cfg) {
      return sendText(
        chatId,
        "❌ Box này chưa có QR chuyển khoản nào được cấu hình.\n" +
        "Admin gửi 1 ảnh kèm caption: setqr Tên Chủ Khoản / Ngân Hàng / Số TK"
      );
    }
    await sendText(
      chatId,
      `👤 ${cfg.name.toUpperCase()}\n` +
      `🏦 ${cfg.bank.toUpperCase()}\n` +
      `🏧 ${cfg.account}`
    );
    return await sendPhotoByUrl(chatId, cfg.photoUrl);
  }

  // Tự kiểm tra số ngày + số lượt .td còn lại của chính mình.
  if (/^(conlai|ngayconlai)$/i.test(text.trim())) {
    if (isAdmin(fromId)) return sendText(chatId, "👑 Bạn là admin — không giới hạn ngày lẫn lượt sử dụng.");
    return sendText(
      chatId,
      `📆 Bạn còn ${daysLeft(fromId)} ngày sử dụng bot.\n` +
      `🎟️ Bạn còn ${luotLeft(fromId)} lượt dùng .td.`
    );
  }

  // Lấy ID Zalo của chính mình — dùng để điền vào ADMIN_IDS.
  if (/^whoami$/i.test(text.trim())) {
    return sendText(chatId, `🆔 ID Zalo của bạn: ${fromId}`);
  }

  // Lấy ID của box/nhóm hiện tại — dùng để "setqr" từ xa (chat riêng) áp
  // dụng đúng cho nhóm này, tránh phải gửi ảnh QR trong nhóm (bị giới hạn
  // tag/reply của Zalo không hỗ trợ đính kèm ảnh).
  if (/^(idnhom|groupid|idbox)$/i.test(text.trim())) {
    return sendText(
      chatId,
      `🆔 ID của box này: ${chatId}\n` +
      (isGroup
        ? `Dùng ID này để "setqr" từ chat RIÊNG (1-1) với bot, xem chi tiết trong .help.`
        : "")
    );
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH ADMIN/CTV: "id" — Trả lời (Reply/Quote) vào tin nhắn của ai đó
  // rồi gõ "id" (kèm @ TAG bot nếu đang ở nhóm) để lấy ID Zalo của người
  // đó. Dùng để có ID nhanh, thay vì phải nhờ họ tự nhắn "whoami".
  // LƯU Ý: phụ thuộc Zalo Bot Platform có gửi kèm dữ liệu tin được Reply
  // trong webhook hay không — hiện CHƯA CÓ xác nhận chắc chắn (xem ghi
  // chú ở extractRepliedUserInfo). Nếu không ra ID, log Railway sẽ in
  // NGUYÊN VĂN message để chỉnh lại field cho đúng.
  // ══════════════════════════════════════════════════════════
  if (/^id$/i.test(text.trim())) {
    if (!isAdmin(fromId) && !isCtv(fromId)) {
      return sendText(chatId, "🚫 Chỉ admin/CTV mới được dùng lệnh này.");
    }
    const replied = extractRepliedUserInfo(message);
    if (!replied) {
      console.log(`[DEBUG] full message (lệnh "id", không tìm thấy replied user)=${JSON.stringify(message)}`);
      return sendText(
        chatId,
        `❌ Không xác định được người bạn đang Trả lời.\n` +
        `Hãy chắc chắn bạn dùng đúng thao tác Trả lời (Reply/Quote) tin nhắn của họ rồi gõ "id".${groupHint}\n` +
        `(Nếu vẫn không ra dù đã Reply đúng, có thể Zalo chưa hỗ trợ gửi kèm dữ liệu này — báo lại để kiểm tra log.)`
      );
    }
    return sendText(
      chatId,
      `🆔 ID Zalo của người bạn Reply: ${replied.id}` +
      (replied.display_name ? `\n👤 Tên hiển thị: ${replied.display_name}` : "")
    );
  }

  const pending = pendingStep[pendingKey];

  // BƯỚC 2 của SETQR: admin đang được yêu cầu gửi ẢNH QR (sau khi đã gõ
  // "setqr Tên / Ngân Hàng / Số TK" ở bước 1). Ảnh có thể gửi KHÔNG kèm
  // caption gì — chỉ cần đúng người, đúng luồng đang chờ (pendingKey).
  if (pending?.step === "setqr_photo") {
    const photoUrl = extractPhotoUrl(message);
    if (!photoUrl) {
      return sendText(
        chatId,
        `❌ Chưa thấy ảnh. Gửi 1 ẢNH QR để hoàn tất cấu hình.` +
        (isGroup
          ? `\n⚠️ Nhớ kèm @ TAG bot trong caption của ảnh, hoặc Trả lời (Reply/Quote) đúng tin nhắn của bot khi gửi ảnh — vì đang ở NHÓM. Nếu vẫn không được, làm lại từ CHAT RIÊNG với bot (xem .help).`
          : "")
      );
    }
    const { name, bank, account, targetChatId } = pending;
    delete pendingStep[pendingKey];
    disarmSetqrTimeout(pendingKey);
    setQrConfig(targetChatId, name, bank, account, photoUrl);
    const boxNote = String(targetChatId) !== String(chatId) ? ` (box ID: ${targetChatId})` : "";
    await sendText(
      chatId,
      `✅ Đã lưu QR chuyển khoản cho box${boxNote}:\n` +
      `👤 ${name.toUpperCase()}\n` +
      `🏦 ${bank.toUpperCase()}\n` +
      `🏧 ${account}\n\n` +
      `Từ giờ ai gõ "mã" hoặc "qr" trong box đó sẽ nhận được thông tin + ảnh này.`
    );
    return await sendPhotoByUrl(chatId, photoUrl);
  }

  // BƯỚC 2 của ".menu": người dùng đã thấy danh sách số thứ tự các phần
  // (Tính điểm / Tiện ích / Admin / CTV) và giờ Trả lời (Reply/Quote) lại
  // 1 con số để xem chi tiết đúng phần đó.
  if (pending?.step === "menu_select") {
    const idx = parseInt(text.trim(), 10);
    const sections = pending.sections;
    if (!Number.isInteger(idx) || idx < 1 || idx > sections.length) {
      return sendText(chatId, `❌ Nhập số từ 1-${sections.length}!${groupHint}`);
    }
    delete pendingStep[pendingKey];
    return sendText(chatId, sections[idx - 1]);
  }

  // BƯỚC 2: chọn khung giờ
  if (pending?.step === "khung") {
    if (!/^[1-8]$/.test(text)) return sendText(chatId, `❌ Nhập số từ 1-8!${groupHint}`);
    pendingStep[pendingKey] = { ...pending, step: "date", soKhung: parseInt(text) };
    return sendText(chatId, `📅 Nhập ngày thi đấu (DD/MM/YYYY)\nVí dụ: ${todayVN()}${groupHint}`);
  }

  // BƯỚC 3: nhập ngày
  if (pending?.step === "date") {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
      return sendText(chatId, `❌ Sai định dạng! Nhập lại: DD/MM/YYYY${groupHint}`);
    }
    pendingStep[pendingKey] = { ...pending, step: "template", ngay: text };
    return sendText(
      chatId,
      "🖼️ CHỌN MẪU ẢNH BẢNG XẾP HẠNG\n" +
      "Nhập số từ 1-21" + groupHint
    );
  }

  // BƯỚC 4: chọn mẫu ảnh → chạy toàn bộ luồng lấy điểm
  if (pending?.step === "template") {
    if (!/^([1-9]|1[0-9]|2[0-1])$/.test(text)) return sendText(chatId, `❌ Chỉ nhập số từ 1 đến 21!${groupHint}`);

    const selectedTemplate = parseInt(text);
    const { accountId, soKhung, mode, ngay, excludeMatchIndex, cprThreshold } = pending;
    delete pendingStep[pendingKey];
    const kg = KHUNG_GIO[soKhung];

    async function drawSelectedTemplate(sortedTeams, subtitleText) {
      if (selectedTemplate === 21) return drawZoroTemplateImage(sortedTeams);
      if (selectedTemplate === 20) return drawSrimTemplateImage(sortedTeams);
      if (selectedTemplate === 19) return drawOnepieceTemplateImage(sortedTeams);
      if (selectedTemplate === 18) return drawTetBxhTongTemplateImage(sortedTeams);
      if (selectedTemplate === 17) return drawKaitoLightTemplateImage(sortedTeams);
      if (selectedTemplate === 16) return drawKaitoDarkTemplateImage(sortedTeams);
      if (selectedTemplate === 15) return drawBxhTongTemplateImage(sortedTeams);
      if (selectedTemplate === 14) return drawSimpleBxhTemplateImage(sortedTeams);
      if (selectedTemplate === 13) return drawOverallStandingTemplateImage(sortedTeams);
      if (selectedTemplate === 12) return drawBluelockScrimTemplateImage(sortedTeams);
      if (selectedTemplate === 11) return drawFreefireClassicTemplateImage(sortedTeams);
      if (selectedTemplate === 10) return drawKittyScrimTemplateImage(sortedTeams);
      if (selectedTemplate === 9) return drawMinecraftTemplateImage(sortedTeams);
      if (selectedTemplate === 8) return drawHxhTemplateImage(sortedTeams);
      if (selectedTemplate === 7) return drawFreefire2TemplateImage(sortedTeams);
      if (selectedTemplate === 6) return drawFreefireTemplateImage(sortedTeams);
      if (selectedTemplate === 5) return drawChainTemplateImage(sortedTeams);
      if (selectedTemplate === 4) return drawHkTemplateImage(sortedTeams);
      if (selectedTemplate === 3) return drawBluelockTemplateImage(sortedTeams);
      if (selectedTemplate === 2) return drawStandingsTemplateImage(sortedTeams, { subtitle: subtitleText });
      return null; // mẫu 1 dùng drawBxhImage, xử lý riêng bên dưới
    }

    let startTs = toTimestamp(ngay, kg.start);
    let endTs   = toTimestamp(ngay, kg.end);
    if (soKhung === 6) endTs += 86400;
    if (soKhung === 7) { startTs += 86400; endTs += 86400; }

    try {
      const matches = await findMatches(accountId, startTs, endTs);

      const idToBigInt = (v) => {
        try { return BigInt(String(v).replace(/\D/g, "") || "0"); } catch { return 0n; }
      };
      matches.sort((a, b) => {
        const ta = idToBigInt(a.id);
        const tb = idToBigInt(b.id);
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });

      let removedNote = "";
      if (excludeMatchIndex) {
        if (excludeMatchIndex >= 1 && excludeMatchIndex <= matches.length) {
          const removed = matches.splice(excludeMatchIndex - 1, 1)[0];
          removedNote = `🗑️ Đã xoá trận số ${excludeMatchIndex} (ID: ${removed?.id ?? "?"}) khỏi danh sách tính điểm.\n`;
        } else {
          removedNote = `⚠️ Không có trận số ${excludeMatchIndex} để xoá (chỉ tìm thấy ${matches.length} trận ban đầu) — vẫn tính toàn bộ.\n`;
        }
      }

      if (matches.length === 0) {
        return sendText(chatId, `${removedNote}❌ Không còn trận nào để tính trong khung ${kg.label} ngày ${ngay}!`);
      }

      const teamTotals = {};
      const matchDetails = [];
      let playerName = null, totalBy = 0, totalElims = 0, totalPts = 0;

      for (let i = 0; i < matches.length; i++) {
        try {
          const match = await getMatchDetail(matches[i].id);
          if (!match) continue;
          matchDetails.push(match);

          const found = findPlayer(match, accountId);
          if (found) {
            if (!playerName && found.name) playerName = found.name;
            totalBy    += found.booyah;
            totalElims += found.kill;
            totalPts   += found.score;
          }

          for (const team of (match.ranks || [])) {
            const cleanIds = team.playerAccountIds
              .map(pid => pid.replace(/\*+$/, ""))
              .sort()
              .join("|");
            const repName = team.accountNames[0] || cleanIds;
            if (!teamTotals[cleanIds]) teamTotals[cleanIds] = { rep: repName, by: 0, kill: 0, score: 0 };
            teamTotals[cleanIds].by    += team.booyah;
            teamTotals[cleanIds].kill  += team.kill;
            teamTotals[cleanIds].score += team.score;
          }
        } catch (e) {
          console.error("Match error:", e.response?.status || e.message);
        }
        await new Promise(r => setTimeout(r, 400));
      }

      playerName = playerName || `ID_${accountId}`;
      const merged = mergeTeams(teamTotals);
      const sorted = merged.sort((a, b) => b.score - a.score).slice(0, 12);

      // ── Chế độ CPR (vô địch) — chỉ vẽ ảnh, không lưu data ──
      if (mode === "bxhcpr") {
        const threshold = cprThreshold || 50;
        const { sortedTeams, hasChampion } = computeChampionBoard(matchDetails, threshold);
        const usedMatches = Math.min(matchDetails.length, 5);

        const championName = sortedTeams[0]?.rep || "?";
        const announceText = hasChampion
          ? `👑 Đã có đội vô địch: ${championName}`
          : `📊 Chưa có đội nào vô địch.`;

        await sendText(chatId, `${removedNote}${announceText}`);

        const buffer = selectedTemplate === 1
          ? drawBxhImage(sortedTeams, {
              title: hasChampion ? "👑 BẢNG XẾP HẠNG — CÓ VÔ ĐỊCH" : "🔥 BẢNG XẾP HẠNG",
              subtitle: `${kg.label} • ngày ${ngay} • ID: ${accountId} • ${usedMatches} trận xét`,
              playerName,
            })
          : await drawSelectedTemplate(sortedTeams, `${kg.label} • ngày ${ngay} • ${usedMatches} trận xét`);

        return await sendPhotoByUrl(chatId, publicImageUrl(buffer));
      }

      // ── Chế độ thường (.td) — lưu data + gửi bảng ──
      // Lưu theo dataKey (người thật gửi lệnh), KHÔNG lưu theo chatId, để
      // nhiều người cùng dùng .td trong 1 nhóm không ghi đè dữ liệu của nhau.
      playerData[dataKey] = {
        accountId, zaloUserId: dataKey, name: playerName,
        khungGio: kg.label, ngay,
        totalBy, totalElims, totalPts,
        matches: matches.length,
      };
      saveData(playerData);

      const buffer = selectedTemplate === 1
        ? drawBxhImage(sorted, { title: "🔥 BXH TỔNG", subtitle: `${kg.label} • ngày ${ngay}`, playerName })
        : await drawSelectedTemplate(sorted, `${kg.label} • ngày ${ngay}`);

      return await sendPhotoByUrl(chatId, publicImageUrl(buffer));

    } catch (err) {
      console.error("Error:", err.response?.status, err.message);
      return sendText(chatId, `❌ Lỗi API: ${err.response?.status || err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // LỆNH CÓ PREFIX
  // ══════════════════════════════════════════════════════════
  if (!text.startsWith(PREFIX)) return;
  const args = text.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args[0].toLowerCase();

  // .td [ID] [cpr|cprN] [xoaN]
  if (cmd === "td") {
    const tdAccess = checkTdAccess(dataKey, chatId);
    if (!tdAccess.allowed) {
      return sendText(
        chatId,
        `🚫 Bạn chưa được cấp quyền dùng .td (còn ${daysLeft(dataKey)} ngày, ${luotLeft(dataKey)} lượt).\n` +
        "Liên hệ admin/CTV để được cấp thêm ngày sử dụng hoặc nạp lượt."
      );
    }

    const accountId = args[1];
    if (!accountId || !/^\d+$/.test(accountId)) {
      return sendText(chatId, `❌ VD: .td 60967899  hoặc  .td 60967899 cpr  /  .td 60967899 cpr40 (thêm xoa3 để bỏ trận số 3)${groupHint}`);
    }

    let isCpr = false;
    let cprThreshold = 50;
    let excludeMatchIndex = null;
    for (const a of args.slice(2)) {
      const cprMatch = /^cpr(\d+)?$/i.exec(a);
      if (cprMatch) {
        isCpr = true;
        if (cprMatch[1]) cprThreshold = parseInt(cprMatch[1]);
        continue;
      }
      const xoaMatch = XOA_REGEX.exec(a);
      if (xoaMatch) excludeMatchIndex = parseInt(xoaMatch[1]);
    }

    const mode = isCpr ? "bxhcpr" : "td";
    pendingStep[pendingKey] = { step: "khung", accountId, mode, excludeMatchIndex, cprThreshold };

    // Input đã hợp lệ, lệnh .td chính thức được chấp nhận từ đây. Nếu
    // access của người này CHỈ đến từ lượt (không phải ngày/box/admin) thì
    // trừ ngay 1 lượt — xem giải thích đầy đủ ở checkTdAccess() phía trên.
    let luotNote = "";
    if (tdAccess.source === "luot") {
      const left = consumeOneLuot(dataKey);
      luotNote = `\n\n🎟️ Đã trừ 1 lượt dùng .td (còn ${left} lượt).`;
    }

    const khungList = Object.entries(KHUNG_GIO).map(([k, v]) => `${k} — ${v.label}`).join("\n");
    return sendText(
      chatId,
      `📋 CHỌN KHUNG GIỜ${isCpr ? " (BXH Vô Địch)" : ""}\n${khungList}\n\n` +
      `✏️ Trả lời số từ 1-8` +
      `${isCpr ? `\n(chế độ CPR, ngưỡng ${cprThreshold}đ)` : ""}` +
      `${excludeMatchIndex ? `\n(sẽ bỏ trận #${excludeMatchIndex})` : ""}` +
      luotNote +
      groupHint
    );
  }

  // ══════════════════════════════════════════════════════════
  // NHÓM LỆNH "CHỐNG PHÁ BOX" — chỉ ADMIN bật/tắt được (trừ .antistatus,
  // ai trong nhóm cũng xem được). Phải gõ TRONG NHÓM cần áp dụng (mỗi
  // nhóm có luật riêng, dùng đúng chatId của nhóm đó).
  // ══════════════════════════════════════════════════════════

  // .antispam on/off — chống spam (≥2 tin trong 3 giây)
  if (cmd === "antispam") {
    if (!isAdmin(fromId)) return sendText(chatId, "🚫 Chỉ admin mới được bật/tắt chống phá box.");
    if (!isGroup) return sendText(chatId, "⚠️ Lệnh này phải gõ TRONG NHÓM cần áp dụng.");
    const val = (args[1] || "").toLowerCase();
    if (val !== "on" && val !== "off") return sendText(chatId, `❌ Gõ "${PREFIX}antispam on" hoặc "${PREFIX}antispam off".`);
    setAntiraidRule(chatId, "antispam", val === "on");
    return sendText(chatId, `✅ Đã ${val === "on" ? "BẬT" : "TẮT"} chống spam (≥2 tin/3 giây) cho nhóm này.`);
  }

  // .antitag on/off — chống tag toàn bộ nhóm
  if (cmd === "antitag") {
    if (!isAdmin(fromId)) return sendText(chatId, "🚫 Chỉ admin mới được bật/tắt chống phá box.");
    if (!isGroup) return sendText(chatId, "⚠️ Lệnh này phải gõ TRONG NHÓM cần áp dụng.");
    const val = (args[1] || "").toLowerCase();
    if (val !== "on" && val !== "off") return sendText(chatId, `❌ Gõ "${PREFIX}antitag on" hoặc "${PREFIX}antitag off".`);
    setAntiraidRule(chatId, "antitag", val === "on");
    return sendText(chatId, `✅ Đã ${val === "on" ? "BẬT" : "TẮT"} chống tag toàn bộ nhóm cho nhóm này.`);
  }

  // .antilink on/off — chống gửi link ngoài
  if (cmd === "antilink") {
    if (!isAdmin(fromId)) return sendText(chatId, "🚫 Chỉ admin mới được bật/tắt chống phá box.");
    if (!isGroup) return sendText(chatId, "⚠️ Lệnh này phải gõ TRONG NHÓM cần áp dụng.");
    const val = (args[1] || "").toLowerCase();
    if (val !== "on" && val !== "off") return sendText(chatId, `❌ Gõ "${PREFIX}antilink on" hoặc "${PREFIX}antilink off".`);
    setAntiraidRule(chatId, "antilink", val === "on");
    return sendText(chatId, `✅ Đã ${val === "on" ? "BẬT" : "TẮT"} chống gửi link ngoài cho nhóm này.`);
  }

  // .antiraid on/off — bật/tắt CẢ 3 luật trên cùng lúc cho tiện
  if (cmd === "antiraid") {
    if (!isAdmin(fromId)) return sendText(chatId, "🚫 Chỉ admin mới được bật/tắt chống phá box.");
    if (!isGroup) return sendText(chatId, "⚠️ Lệnh này phải gõ TRONG NHÓM cần áp dụng.");
    const val = (args[1] || "").toLowerCase();
    if (val !== "on" && val !== "off") return sendText(chatId, `❌ Gõ "${PREFIX}antiraid on" hoặc "${PREFIX}antiraid off".`);
    const on = val === "on";
    setAntiraidRule(chatId, "antispam", on);
    setAntiraidRule(chatId, "antitag", on);
    setAntiraidRule(chatId, "antilink", on);
    return sendText(chatId, `✅ Đã ${on ? "BẬT" : "TẮT"} TOÀN BỘ chống phá box (spam + tag toàn nhóm + link ngoài) cho nhóm này.`);
  }

  // .whitelist add/remove/list <ID Zalo> — miễn trừ 1 người khỏi MỌI luật
  // chống phá box, áp dụng CHUNG cho tất cả các nhóm.
  if (cmd === "whitelist") {
    if (!isAdmin(fromId)) return sendText(chatId, "🚫 Chỉ admin mới được quản lý whitelist chống phá box.");
    const action = (args[1] || "").toLowerCase();
    if (action === "list") {
      return sendText(
        chatId,
        antiraidWhitelist.length
          ? `📋 Whitelist chống phá box (${antiraidWhitelist.length}):\n${antiraidWhitelist.join("\n")}`
          : "📋 Whitelist chống phá box đang trống."
      );
    }
    const targetId = args[2];
    if ((action !== "add" && action !== "remove") || !targetId) {
      return sendText(chatId, `❌ Gõ "${PREFIX}whitelist add <ID Zalo>", "${PREFIX}whitelist remove <ID Zalo>" hoặc "${PREFIX}whitelist list".`);
    }
    if (action === "add") {
      addAntiraidWhitelist(targetId);
      return sendText(chatId, `✅ Đã thêm ${targetId} vào whitelist — người này sẽ KHÔNG bị chống phá box áp dụng ở bất kỳ nhóm nào.`);
    }
    removeAntiraidWhitelist(targetId);
    return sendText(chatId, `✅ Đã gỡ ${targetId} khỏi whitelist.`);
  }

  // .antistatus — xem đang bật/tắt luật nào cho nhóm hiện tại. Ai trong
  // nhóm cũng xem được (thông tin không nhạy cảm), không cần là admin.
  if (cmd === "antistatus") {
    if (!isGroup) return sendText(chatId, "⚠️ Lệnh này phải gõ TRONG NHÓM cần xem.");
    const rules = getAntiraidRules(chatId);
    const mark = (b) => (b ? "🟢 BẬT" : "🔴 TẮT");
    const onCount = [rules.antispam, rules.antitag, rules.antilink].filter(Boolean).length;
    return sendText(
      chatId,
      `🛡️ TÌNH TRẠNG CHỐNG PHÁ BOX (${onCount}/3 đang bật)\n\n` +
      `Chống spam: ${mark(rules.antispam)}\n` +
      `Chống tag toàn nhóm: ${mark(rules.antitag)}\n` +
      `Chống link ngoài: ${mark(rules.antilink)}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // NHÓM LỆNH "HỆ THỐNG" — kiểm tra/thông tin về chính con bot (không
  // liên quan tính điểm/admin). Ai cũng gõ được, không cần quyền gì.
  // ══════════════════════════════════════════════════════════

  // .ping — kiểm tra nhanh xem bot có đang hoạt động/phản hồi không.
  if (cmd === "ping") {
    return sendText(chatId, "🏓 Pong! Bot đang hoạt động bình thường.");
  }

  // .uptime — bot đã chạy liên tục bao lâu kể từ lần khởi động/deploy
  // gần nhất (KHÔNG phải tổng tuổi thọ của bot, vì mỗi lần deploy lại/
  // restart sẽ reset về 0).
  if (cmd === "uptime") {
    return sendText(chatId, `⏱️ Bot đã chạy liên tục: ${formatUptime(Date.now() - SERVER_STARTED_AT)}.`);
  }

  // .version — phiên bản bot hiện tại.
  if (cmd === "version") {
    return sendText(chatId, `🤖 Bot FF — phiên bản ${BOT_VERSION}`);
  }

  // .anh — random 1 ảnh trong thư mục /images (xem comment ở đầu file).
  if (cmd === "anh") {
    try {
      const url = pickRandomImageUrl();
      if (!url) {
        return sendText(chatId, "⚠️ Thư mục \"images\" đang trống, chưa có ảnh nào để random. Thêm ảnh vào đó rồi thử lại.");
      }
      return await sendPhotoByUrl(chatId, url);
    } catch (e) {
      console.error("Lỗi lệnh .anh:", e.message);
      return sendText(chatId, `❌ Lỗi khi random ảnh: ${e.message}`);
    }
  }

  // .prefix — nhắc lại ký tự PREFIX đang dùng (hữu ích nếu ai đó quên).
  if (cmd === "prefix") {
    return sendText(chatId, `🔤 Prefix hiện tại: "${PREFIX}"\nVD: ${PREFIX}help`);
  }

  // .luotdung — hướng dẫn đầy đủ hệ LƯỢT dùng .td (xem/chuyển/nạp), kèm
  // luôn trạng thái lượt hiện tại của người gõ lệnh cho tiện.
  if (cmd === "luotdung") {
    return sendText(
      chatId,
      "📋 HƯỚNG DẪN LỆNH LƯỢT DÙNG\n\n" +
      `💰 Trạng thái của bạn: ${luotLeft(fromId)} lượt\n\n` +
      "👤 LỆNH NGƯỜI DÙNG (gõ trơn, KHÔNG cần dấu \".\"):\n" +
      "check [ID/tên] — Xem lượt & VIP (bỏ trống = xem của bạn)\n" +
      "chuyenluot <ID/tên> <số> — Chuyển bớt lượt của bạn cho người khác\n\n" +
      "🔑 LỆNH ADMIN/CTV (gõ trơn, KHÔNG cần dấu \".\"):\n" +
      "thanhtoan <ID/tên> <số tiền> — Xác nhận đã nhận tiền, tự quy đổi ra lượt\n" +
      `  (tỷ giá hiện tại: ${RATE_VND_PER_LUOT}đ = 1 lượt)\n` +
      "naplt <ID/tên> <số lượt> — Cấp thẳng lượt, không qua quy đổi tiền\n" +
      "trult <ID/tên> <số lượt> — Thu lại lượt (chỉ admin)\n\n" +
      "🎯 Lượt dùng để gõ .td khi bạn không còn ngày sử dụng và box không đang vô hạn — mỗi lần .td tốn đúng 1 lượt."
    );
  }

  // .stats — thống kê tổng quan (không lộ ID/tên riêng của ai), để biết
  // sơ bộ quy mô bot đang phục vụ.
  if (cmd === "stats") {
    const now = Date.now();
    const activeUsers = Object.values(accessData).filter(e => e?.expiresAt > now).length;
    const activeBoxes = Object.values(boxAccessData).filter(e => e?.expiresAt > now).length;
    const usersWithLuot = Object.values(luotData).filter(e => e?.luot > 0).length;
    const totalLuot = Object.values(luotData).reduce((sum, e) => sum + (e?.luot > 0 ? e.luot : 0), 0);
    return sendText(
      chatId,
      "📊 THỐNG KÊ HỆ THỐNG\n\n" +
      `👤 Người đang còn ngày sử dụng: ${activeUsers}\n` +
      `👥 Nhóm đang được vô hạn: ${activeBoxes}\n` +
      `🎟️ Người đang còn lượt .td: ${usersWithLuot} (tổng ${totalLuot} lượt)\n` +
      `🤝 Số CTV: ${ctvIds.length}\n` +
      `⏱️ Uptime: ${formatUptime(now - SERVER_STARTED_AT)}`
    );
  }

  // .report <nội dung> — gửi báo lỗi/góp ý thẳng tới TẤT CẢ admin (qua
  // ADMIN_IDS), kèm ID người báo để admin phản hồi lại nếu cần.
  if (cmd === "report") {
    const content = args.slice(1).join(" ").trim();
    if (!content) {
      return sendText(chatId, `❌ Nhập nội dung cần báo. VD: ${PREFIX}report bot bị lỗi khi gõ .td`);
    }
    if (ADMIN_IDS.length === 0) {
      return sendText(chatId, "⚠️ Chưa có admin nào được cấu hình (ADMIN_IDS) để nhận báo lỗi.");
    }
    const reportMsg =
      `📩 BÁO LỖI/GÓP Ý MỚI\n` +
      `🆔 Từ: ${fromId}${isGroup ? ` (nhóm: ${chatId})` : ""}\n\n` +
      `${content}`;
    for (const adminId of ADMIN_IDS) {
      try { await sendText(adminId, reportMsg); }
      catch (e) { console.error(`Không gửi được report tới admin ${adminId}:`, e.message); }
    }
    return sendText(chatId, "✅ Đã gửi báo lỗi/góp ý tới admin, cảm ơn bạn!");
  }

  // .help
  // CHỈ hiện hướng dẫn TÍNH ĐIỂM (.td và các lệnh liên quan tới điểm số/
  // BXH) cho MỌI người dùng. Các lệnh ADMIN/CTV KHÔNG còn hiện ở đây nữa
  // — đã dời hết sang ".menu" (mục 👑 ADMIN), để .help gọn và tập trung
  // đúng vào phần tính điểm.
  if (cmd === "help") {
    return sendText(
      chatId,
      "📖 HƯỚNG DẪN TÍNH ĐIỂM — BOT FF\n\n" +
      "👤 .td [ID] — Đăng ký + tìm trận (lưu data)\n" +
      ".td [ID] cpr — BXH có luật Vô Địch (≥50đ & top1), không lưu data\n" +
      ".td [ID] cprN — như trên, ngưỡng N điểm thay vì 50\n\n" +
      "🗑️ Thêm xoaN sau ID để bỏ trận thứ N.\n" +
      "VD: .td 4252953187 cpr40 xoa3\n\n" +
      "⚙️ Luồng: .td [ID] → chọn khung giờ (1-8) → nhập ngày → chọn mẫu ảnh (1-21) → bot tự lấy điểm.\n\n" +
      "📆 conlai — Xem số ngày VÀ số lượt .td bạn còn được dùng.\n" +
      "📆 conlaibox — (trong nhóm) Xem nhóm có đang được vô hạn hay không.\n\n" +
      "🎟️ Ngoài ngày sử dụng, bạn cũng có thể dùng .td bằng LƯỢT (mỗi lần gõ .td tốn 1 lượt nếu bạn không còn ngày và box không vô hạn). Liên hệ admin/CTV để được nạp lượt.\n\n" +
      "👥 TRONG NHÓM: bot chỉ nhận được tin khi bạn @ TAG bot hoặc Trả lời (Reply/Quote) 1 tin bot đã gửi — nhắn trơn không TAG sẽ không tới được bot.\n\n" +
      "📋 Gõ .menu để xem đầy đủ TẤT CẢ các lệnh (tiện ích, QR chuyển khoản, admin...)."
    );
  }

  // .menu
  // Menu tổng — chia theo từng PHẦN (mỗi phần 1 nhóm chức năng). Bước 1:
  // chỉ liệt kê TÊN các phần theo số thứ tự từ trên xuống (Tính điểm →
  // Tiện ích → Admin/CTV). Bước 2: người dùng Trả lời (Reply/Quote) đúng
  // tin nhắn đó rồi gõ 1 số để xem chi tiết phần đó — xử lý ở bước
  // pending "menu_select" bên dưới, cùng kiểu với luồng chọn khung giờ
  // của .td. Phần "👑 ADMIN" chỉ liệt kê nếu là admin, "🤝 CTV" chỉ liệt
  // kê nếu là CTV — người dùng thường không thấy 2 phần này tồn tại.
  if (cmd === "menu") {
    const sections = [
      {
        title: "🎯 TÍNH ĐIỂM",
        body:
          "🎯 TÍNH ĐIỂM\n\n" +
          ".help — Xem chi tiết cách tính điểm / tìm trận (.td)\n" +
          ".td [ID] — Đăng ký + tìm trận",
      },
      {
        title: "🎟️ CHUYỂN LƯỢT",
        body:
          "🎟️ CHUYỂN LƯỢT (lượt dùng cho .td)\n\n" +
          ".luotdung — Xem hướng dẫn đầy đủ hệ LƯỢT\n" +
          "check [ID/tên] — Xem lượt & VIP của bạn (admin/CTV xem được của người khác)\n" +
          "chuyenluot <ID/tên> <số> — Chuyển bớt lượt của bạn cho người khác\n\n" +
          "🎯 Lượt dùng để gõ .td khi bạn không còn ngày sử dụng và box không đang vô hạn — mỗi lần .td tốn đúng 1 lượt.",
      },
      {
        title: "🧰 TIỆN ÍCH",
        body:
          "🧰 TIỆN ÍCH\n\n" +
          "conlai — Xem số ngày VÀ số lượt .td bạn còn được dùng\n" +
          "conlaibox — (trong nhóm) Xem nhóm có đang vô hạn không\n" +
          "whoami — Lấy ID Zalo của chính bạn\n" +
          "idnhom — (trong nhóm) Lấy ID của nhóm hiện tại\n" +
          "mã / qr — Xem thông tin + ảnh QR chuyển khoản (nếu box đã được setqr)\n" +
          ".antistatus — (trong nhóm) Xem chống phá box đang bật/tắt cái nào",
      },
      {
        title: "🖥️ HỆ THỐNG",
        body:
          "🖥️ HỆ THỐNG\n\n" +
          ".ping — Kiểm tra bot còn hoạt động không\n" +
          ".uptime — Xem bot đã chạy liên tục bao lâu\n" +
          ".version — Xem phiên bản bot hiện tại\n" +
          ".prefix — Xem ký tự PREFIX đang dùng\n" +
          ".stats — Xem thống kê tổng quan hệ thống\n" +
          ".report <nội dung> — Gửi báo lỗi/góp ý tới admin",
      },
    ];

    if (isAdmin(fromId)) {
      sections.push({
        title: "🛡️ CHỐNG PHÁ BOX",
        body:
          "🛡️ CHỐNG PHÁ BOX (gõ TRONG NHÓM cần áp dụng)\n\n" +
          ".antispam on/off — Chống spam (≥2 tin trong 3 giây)\n" +
          ".antitag on/off — Chống tag toàn bộ nhóm\n" +
          ".antilink on/off — Chống gửi link ngoài\n" +
          ".antiraid on/off — Bật/tắt CẢ 3 luật trên cùng lúc\n" +
          ".whitelist add <ID Zalo> — Miễn trừ 1 người (mọi nhóm)\n" +
          ".whitelist remove <ID Zalo> — Gỡ khỏi whitelist\n" +
          ".whitelist list — Xem danh sách whitelist\n" +
          ".antistatus — Xem đang bật/tắt luật nào\n\n" +
          "⚠️ Khi vi phạm, bot tự xoá tin + THU HẾT ngày dùng bot của người đó + cảnh báo trong nhóm + báo riêng cho admin. Bot KHÔNG tự kick được (Zalo không cho Bot làm quản trị viên nhóm) — cần Trưởng/Phó nhóm tự tay kick. Chỉ bắt được vi phạm ở những tin có @ TAG bot (giới hạn nền tảng Zalo).",
      });
      sections.push({
        title: "👑 ADMIN",
        body:
          "👑 ADMIN\n\n" +
          "add 7 <ID Zalo> — Cấp thêm 7 ngày sử dụng cho 1 người\n" +
          "tru 3 <ID Zalo> — Thu lại 3 ngày sử dụng của 1 người\n" +
          "naplt 5 <ID Zalo> — Cấp thêm 5 lượt dùng .td cho 1 người\n" +
          "trult 2 <ID Zalo> — Thu lại 2 lượt dùng .td của 1 người\n" +
          "thanhtoan <ID Zalo> <số tiền> — Xác nhận đã nhận tiền, tự quy đổi ra lượt\n" +
          "(bảo họ nhắn \"whoami\" để lấy ID, cách chắc chắn nhất. Hoặc dùng tên hiển thị nếu họ đã từng nhắn tin trong nhóm.)\n\n" +
          "id — Trả lời (Reply/Quote) tin nhắn của ai đó rồi gõ \"id\" để lấy ID Zalo của họ\n\n" +
          "capctv <ID Zalo> — Thêm CTV\n" +
          "thuctv <ID Zalo> — Gỡ CTV\n" +
          "dsctv — Xem danh sách CTV\n\n" +
          "vohanbox — Cấp vô hạn 30 ngày cho cả nhóm đang chat (gõ trong nhóm)\n" +
          "vohanbox 60 — Như trên, tuỳ chỉnh số ngày\n\n" +
          "setqr <ID nhóm> / Tên Chủ Khoản / Ngân Hàng / Số TK — Cấu hình QR chuyển khoản (khuyên gõ RIÊNG 1-1 với bot):\n" +
          "  1) Trong nhóm, gõ: @Tên Bot idnhom → lấy ID nhóm\n" +
          "  2) Nhắn RIÊNG với bot: setqr <ID nhóm> / Tên Chủ Khoản / Ngân Hàng / Số TK\n" +
          "  3) Bot xác nhận → gửi tiếp 1 ẢNH QR (chat riêng) → bot tự lưu cho đúng nhóm đó\n" +
          "  Sau đó ai gõ \"mã\" hoặc \"qr\" trong nhóm sẽ nhận đủ thông tin + ảnh.",
      });
    } else if (isCtv(fromId)) {
      sections.push({
        title: "🤝 CTV",
        body:
          "🤝 CTV\n\n" +
          "add 7 <ID Zalo> — Cấp thêm 7 ngày sử dụng cho 1 người (bảo họ nhắn \"whoami\" để lấy ID)\n" +
          "naplt 5 <ID Zalo> — Cấp thêm 5 lượt dùng .td cho 1 người\n" +
          "(Bạn không có quyền thu ngày/lượt — lệnh \"tru\"/\"trult\" chỉ admin dùng được)\n\n" +
          "id — Trả lời (Reply/Quote) tin nhắn của ai đó rồi gõ \"id\" để lấy ID Zalo của họ",
      });
    }

    const numberEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
    let list = "📋 MENU — BOT FF\n\n";
    sections.forEach((s, i) => {
      list += `${numberEmoji[i] || `${i + 1}.`} ${s.title}\n`;
    });
    list +=
      "\n✏️ Trả lời (Reply/Quote) đúng tin nhắn này rồi gõ SỐ tương ứng để xem chi tiết phần đó." +
      groupHint;

    // Lưu state chờ chọn số — key theo pendingKey (chatId:fromId) giống
    // các luồng nhiều bước khác (.td), để không bị lẫn giữa nhiều người
    // cùng gõ .menu trong 1 nhóm.
    pendingStep[pendingKey] = { step: "menu_select", sections: sections.map((s) => s.body) };

    return sendText(chatId, list);
  }

  // Gõ đúng PREFIX (VD ".") nhưng không khớp lệnh nào ở trên (.td, .help, .menu)
  // → báo rõ cho người dùng biết thay vì im lặng.
  return sendText(chatId, "⚠️Lệnh không tồn tại!");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server đang chạy ở cổng ${PORT}`));
