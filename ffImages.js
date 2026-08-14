const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

// ============================================================
// helper dùng chung để load ảnh mẫu (template) từ ổ đĩa.
//
// LƯU Ý QUAN TRỌNG: @napi-rs/canvas's loadImage(str) thử parse chuỗi
// truyền vào bằng `new URL(str)` trước để biết đó là link mạng hay
// đường dẫn file. Một đường dẫn tuyệt đối kiểu "/app/assets/..." KHÔNG
// phải là URL hợp lệ (thiếu "file://" hoặc "http://") nên bị ném lỗi
// đúng-y-chang: "Invalid URL". Đây là nguyên nhân lỗi "❌ Lỗi API:
// Invalid URL" mà bot báo — KHÔNG liên quan tới việc file có tồn tại
// hay không.
//
// Cách né lỗi này: tự đọc file bằng fs.readFileSync() thành Buffer,
// rồi đưa Buffer đó cho loadImage() — Buffer thì không bị đem đi parse
// như URL nữa. Đồng thời báo lỗi tiếng Việt rõ ràng nếu file thật sự
// không tồn tại, thay vì để lỗi "Invalid URL" khó hiểu lọt ra ngoài.
// ============================================================
function loadTemplateImage(templatePath, humanName) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Thiếu file ảnh mẫu "${humanName}" — cần copy vào: ${templatePath}`
    );
  }
  const stat = fs.statSync(templatePath);
  if (stat.size === 0) {
    throw new Error(`File ảnh mẫu "${humanName}" có 0 byte (file rỗng/hỏng): ${templatePath}`);
  }
  const buffer = fs.readFileSync(templatePath);
  return loadImage(buffer).then((img) => {
    // Nếu loadImage() giải mã thất bại một cách "êm ái" (không throw)
    // nó có thể trả về ảnh với width/height = 0 → canvas tạo ra sẽ rỗng,
    // và khi gửi cho Zalo sẽ bị lỗi "The photo must not be empty".
    // Log ra để lần test sau biết ngay nguồn gốc lỗi nằm ở đây.
    console.log(`Đã load ảnh mẫu "${humanName}": ${img.width}x${img.height}, file ${stat.size} bytes`);
    if (!img.width || !img.height) {
      throw new Error(`Ảnh mẫu "${humanName}" giải mã ra kích thước 0x0 (file JPG có thể bị hỏng): ${templatePath}`);
    }
    return img;
  });
}

// Đăng ký font riêng — BẮT BUỘC vì server (Railway/Docker) thường không có sẵn
// font hệ thống. Nếu thiếu, ctx.fillText() chạy nhưng không vẽ được chữ.
// ⚠️ Bạn cần copy file assets/fonts/DejaVuSans-Bold.ttf từ bot Discord cũ vào đây.
const FONT_PATH = path.join(__dirname, "assets", "fonts", "DejaVuSans-Bold.ttf");
try {
  GlobalFonts.registerFromPath(FONT_PATH, "AppFont");
} catch (e) {
  console.error("Font register error (thiếu file font? xem README):", e.message);
}

// ============================================================
// MẪU MẶC ĐỊNH — vẽ trên nền gradient tự tạo, KHÔNG cần ảnh mẫu ngoài.
// Dùng được ngay không cần upload thêm asset nào.
// ============================================================
function drawBxhImage(sortedTeams, { title, subtitle, playerName }) {
  const rowH = 64;
  const headerH = 140;
  const footerH = 40;
  const width = 900;
  const height = headerH + footerH + rowH * Math.max(sortedTeams.length, 1);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#1b1033");
  bg.addColorStop(1, "#0d0717");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#ffa500";
  ctx.font = "bold 36px AppFont";
  ctx.textAlign = "center";
  ctx.fillText(title, width / 2, 56);

  ctx.fillStyle = "#cccccc";
  ctx.font = "20px AppFont";
  ctx.fillText(subtitle, width / 2, 90);

  ctx.textAlign = "left";
  ctx.font = "bold 18px AppFont";
  ctx.fillStyle = "#888888";
  ctx.fillText("HẠNG", 30, headerH - 10);
  ctx.fillText("TÊN ĐỘI", 130, headerH - 10);
  ctx.fillText("BOOYAH", 540, headerH - 10);
  ctx.fillText("HẠ GỤC", 660, headerH - 10);
  ctx.textAlign = "right";
  ctx.fillText("ĐIỂM", width - 30, headerH - 10);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#444444";
  ctx.beginPath();
  ctx.moveTo(20, headerH);
  ctx.lineTo(width - 20, headerH);
  ctx.stroke();

  const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

  sortedTeams.forEach((squad, i) => {
    const y = headerH + i * rowH;
    const isMe = playerName && squad.rep === playerName;
    const isChampion = !!squad.champion;

    if (i < 3) {
      ctx.fillStyle = "rgba(255,165,0,0.08)";
      ctx.fillRect(20, y, width - 40, rowH - 6);
    }
    if (isMe) {
      ctx.fillStyle = "rgba(0,191,255,0.15)";
      ctx.fillRect(20, y, width - 40, rowH - 6);
      ctx.strokeStyle = "#00bfff";
      ctx.strokeRect(20, y, width - 40, rowH - 6);
    }
    if (isChampion) {
      ctx.fillStyle = "rgba(255,215,0,0.18)";
      ctx.fillRect(20, y, width - 40, rowH - 6);
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 2;
      ctx.strokeRect(20, y, width - 40, rowH - 6);
      ctx.lineWidth = 1;
    }

    ctx.font = "bold 26px AppFont";
    ctx.fillStyle = isChampion ? "#FFD700" : (medalColors[i] || "#ffffff");
    const rankLabel = isChampion ? "👑" : (i < 3 ? ["🥇","🥈","🥉"][i] : `#${i + 1}`);
    ctx.fillText(rankLabel, 30, y + 40);

    ctx.font = "bold 22px AppFont";
    ctx.fillStyle = isChampion ? "#FFD700" : (isMe ? "#00bfff" : "#ffffff");
    let name = squad.rep || "Unknown";
    if (name.length > 18) name = name.slice(0, 17) + "…";
    const suffix = isChampion ? "  👑 VÔ ĐỊCH" : (isMe ? "  ◀ Bạn" : "");
    ctx.fillText(name + suffix, 130, y + 40);

    ctx.font = "20px AppFont";
    ctx.fillStyle = "#ffd700";
    ctx.fillText(String(squad.by ?? 0), 555, y + 40);

    ctx.fillStyle = "#ff6666";
    ctx.fillText(String(squad.kill ?? 0), 675, y + 40);

    ctx.font = "bold 24px AppFont";
    ctx.fillStyle = isChampion ? "#FFD700" : "#ffa500";
    ctx.textAlign = "right";
    ctx.fillText(String(squad.score ?? 0), width - 30, y + 40);
    ctx.textAlign = "left";
  });

  ctx.textAlign = "center";
  ctx.font = "14px AppFont";
  ctx.fillStyle = "#777777";
  ctx.fillText("FREE FIRE • X6 ESP", width / 2, height - 14);

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// 4 MẪU ẢNH NỀN CÓ SẴN (Overall Standings / Blue Lock / Hello Kitty / Xích Sắt)
// ⚠️ Cần copy các file ảnh gốc từ bot Discord cũ vào assets/templates/ để dùng.
// Nếu chưa có ảnh, các hàm này sẽ báo lỗi khi gọi — dùng drawBxhImage() thay thế.
// ============================================================
const TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "standings_template.jpg");
let _templateImgCache = null;
async function getTemplateImage() {
  if (!_templateImgCache) _templateImgCache = await loadTemplateImage(TEMPLATE_PATH, "Overall Standings");
  return _templateImgCache;
}

async function drawStandingsTemplateImage(sortedTeams, { subtitle } = {}) {
  const img = await getTemplateImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / 1037;
  const scaleY = height / 1280;

  const xTeam   = 100 * scaleX;
  const xBooyah = 590 * scaleX;
  const xElims  = 672 * scaleX;
  const xPts    = 752 * scaleX;
  const yStart  = 418 * scaleY;
  const yStep   = 66  * scaleY;

  ctx.textBaseline = "middle";

  sortedTeams.slice(0, 12).forEach((squad, i) => {
    const y = yStart + i * yStep;

    ctx.font = `bold ${Math.round(28 * scaleY)}px AppFont`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    let name = squad.rep || "Unknown";
    if (name.length > 20) name = name.slice(0, 19) + "…";
    ctx.fillText(name, xTeam, y);

    ctx.font = `bold ${Math.round(28 * scaleY)}px AppFont`;
    ctx.fillStyle = "#1a1a1a";
    ctx.textAlign = "center";
    ctx.fillText(String(squad.by ?? 0), xBooyah, y);
    ctx.fillText(String(squad.kill ?? 0), xElims, y);
    ctx.fillText(String(squad.score ?? 0), xPts, y);
  });

  if (subtitle) {
    ctx.font = `${Math.round(18 * scaleY)}px AppFont`;
    ctx.fillStyle = "#ffe6a8";
    ctx.textAlign = "left";
    ctx.fillText(subtitle, 115 * scaleX, 335 * scaleY);
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

const BLUELOCK_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "bluelock_template.jpg");
let _bluelockImgCache = null;
async function getBluelockImage() {
  if (!_bluelockImgCache) _bluelockImgCache = await loadTemplateImage(BLUELOCK_TEMPLATE_PATH, "Blue Lock");
  return _bluelockImgCache;
}

const BLUELOCK_BASE_W = 902;
const BLUELOCK_BASE_H = 1128;
const BLUELOCK_COLS_LEFT  = { team: [112, 285], elim: [290, 328], by: [358, 386], pts: [405, 443] };
const BLUELOCK_COLS_RIGHT = { team: [550, 725], elim: [733, 771], by: [800, 832], pts: [858, 893] };
const BLUELOCK_RANK1_Y     = 425;
const BLUELOCK_LEFT_ROWS   = { 2: 502, 3: 547, 4: 588, 5: 630, 6: 667 };
const BLUELOCK_RIGHT_ROWS  = { 7: 464, 8: 502, 9: 542, 10: 582, 11: 622, 12: 662 };

async function drawBluelockTemplateImage(sortedTeams) {
  const img = await getBluelockImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / BLUELOCK_BASE_W;
  const scaleY = height / BLUELOCK_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#ffffff", size = 18 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX + 4 : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  function drawRow(cols, y, squad, size) {
    if (!squad) return;
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", color: "#ffffff", size });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", color: "#ffffff", size });
    drawCell(cols.by,   y, String(squad.by ?? 0),   { align: "center", color: "#ffffff", size });
    drawCell(cols.pts,  y, String(squad.score ?? 0),{ align: "center", color: "#ffffff", size });
  }

  if (sortedTeams[0]) drawRow(BLUELOCK_COLS_LEFT, BLUELOCK_RANK1_Y, sortedTeams[0], 20);
  Object.entries(BLUELOCK_LEFT_ROWS).forEach(([rank, y]) => {
    drawRow(BLUELOCK_COLS_LEFT, y, sortedTeams[parseInt(rank) - 1], 18);
  });
  Object.entries(BLUELOCK_RIGHT_ROWS).forEach(([rank, y]) => {
    drawRow(BLUELOCK_COLS_RIGHT, y, sortedTeams[parseInt(rank) - 1], 18);
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

const HK_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "hellokitty_template.jpg");
let _hkImgCache = null;
async function getHkImage() {
  if (!_hkImgCache) _hkImgCache = await loadTemplateImage(HK_TEMPLATE_PATH, "Hello Kitty");
  return _hkImgCache;
}

const HK_BASE_W = 1264;
const HK_BASE_H = 843;
const HK_COLS_LEFT  = { team: [150, 300], elim: [300, 412], by: [412, 537], pts: [537, 606] };
const HK_COLS_RIGHT = { team: [750, 902], elim: [902, 1005], by: [1005, 1130], pts: [1130, 1202] };
const HK_ROWS_Y = [288, 342, 396, 450, 504, 558];

async function drawHkTemplateImage(sortedTeams) {
  const img = await getHkImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / HK_BASE_W;
  const scaleY = height / HK_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#7a3b52", size = 16 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX + 4 : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 16) text = text.slice(0, 15) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", size: 16 });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 16 });
    drawCell(cols.by,   y, String(squad.by ?? 0),   { align: "center", size: 16 });
    drawCell(cols.pts,  y, String(squad.score ?? 0),{ align: "center", size: 16 });
  }

  HK_ROWS_Y.forEach((y, i) => drawRow(HK_COLS_LEFT, y, sortedTeams[i]));
  HK_ROWS_Y.forEach((y, i) => drawRow(HK_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

const CHAIN_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "chain_template.jpg");
let _chainImgCache = null;
async function getChainImage() {
  if (!_chainImgCache) _chainImgCache = await loadTemplateImage(CHAIN_TEMPLATE_PATH, "Xích Sắt");
  return _chainImgCache;
}

const CHAIN_BASE_W = 2028;
const CHAIN_BASE_H = 2560;
const CHAIN_COLS = {
  team: [1010, 1550],
  elim: [1647, 1647],
  by:   [1780, 1780],
  pts:  [1925, 1925],
};
const CHAIN_ROWS = {
  1: 895,  2: 1009, 3: 1124, 4: 1238,
  5: 1352, 6: 1467, 7: 1581, 8: 1696,
  9: 1810, 10: 1924, 11: 2039, 12: 2153,
};

async function drawChainTemplateImage(sortedTeams) {
  const img = await getChainImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / CHAIN_BASE_W;
  const scaleY = height / CHAIN_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#ffffff", size = 30 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX + 4 : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  Object.entries(CHAIN_ROWS).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(CHAIN_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#ffffff", size: 30 });
    drawCell(CHAIN_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#ffffff", size: 28 });
    drawCell(CHAIN_COLS.by,   y, String(t.by ?? 0),   { align: "center", color: "#ffe600", size: 28 });
    drawCell(CHAIN_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color: "#ffa500", size: 30 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

module.exports = {
  drawBxhImage,
  drawStandingsTemplateImage,
  drawBluelockTemplateImage,
  drawHkTemplateImage,
  drawChainTemplateImage,
};
