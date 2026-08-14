const axios = require("axios");

const BOT_TOKEN = process.env.ZALO_BOT_TOKEN;
const BASE_URL = `https://bot-api.zapps.me/bot${BOT_TOKEN}`;

async function call(method, payload) {
  try {
    const url = `${BASE_URL}/${method}`;
    const headers = { "Content-Type": "application/json" };
    const res = await axios.post(url, payload, { headers, timeout: 15000 });

    // Log toàn bộ phản hồi thô từ Zalo cho các method quan trọng — vì chưa
    // chắc chắn 100% cấu trúc phản hồi thành công/thất bại của Zalo Bot
    // Platform giống Telegram (field "ok") hay không (README gốc cũng đã
    // cảnh báo về điều này). Log full ra để xem log Railway là biết ngay
    // Zalo trả về cái gì, thay vì đoán mò. sendMessage/deleteMessage được
    // thêm vào đây để debug field message_id phục vụ tính năng TỰ ĐỘNG
    // XOÁ TIN NHẮN bên dưới.
    if (method === "sendPhoto" || method === "sendMessage" || method === "deleteMessage") {
      console.log(`Zalo ${method} raw response:`, JSON.stringify(res.data));
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

// ============================================================
// TỰ ĐỘNG XOÁ TIN NHẮN BOT ĐÃ GỬI SAU 5 PHÚT
// ============================================================
// GHI CHÚ QUAN TRỌNG: chưa có tài liệu công khai xác nhận Zalo Bot
// Platform CÓ hỗ trợ method "deleteMessage" hay không (dù nền tảng này mô
// phỏng rất sát Telegram Bot API ở các method khác: sendMessage, sendPhoto,
// setWebhook...). Cơ chế dưới đây CỐ GẮNG gọi deleteMessage sau mỗi tin bot
// gửi (cả sendText lẫn sendPhotoByUrl) — nếu Zalo từ chối (method không
// tồn tại/không hỗ trợ), tự động TẮT HẲN cơ chế này ngay từ lần thất bại
// ĐẦU TIÊN (để không lặp lại lỗi này cho hàng loạt tin nhắn khác đang chờ
// xoá), và log 1 dòng RÕ RÀNG để biết chắc nền tảng có hỗ trợ hay không —
// xem log Railway sau khi bot chạy được ~5 phút để kiểm tra.
//
// GIỚI HẠN: bộ đếm giờ (setTimeout) chỉ tồn tại trong bộ nhớ của process
// hiện tại — nếu Railway restart/redeploy trong lúc đang chờ, các tin
// nhắn đã lên lịch xoá trước đó sẽ KHÔNG được xoá nữa (không có gì lưu
// lại để chạy tiếp sau khi restart). Đây là giới hạn chấp nhận được cho
// tính năng "dọn rác" tin nhắn cũ, không ảnh hưởng logic nghiệp vụ chính.
// ============================================================
const AUTO_DELETE_MS = 5 * 60 * 1000;
let autoDeleteSupported = true; // giả định hỗ trợ, tự tắt nếu gọi thất bại lần đầu
let autoDeleteWarned = false;

// Thử nhiều khả năng field chứa message_id trong phản hồi, giống cách
// server.js đã làm cho photo/reply/mention khi chưa rõ field chính xác.
function extractMessageId(apiResult) {
  return (
    apiResult?.result?.message_id ??
    apiResult?.result?.id ??
    apiResult?.message_id ??
    apiResult?.id ??
    null
  );
}

function scheduleAutoDelete(chatId, apiResult) {
  if (!autoDeleteSupported) return;
  const messageId = extractMessageId(apiResult);
  if (!messageId) {
    console.log("[AutoDelete] Không lấy được message_id từ phản hồi, bỏ qua tự xoá tin này:", JSON.stringify(apiResult));
    return;
  }
  setTimeout(async () => {
    if (!autoDeleteSupported) return; // có thể đã bị tắt bởi 1 tin khác trong lúc chờ
    try {
      await call("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch (e) {
      // Thất bại lần đầu → rất có thể Zalo Bot Platform KHÔNG hỗ trợ
      // deleteMessage. Tắt hẳn cơ chế để không lặp lại lỗi này cho mọi
      // tin nhắn khác đang/sẽ chờ xoá.
      autoDeleteSupported = false;
      if (!autoDeleteWarned) {
        autoDeleteWarned = true;
        console.error(
          "[AutoDelete] Gọi deleteMessage thất bại — CÓ THỂ Zalo Bot Platform " +
          "KHÔNG hỗ trợ tự xoá tin nhắn (method deleteMessage). Đã TẮT tính năng " +
          "tự động xoá tin nhắn cho các tin tiếp theo. Chi tiết lỗi:",
          e.response?.data || e.message
        );
      }
    }
  }, AUTO_DELETE_MS);
}

async function sendText(chatId, text) {
  const result = await call("sendMessage", { chat_id: chatId, text });
  scheduleAutoDelete(chatId, result);
  return result;
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
  const result = await call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
  scheduleAutoDelete(chatId, result);
  return result;
}

async function setWebhook(url, secretToken) {
  return call("setWebhook", { url, secret_token: secretToken });
}

module.exports = { sendText, sendPhotoByUrl, setWebhook };
