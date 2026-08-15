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

// ============================================================
// MẪU 6 — "FREE FIRE BẢNG XẾP HẠNG" (nền tím-xanh, sét vàng, 1 cột 12 dòng)
// ⚠️ Cần copy file ảnh gốc (freefire_bxh_template.jpg) vào assets/templates/.
// Toạ độ bên dưới đã đo trực tiếp trên ảnh mẫu gốc kích thước 1024x1024 —
// nếu đổi ảnh mẫu khác kích thước khác, scaleX/scaleY sẽ tự co giãn theo,
// nhưng layout (khoảng cách dòng) chỉ đúng nếu ảnh mới có bố cục y hệt.
// ============================================================
const FREEFIRE_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "freefire_bxh_template.jpg");
let _freefireImgCache = null;
async function getFreefireImage() {
  if (!_freefireImgCache) _freefireImgCache = await loadTemplateImage(FREEFIRE_TEMPLATE_PATH, "Free Fire Bảng Xếp Hạng");
  return _freefireImgCache;
}

const FREEFIRE_BASE_W = 1024;
const FREEFIRE_BASE_H = 1024;
// Cột: [x1, x2] theo px đo trên ảnh mẫu gốc 1024x1024.
const FREEFIRE_COLS = {
  team: [520, 743], // căn trái, chừa lề trong thanh màu của từng hạng
  elim: [744, 822],
  by:   [823, 904],
  pts:  [905, 995],
};
// Tâm Y của từng dòng hạng 1→12, đo trực tiếp trên ảnh mẫu gốc.
const FREEFIRE_ROWS_Y = {
  1: 335, 2: 385, 3: 435, 4: 483, 5: 530, 6: 579,
  7: 627, 8: 676, 9: 724, 10: 773, 11: 821, 12: 870,
};

async function drawFreefireTemplateImage(sortedTeams) {
  const img = await getFreefireImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / FREEFIRE_BASE_W;
  const scaleY = height / FREEFIRE_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#ffffff", size = 26 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  Object.entries(FREEFIRE_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(FREEFIRE_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#ffffff", size: 26 });
    drawCell(FREEFIRE_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#ffffff", size: 26 });
    drawCell(FREEFIRE_COLS.by,   y, String(t.by ?? 0),   { align: "center", color: "#ffffff", size: 26 });
    drawCell(FREEFIRE_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color: "#ffff50", size: 26 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 7 — "FREE FIRE" 2 CỘT (cam-đỏ, có ô #1 nổi bật riêng + 2 bảng
// RANK 2-6 bên trái / RANK 7-12 bên phải).
// ⚠️ Cần copy file ảnh gốc (freefire2_bxh_template.jpg/png) vào
// assets/templates/. Toạ độ đo trực tiếp trên ảnh mẫu gốc 1638x2048
// (đọc từng nhãn #1..#12 để xác nhận, không suy diễn theo spacing đều
// vì 2 bảng có mốc bắt đầu Y khác nhau — bảng trái bắt đầu thấp hơn do
// có ô #1 to chiếm chỗ phía trên).
// ============================================================
const FREEFIRE2_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "freefire2_bxh_template.jpg");
let _freefire2ImgCache = null;
async function getFreefire2Image() {
  if (!_freefire2ImgCache) _freefire2ImgCache = await loadTemplateImage(FREEFIRE2_TEMPLATE_PATH, "Free Fire 2 Cột");
  return _freefire2ImgCache;
}

// Toạ độ gốc đo trên ảnh mẫu 1638x2048 — GIỮ NGUYÊN, code tự scale theo
// kích thước ảnh thật load lên (scaleX/scaleY bên dưới).
const FREEFIRE2_BASE_W = 1638;
const FREEFIRE2_BASE_H = 2048;

// Cột X — bảng trái (rank 2-6) và bảng phải (rank 7-12) tách biệt.
const FREEFIRE2_COLS_LEFT  = { team: 200, elim: 520, by: 627, pts: 735 };
const FREEFIRE2_COLS_RIGHT = { team: 1000, elim: 1355, by: 1460, pts: 1577 };
// Ô #1 đặc biệt (to hơn, nằm riêng phía trên bảng trái) dùng cột team
// giống bảng trái nhưng elim/by/pts lệch sang phải hơn do chữ to hơn.
const FREEFIRE2_RANK1 = { y: 829, team: 200, elim: 550, by: 647, pts: 760 };

// Hàng Y — đã xác nhận bằng cách đọc trực tiếp từng nhãn #2..#12 trên
// ảnh mẫu gốc (KHÔNG suy theo spacing đều), vì bảng phải bắt đầu ở #7
// cao hơn bảng trái (#2) — bảng trái mất chỗ phía trên cho ô #1 to.
const FREEFIRE2_ROWS_LEFT  = { 2: 985, 3: 1060, 4: 1135, 5: 1210, 6: 1285 };
const FREEFIRE2_ROWS_RIGHT = { 7: 910, 8: 985, 9: 1060, 10: 1135, 11: 1210, 12: 1285 };

async function drawFreefire2TemplateImage(sortedTeams) {
  const img = await getFreefire2Image();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / FREEFIRE2_BASE_W;
  const scaleY = height / FREEFIRE2_BASE_H;
  ctx.textBaseline = "middle";

  function drawText(x, y, str, { align = "center", color = "#ffffff", size = 34 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 14) text = text.slice(0, 13) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  function drawRow(cols, y, squad, size) {
    if (!squad) return;
    drawText(cols.team, y, squad.rep || "Unknown", { align: "left",  color: "#ffffff", size });
    drawText(cols.elim, y, String(squad.kill ?? 0), { align: "center", color: "#ffffff", size });
    drawText(cols.by,   y, String(squad.by ?? 0).padStart(2, "0"), { align: "center", color: "#ffffff", size });
    drawText(cols.pts,  y, String(squad.score ?? 0),{ align: "center", color: "#ffe14d", size });
  }

  // Ô #1 (to hơn) — dùng size chữ lớn hơn các dòng còn lại
  if (sortedTeams[0]) {
    drawRow(
      { team: FREEFIRE2_RANK1.team, elim: FREEFIRE2_RANK1.elim, by: FREEFIRE2_RANK1.by, pts: FREEFIRE2_RANK1.pts },
      FREEFIRE2_RANK1.y,
      sortedTeams[0],
      40
    );
  }

  Object.entries(FREEFIRE2_ROWS_LEFT).forEach(([rank, y]) => {
    drawRow(FREEFIRE2_COLS_LEFT, y, sortedTeams[parseInt(rank) - 1], 34);
  });
  Object.entries(FREEFIRE2_ROWS_RIGHT).forEach(([rank, y]) => {
    drawRow(FREEFIRE2_COLS_RIGHT, y, sortedTeams[parseInt(rank) - 1], 34);
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 8 — "HUNTER X HUNTER" (nền sấm sét xanh, Gon/Killua, 2 bảng
// trái RANK 1-6 / phải RANK 7-12).
// ⚠️ Cần copy file ảnh gốc (hxh_template.jpg) vào assets/templates/.
// Toạ độ đo trực tiếp trên ảnh mẫu gốc 1086x1448 (đo bằng lưới pixel
// theo từng cột TEAM NAME / ELIMS / BY! / PTS và tâm Y của mỗi dòng 1-12).
// ============================================================
const HXH_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "hxh_template.jpg");
let _hxhImgCache = null;
async function getHxhImage() {
  if (!_hxhImgCache) _hxhImgCache = await loadTemplateImage(HXH_TEMPLATE_PATH, "Hunter x Hunter");
  return _hxhImgCache;
}

const HXH_BASE_W = 1086;
const HXH_BASE_H = 1448;
const HXH_COLS_LEFT  = { team: [90, 320], elim: [320, 400], by: [400, 460], pts: [460, 525] };
const HXH_COLS_RIGHT = { team: [635, 850], elim: [850, 925], by: [925, 985], pts: [985, 1050] };
const HXH_ROWS_Y = [658, 711, 764, 817, 870, 923];

async function drawHxhTemplateImage(sortedTeams) {
  const img = await getHxhImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / HXH_BASE_W;
  const scaleY = height / HXH_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#ffffff", size = 26 } = {}) {
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
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", size: 26 });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 26 });
    drawCell(cols.by,   y, String(squad.by ?? 0),   { align: "center", size: 26 });
    drawCell(cols.pts,  y, String(squad.score ?? 0),{ align: "center", size: 26 });
  }

  HXH_ROWS_Y.forEach((y, i) => drawRow(HXH_COLS_LEFT, y, sortedTeams[i]));
  HXH_ROWS_Y.forEach((y, i) => drawRow(HXH_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 9 — "MINECRAFT TOURNAMENT" (nền Minecraft, Steve/Alex, 2 bảng
// trái RANK 1-6 / phải RANK 7-12).
// ⚠️ Cần copy file ảnh gốc (minecraft_template.jpg) vào assets/templates/.
// Toạ độ đo trực tiếp trên ảnh mẫu gốc 1086x1448, cùng cách đo như mẫu HxH.
// ============================================================
const MC_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "minecraft_template.jpg");
let _mcImgCache = null;
async function getMcImage() {
  if (!_mcImgCache) _mcImgCache = await loadTemplateImage(MC_TEMPLATE_PATH, "Minecraft Tournament");
  return _mcImgCache;
}

const MC_BASE_W = 1086;
const MC_BASE_H = 1448;
const MC_COLS_LEFT  = { team: [90, 270], elim: [270, 355], by: [355, 430], pts: [430, 525] };
const MC_COLS_RIGHT = { team: [635, 800], elim: [800, 880], by: [880, 955], pts: [955, 1050] };
const MC_ROWS_Y = [618, 670, 723, 775, 828, 880];

async function drawMinecraftTemplateImage(sortedTeams) {
  const img = await getMcImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / MC_BASE_W;
  const scaleY = height / MC_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#ffffff", size = 26 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX + 4 : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 14) text = text.slice(0, 13) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", size: 26 });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 26 });
    drawCell(cols.by,   y, String(squad.by ?? 0),   { align: "center", size: 26 });
    drawCell(cols.pts,  y, String(squad.score ?? 0),{ align: "center", size: 26 });
  }

  MC_ROWS_Y.forEach((y, i) => drawRow(MC_COLS_LEFT, y, sortedTeams[i]));
  MC_ROWS_Y.forEach((y, i) => drawRow(MC_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 10 — "HELLO KITTY SCRIM" (nền hồng pastel, banner FREE FIRE
// SCRIM, 2 bảng trái RANK 1-6 / phải RANK 7-12, không có ô kẻ dọc
// rõ, chỉ có đường kẻ ngang phân dòng).
// ⚠️ Cần copy file ảnh gốc (kitty_scrim_template.png) vào assets/templates/.
// Toạ độ đo trực tiếp trên ảnh mẫu gốc 1024x1024 bằng phân tích pixel
// (dò cụm chữ vàng ở header + dò đường kẻ phân dòng màu cam).
// ============================================================
const KITTY_SCRIM_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "kitty_scrim_template.png");
let _kittyScrimImgCache = null;
async function getKittyScrimImage() {
  if (!_kittyScrimImgCache) _kittyScrimImgCache = await loadTemplateImage(KITTY_SCRIM_TEMPLATE_PATH, "Hello Kitty Scrim");
  return _kittyScrimImgCache;
}

const KITTY_BASE_W = 1024;
const KITTY_BASE_H = 1024;
const KITTY_COLS_LEFT  = { team: [80, 270],  elim: [270, 347], by: [347, 450], pts: [450, 505] };
const KITTY_COLS_RIGHT = { team: [580, 770], elim: [770, 847], by: [847, 950], pts: [950, 1005] };
const KITTY_ROWS_Y = [320, 394, 468, 543, 618, 690];

async function drawKittyScrimTemplateImage(sortedTeams) {
  const img = await getKittyScrimImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / KITTY_BASE_W;
  const scaleY = height / KITTY_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#3a1a1a", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 14) text = text.slice(0, 13) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", size: 22 });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 22 });
    drawCell(cols.by,   y, String(squad.by ?? 0),   { align: "center", size: 22 });
    drawCell(cols.pts,  y, String(squad.score ?? 0),{ align: "center", size: 22 });
  }

  KITTY_ROWS_Y.forEach((y, i) => drawRow(KITTY_COLS_LEFT, y, sortedTeams[i]));
  KITTY_ROWS_Y.forEach((y, i) => drawRow(KITTY_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 11 — "FREE FIRE CLASSIC" (nền trắng, logo Free Fire góc trên,
// 1 bảng DUY NHẤT liệt kê liên tục 12 dòng — không chia trái/phải).
// ⚠️ Cần copy file ảnh gốc (freefire_classic_template.png) vào assets/templates/.
// Toạ độ đo trực tiếp trên ảnh mẫu gốc 1024x1024 bằng phân tích pixel
// (dò đường viền cột đen + đường kẻ ngang phân dòng).
// ============================================================
const FFCLASSIC_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "freefire_classic_template.png");
let _ffClassicImgCache = null;
async function getFfClassicImage() {
  if (!_ffClassicImgCache) _ffClassicImgCache = await loadTemplateImage(FFCLASSIC_TEMPLATE_PATH, "Free Fire Classic");
  return _ffClassicImgCache;
}

const FFCLASSIC_BASE_W = 1024;
const FFCLASSIC_BASE_H = 1024;
const FFCLASSIC_COLS = { team: [512, 742], elim: [742, 823], by: [823, 904], pts: [904, 989] };
const FFCLASSIC_ROWS_Y = [337, 384, 433, 481, 530, 578, 627, 675, 724, 773, 821, 870];

async function drawFreefireClassicTemplateImage(sortedTeams) {
  const img = await getFfClassicImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / FFCLASSIC_BASE_W;
  const scaleY = height / FFCLASSIC_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell([x1, x2], y, str, { align = "center", color = "#1a1a2e", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const x = align === "left" ? x1 * scaleX : ((x1 + x2) / 2) * scaleX;
    let text = str;
    if (align === "left" && text.length > 16) text = text.slice(0, 15) + "…";
    ctx.fillText(text, x, y * scaleY);
  }

  FFCLASSIC_ROWS_Y.forEach((y, i) => {
    const squad = sortedTeams[i];
    if (!squad) return;
    drawCell(FFCLASSIC_COLS.team, y, squad.rep || "Unknown", { align: "left", size: 22 });
    drawCell(FFCLASSIC_COLS.elim, y, String(squad.kill ?? 0), { align: "center", size: 22 });
    drawCell(FFCLASSIC_COLS.by,   y, String(squad.by ?? 0),   { align: "center", size: 22 });
    drawCell(FFCLASSIC_COLS.pts,  y, String(squad.score ?? 0),{ align: "center", size: 22 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 12 — "BLUE LOCK SCRIM" (nền tối xanh navy, Isagi/Rin, banner
// TOP 1 lớn riêng phía trên + 2 bảng trái RANK 2-7 / phải RANK 8-13,
// tổng cộng 13 đội — KHÁC với mẫu Blue Lock cũ chỉ có 12 đội).
// ⚠️ Cần copy file ảnh gốc (bluelock_scrim_template.png) vào assets/templates/.
// Toạ độ đo trực tiếp trên ảnh mẫu gốc 928x1152 (đối chiếu từ ảnh dữ liệu
// mẫu thực tế 1638x2048 do người dùng cung cấp, quy đổi theo tỉ lệ).
// ============================================================
const BLSCRIM_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "bluelock_scrim_template.png");
let _blScrimImgCache = null;
async function getBlScrimImage() {
  if (!_blScrimImgCache) _blScrimImgCache = await loadTemplateImage(BLSCRIM_TEMPLATE_PATH, "Blue Lock Scrim");
  return _blScrimImgCache;
}

const BLSCRIM_BASE_W = 928;
const BLSCRIM_BASE_H = 1152;

// TOP 1 (băng lớn phía trên)
const BLSCRIM_TOP1_NAME_X = 286;
const BLSCRIM_TOP1_NAME_Y = 540;
const BLSCRIM_TOP1_STATS_Y = 485;
const BLSCRIM_TOP1_ELIM_CX = 609;
const BLSCRIM_TOP1_BY_CX   = 722;
const BLSCRIM_TOP1_PTS_CX  = 819;

// Bảng trái (hạng 2-7) / phải (hạng 8-13)
const BLSCRIM_COLS_LEFT  = { team: 62,  elim: 261, by: 343, pts: 416 };
const BLSCRIM_COLS_RIGHT = { team: 510, elim: 700, by: 785, pts: 864 };
const BLSCRIM_ROWS_Y = [663, 710, 750, 789, 826, 865]; // hạng 2-7 / 8-13

async function drawBluelockScrimTemplateImage(sortedTeams) {
  const img = await getBlScrimImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / BLSCRIM_BASE_W;
  const scaleY = height / BLSCRIM_BASE_H;
  ctx.textBaseline = "middle";

  function drawAt(x, y, str, { align = "center", color = "#ffffff", size = 15 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 16) text = text.slice(0, 15) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  // TOP 1
  const top1 = sortedTeams[0];
  if (top1) {
    drawAt(BLSCRIM_TOP1_NAME_X, BLSCRIM_TOP1_NAME_Y, top1.rep || "Unknown", { align: "left", size: 34 });
    drawAt(BLSCRIM_TOP1_ELIM_CX, BLSCRIM_TOP1_STATS_Y, String(top1.kill ?? 0), { align: "center", size: 26 });
    drawAt(BLSCRIM_TOP1_BY_CX,   BLSCRIM_TOP1_STATS_Y, String(top1.by ?? 0).padStart(2, "0"), { align: "center", size: 26 });
    drawAt(BLSCRIM_TOP1_PTS_CX,  BLSCRIM_TOP1_STATS_Y, String(top1.score ?? 0), { align: "center", size: 26 });
  }

  // Bảng trái: hạng 2-7 (index 1-6), Bảng phải: hạng 8-13 (index 7-12)
  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawAt(cols.team, y, squad.rep || "Unknown", { align: "left", size: 15 });
    drawAt(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 15 });
    drawAt(cols.by,   y, String(squad.by ?? 0).padStart(2, "0"), { align: "center", size: 15 });
    drawAt(cols.pts,  y, String(squad.score ?? 0), { align: "center", size: 15 });
  }

  BLSCRIM_ROWS_Y.forEach((y, i) => drawRow(BLSCRIM_COLS_LEFT, y, sortedTeams[i + 1]));
  BLSCRIM_ROWS_Y.forEach((y, i) => drawRow(BLSCRIM_COLS_RIGHT, y, sortedTeams[i + 7]));

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
  drawFreefireTemplateImage,
  drawFreefire2TemplateImage,
  drawHxhTemplateImage,
  drawMinecraftTemplateImage,
  drawKittyScrimTemplateImage,
  drawFreefireClassicTemplateImage,
  drawBluelockScrimTemplateImage,
};
