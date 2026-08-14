const axios = require("axios");

const BOT_TOKEN = process.env.ZALO_BOT_TOKEN;
const BASE_URL = `https://bot-api.zapps.me/bot${BOT_TOKEN}`;

async function call(method, payload) {
  try {
    const url = `${BASE_URL}/${method}`;
    const headers = { "Content-Type": "application/json" };
    const res = await axios.post(url, payload, { headers, timeout: 15000 });

    // Log toàn bộ phản hồi thô từ Zalo cho method sendPhoto — vì chưa
    // chắc chắn 100% cấu trúc phản hồi thành công/thất bại của Zalo Bot
    // Platform giống Telegram (field "ok") hay không (README gốc cũng đã
    // cảnh báo về điều này). Log full ra để xem log Railway là biết ngay
    // Zalo trả về cái gì, thay vì đoán mò.
    if (method === "sendPhoto") {
      console.log("Zalo sendPhoto raw response:", JSON.stringify(res.data));
    }

    // QUAN TRỌNG: Zalo Bot Platform (giống Telegram Bot API) có thể trả về
    // HTTP 200 (thành công theo axios) NHƯNG bên trong body là
    // { ok: false, description: "..." } khi bản thân yêu cầu bị từ chối
    // (VD: ảnh sai định dạng, chat_id không hợp lệ...). axios không tự
    // coi đây là lỗi vì status code vẫn là 200 — nếu không tự kiểm tra,
    // code sẽ "tưởng" đã gửi thành công trong khi Zalo thực ra đã từ chối,
    // dẫn đến im lặng hoàn toàn (không có ảnh, không có lỗi hiện ra).
    if (res.data && res.data.ok === false) {
      const desc = res.data.description || JSON.stringify(res.data);
      console.error(`Zalo Bot API [${method}] trả về ok:false:`, desc);
      throw new Error(`Zalo từ chối yêu cầu [${method}]: ${desc}`);
    }

    return res.data;
  } catch (e) {
    console.error(`Zalo Bot API [${method}] error:`, e.response?.data || e.message);
    throw e;
  }
}

async function sendText(chatId, text) {
  return call("sendMessage", { chat_id: chatId, text });
}

// ============================================================
// QUAN TRỌNG: Zalo Bot Platform's sendPhoto yêu cầu 1 URL ảnh công khai
// (photo_url), KHÔNG nhận upload file nhị phân trực tiếp qua multipart
// như Telegram. Xác nhận qua SDK chính thức khác (python-zalo-bot):
//   async send_photo(chat_id: str, caption: str, photo_url: str)
// Đây là lý do gửi Buffer qua FormData luôn bị lỗi
// "The photo must not be empty" dù buffer hợp lệ — Zalo tìm 1 chuỗi URL
// trong field "photo", không phải dữ liệu ảnh thô.
// → server.js giờ tự host ảnh ở 1 route công khai rồi gọi hàm này với
//   URL đó, thay vì gọi với Buffer như trước.
// ============================================================
async function sendPhotoByUrl(chatId, photoUrl, caption = "") {
  return call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
}

async function setWebhook(url, secretToken) {
  return call("setWebhook", { url, secret_token: secretToken });
}

// ============================================================
// XOÁ 1 TIN NHẮN — dùng cho tính năng CHỐNG PHÁ BOX (antispam/antitag/
// antilink): xoá ngay tin nhắn vi phạm nếu Zalo Bot Platform hỗ trợ.
// method "deleteMessage" copy theo đúng tên gọi của Telegram Bot API —
// CHƯA CÓ XÁC NHẬN CHÍNH THỨC Zalo Bot Platform có hỗ trợ hay không (y
// hệt tình huống sendPhoto/entities trước đây). Nếu Zalo trả lỗi
// "method not found"/404 cho method này, xem log Railway rồi báo lại để
// đổi tên method cho đúng — code gọi hàm này LUÔN bọc try/catch ở phía
// server.js nên 1 lần gọi thất bại sẽ không làm sập cả luồng xử lý tin.
// ============================================================
async function deleteMessage(chatId, messageId) {
  return call("deleteMessage", { chat_id: chatId, message_id: messageId });
}

// ============================================================
// KICK 1 THÀNH VIÊN KHỎI NHÓM (nhưng KHÔNG cấm quay lại vĩnh viễn) —
// dùng cho tính năng CHỐNG PHÁ BOX khi phát hiện spam/tag toàn nhóm/gửi
// link ngoài.
//
// Telegram Bot API (nền tảng Zalo Bot đang mô phỏng theo, xem cách đặt
// tên "sendMessage"/"sendPhoto"/"setWebhook" ở trên) KHÔNG có method
// "kick" riêng — cách làm chuẩn là gọi "banChatMember" để đá khỏi nhóm,
// sau đó gọi ngay "unbanChatMember" để họ CÓ THỂ tự vào lại sau này nếu
// được mời/link mời (nếu không unban, họ sẽ bị cấm vĩnh viễn — không
// đúng ý "kick" thông thường).
//
// QUAN TRỌNG — CHƯA XÁC NHẬN: hiện CHƯA có tài liệu công khai xác nhận
// Zalo Bot Platform có 2 method "banChatMember"/"unbanChatMember" y hệt
// tên gọi của Telegram hay không, và bot có cần được cấp quyền QUẢN TRỊ
// VIÊN (admin) trong nhóm Zalo mới kick được hay không (gần như chắc
// chắn LÀ CÓ, giống mọi nền tảng chat khác). Nếu dùng lần đầu mà bot báo
// lỗi (xem log Railway) — thường gặp nhất là:
//   1) "method not found" → tên method sai, cần đổi.
//   2) "not enough rights"/"forbidden" → bot CHƯA được gán quyền quản
//      trị viên (admin) trong nhóm Zalo đó — vào cài đặt nhóm, thêm bot
//      làm quản trị viên rồi thử lại.
// Copy nguyên văn lỗi gửi lại để chỉnh cho đúng.
// ============================================================
async function kickChatMember(chatId, userId) {
  await call("banChatMember", { chat_id: chatId, user_id: userId });
  try {
    await call("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
  } catch (e) {
    // Không throw tiếp — người đó ĐÃ bị kick khỏi nhóm (bước ban ở trên
    // đã thành công), chỉ là bước unban (cho phép vào lại sau này) bị
    // lỗi. Log lại để biết, nhưng không cần báo lỗi ra cho người dùng.
    console.error(`unbanChatMember thất bại sau khi kick user ${userId} khỏi chat ${chatId} (không ảnh hưởng việc đã kick):`, e.response?.data || e.message);
  }
}

module.exports = { sendText, sendPhotoByUrl, setWebhook, deleteMessage, kickChatMember };
