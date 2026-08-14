require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const { sendText, sendPhotoByUrl } = require("./zaloApi");
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

const PREFIX = process.env.PREFIX || ".";
const DATA_FILE = path.join(__dirname, "data.json");

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
function hasAccess(userId) {
  return isAdmin(userId) || daysLeft(userId) > 0;
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
function extractRepliedUserId(message) {
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

  return id ? String(id) : null;
}

// Khoá theo "chatId:fromId" (xem pendingKey bên dưới) để hỗ trợ cả chat
// riêng (1-1) LẪN chat nhóm — trong nhóm, nhiều người có thể cùng lúc ở
// giữa luồng .td mà không bị đè state của nhau.
const pendingStep = {}; // { "chatId:fromId": { step, accountId, mode, ... } }

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

    const rawText = (message.text || "").trim();
    const text = stripMention(rawText);
    if (!chatId || !text) return;

    console.log(
      `[DEBUG] chatId=${chatId} fromId=${fromId} isGroup=${isGroup} rawText=${JSON.stringify(rawText)} → text=${JSON.stringify(text)}` +
      (message.entities || message.mentions ? ` entities=${JSON.stringify(message.entities || message.mentions)}` : "") +
      (message.reply_to_message ? ` reply_to=${JSON.stringify(message.reply_to_message.from)}` : "")
    );
    // Nếu tin nhắn có vẻ như 1 Reply/Quote (dùng lệnh add/tru) nhưng
    // extractRepliedUserId() chưa bắt được ID, log NGUYÊN VĂN message để
    // biết chính xác Zalo đặt tên field gì cho tin được Reply — copy dòng
    // "[DEBUG] full message=" này gửi lại để chỉnh extractRepliedUserId().
    if (/^(add|tru)\s+\d+/i.test(text.trim()) && !extractRepliedUserId(message)) {
      console.log(`[DEBUG] full message=${JSON.stringify(message)}`);
    }

    // Khoá lưu trạng thái hội thoại nhiều bước: khoá theo CẢ nhóm lẫn người
    // gửi, để 2 người khác nhau trong cùng 1 nhóm cùng dùng .td không bị
    // đè state của nhau.
    const pendingKey = `${chatId}:${fromId}`;
    // Khoá lưu data.json: luôn theo NGƯỜI THẬT (fromId), không theo chatId,
    // để nhiều người trong cùng nhóm không bị ghi đè dữ liệu của nhau.
    const dataKey = fromId;

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

  // Tự kiểm tra số ngày còn lại của chính mình.
  if (/^(conlai|ngayconlai)$/i.test(text.trim())) {
    if (isAdmin(fromId)) return sendText(chatId, "👑 Bạn là admin — không giới hạn số ngày sử dụng.");
    return sendText(chatId, `📆 Bạn còn ${daysLeft(fromId)} ngày sử dụng bot.`);
  }

  // Lấy ID Zalo của chính mình — dùng để điền vào ADMIN_IDS.
  if (/^whoami$/i.test(text.trim())) {
    return sendText(chatId, `🆔 ID Zalo của bạn: ${fromId}`);
  }

  const pending = pendingStep[pendingKey];

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
      "1 — Mẫu mặc định (không cần ảnh nền riêng)\n" +
      "2 — Mẫu Overall Standings\n" +
      "3 — Mẫu Blue Lock\n" +
      "4 — Mẫu Hello Kitty\n" +
      "5 — Mẫu Xích Sắt\n\n" +
      "Trả lời 1, 2, 3, 4 hoặc 5" + groupHint
    );
  }

  // BƯỚC 4: chọn mẫu ảnh → chạy toàn bộ luồng lấy điểm
  if (pending?.step === "template") {
    if (!/^[12345]$/.test(text)) return sendText(chatId, `❌ Chỉ nhập 1, 2, 3, 4 hoặc 5!${groupHint}`);

    const selectedTemplate = parseInt(text);
    const { accountId, soKhung, mode, ngay, excludeMatchIndex, cprThreshold } = pending;
    delete pendingStep[pendingKey];
    const kg = KHUNG_GIO[soKhung];

    async function drawSelectedTemplate(sortedTeams, subtitleText) {
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

    await sendText(chatId, `⏳ Đang tìm trận của ID ${accountId} trong ${kg.label} ngày ${ngay}...`);

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

      await sendText(chatId, `${removedNote}⏳ Tìm thấy ${matches.length} trận${excludeMatchIndex ? " (sau khi xoá)" : ""}. Đang lấy chi tiết...`);

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

        const statusLine = hasChampion
          ? `👑 Đã có đội VÔ ĐỊCH (đạt ≥${threshold}đ & top1) sau ${usedMatches} trận — các trận sau không xét.`
          : `📊 Chưa có đội đủ điều kiện vô địch (ngưỡng ${threshold}đ) sau ${usedMatches} trận — xếp hạng theo tổng điểm.`;

        await sendText(chatId, `${removedNote}${statusLine}`);

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

      const medals = ["🥇","🥈","🥉"];
      let board = "";
      sorted.forEach((squad, i) => {
        const isMe = squad.rep === playerName;
        const rankLabel = medals[i] || `#${i+1}`;
        board += `${rankLabel}${isMe ? " ◀" : ""} ${squad.rep} | BY:${squad.by} EL:${squad.kill} | ${squad.score}pts\n`;
      });

      const summary =
        `🔥 BXH TỔNG — ${kg.label} ngày ${ngay}\n\n${board}\n` +
        `👤 Bạn: ${playerName}\n🏆 BOOYAH: ${totalBy}  💀 HẠ GỤC: ${totalElims}  ⭐ ĐIỂM: ${totalPts}\n` +
        `🎮 Số trận: ${matches.length}`;

      await sendText(chatId, `${removedNote}${summary}`);

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
    if (!hasAccess(dataKey)) {
      return sendText(
        chatId,
        `🚫 Bạn chưa được cấp ngày sử dụng bot (còn ${daysLeft(dataKey)} ngày).\n` +
        "Liên hệ admin để được cấp thêm ngày sử dụng."
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

    const khungList = Object.entries(KHUNG_GIO).map(([k, v]) => `${k} — ${v.label}`).join("\n");
    return sendText(
      chatId,
      `📋 CHỌN KHUNG GIỜ${isCpr ? " (BXH Vô Địch)" : ""}\n${khungList}\n\n` +
      `✏️ Trả lời số từ 1-8` +
      `${isCpr ? `\n(chế độ CPR, ngưỡng ${cprThreshold}đ)` : ""}` +
      `${excludeMatchIndex ? `\n(sẽ bỏ trận #${excludeMatchIndex})` : ""}` +
      groupHint
    );
  }

  // .help
  // Dòng hướng dẫn lệnh admin (add/tru/capctv) chỉ hiện với admin, dòng
  // hướng dẫn CTV (chỉ add) chỉ hiện với CTV — người dùng thường không
  // cần biết các lệnh này tồn tại.
  if (cmd === "help") {
    const adminHint = isAdmin(fromId)
      ? "\n\n👑 ADMIN — cấp/thu ngày: @Tên Bot add 7 <ID Zalo>  /  tru 3 <ID Zalo> (bảo họ nhắn \"whoami\" để lấy ID, cách chắc chắn nhất). Hoặc dùng tên hiển thị nếu họ đã từng nhắn tin trong nhóm.\n" +
        "👑 ADMIN — quản lý CTV: capctv <ID Zalo> (thêm CTV) / thuctv <ID Zalo> (gỡ CTV) / dsctv (xem danh sách)."
      : (isCtv(fromId)
          ? "\n\n🤝 CTV — cấp ngày: @Tên Bot add 7 <ID Zalo> (bảo họ nhắn \"whoami\" để lấy ID). Bạn không có quyền thu ngày (tru)."
          : "");
    return sendText(
      chatId,
      "📖 HƯỚNG DẪN BOT FF\n\n" +
      "👤 .td [ID] — Đăng ký + tìm trận (lưu data)\n" +
      ".td [ID] cpr — BXH có luật Vô Địch (≥50đ & top1), không lưu data\n" +
      ".td [ID] cprN — như trên, ngưỡng N điểm thay vì 50\n\n" +
      "🗑️ Thêm xoaN sau ID để bỏ trận thứ N.\n" +
      "VD: .td 4252953187 cpr40 xoa3\n\n" +
      "⚙️ Luồng: .td [ID] → chọn khung giờ (1-8) → nhập ngày → chọn mẫu ảnh (1-5) → bot tự lấy điểm.\n\n" +
      "📆 conlai — Xem số ngày bạn còn được dùng bot.\n\n" +
      "👥 TRONG NHÓM: bot chỉ nhận được tin khi bạn @ TAG bot hoặc Trả lời (Reply/Quote) 1 tin bot đã gửi — nhắn trơn không TAG sẽ không tới được bot." +
      adminHint
    );
  }

  // Gõ đúng PREFIX (VD ".") nhưng không khớp lệnh nào ở trên (.td, .help)
  // → báo rõ cho người dùng biết thay vì im lặng.
  return sendText(chatId, "⚠️Lệnh không tồn tại!");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server đang chạy ở cổng ${PORT}`));
