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

module.exports = { sendText, sendPhotoByUrl, setWebhook };
