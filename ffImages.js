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

// ============================================================
// MẪU 13 — "OVERALL STANDING" (nền đen-vàng, 1 cột 12 dòng, không có
// ô #1 riêng). Toạ độ đo trên ảnh mẫu gốc 928x1134.
// ============================================================
const OVERALL_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "overall_standing_template.png");
let _overallImgCache = null;
async function getOverallImage() {
  if (!_overallImgCache) _overallImgCache = await loadTemplateImage(OVERALL_TEMPLATE_PATH, "Overall Standing");
  return _overallImgCache;
}

const OVERALL_BASE_W = 928;
const OVERALL_BASE_H = 1134;
const OVERALL_COLS = { team: 145, elim: 487, by: 570, pts: 650 };
const OVERALL_ROWS_Y = {
  1: 504, 2: 544, 3: 588, 4: 632.5, 5: 676.5, 6: 720.5,
  7: 765, 8: 809.5, 9: 853.5, 10: 897.5, 11: 942, 12: 986.5,
};

async function drawOverallStandingTemplateImage(sortedTeams) {
  const img = await getOverallImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / OVERALL_BASE_W;
  const scaleY = height / OVERALL_BASE_H;
  ctx.textBaseline = "middle";

  function drawText(x, y, str, { align = "center", color = "#ffffff", size = 24 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 16) text = text.slice(0, 15) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(OVERALL_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawText(OVERALL_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#ffffff", size: 24 });
    drawText(OVERALL_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#ffffff", size: 24 });
    drawText(OVERALL_COLS.by,   y, String(t.by ?? 0).padStart(2, "0"), { align: "center", color: "#ffffff", size: 24 });
    drawText(OVERALL_COLS.pts,  y, String(t.score ?? 0), { align: "center", color: "#ffdc3c", size: 24 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 14 — "BẢNG XẾP HẠNG" nền xanh-tối, ô xám sáng (chữ phải màu
// TỐI vì nền ô sáng — khác các mẫu còn lại). 2 cột đối xứng ngang
// (#1-6 trái / #7-12 phải, dùng chung Y). Toạ độ đo trên ảnh gốc
// 922x1152.
// ============================================================
const SIMPLEBXH_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "simple_bxh_template.png");
let _simpleBxhImgCache = null;
async function getSimpleBxhImage() {
  if (!_simpleBxhImgCache) _simpleBxhImgCache = await loadTemplateImage(SIMPLEBXH_TEMPLATE_PATH, "BXH Đơn Giản");
  return _simpleBxhImgCache;
}

const SIMPLEBXH_BASE_W = 922;
const SIMPLEBXH_BASE_H = 1152;
const SIMPLEBXH_COLS_LEFT  = { team: 90,  elim: 305, by: 357, pts: 412 };
const SIMPLEBXH_COLS_RIGHT = { team: 540, elim: 752, by: 809, pts: 872 };
// Y dùng chung cho cả 2 bảng (rank1/7 cùng hàng, rank2/8 cùng hàng...)
const SIMPLEBXH_ROWS_Y = [446, 517.5, 588, 658, 729, 800];

async function drawSimpleBxhTemplateImage(sortedTeams) {
  const img = await getSimpleBxhImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / SIMPLEBXH_BASE_W;
  const scaleY = height / SIMPLEBXH_BASE_H;
  ctx.textBaseline = "middle";

  // Chữ màu ĐEN vì nền ô là xám sáng (khác các mẫu khác dùng chữ trắng)
  function drawText(x, y, str, { align = "center", color = "#141414", size = 24 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 14) text = text.slice(0, 13) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawText(cols.team, y, squad.rep || "Unknown", { align: "left" });
    drawText(cols.elim, y, String(squad.kill ?? 0));
    drawText(cols.by,   y, String(squad.by ?? 0).padStart(2, "0"));
    drawText(cols.pts,  y, String(squad.score ?? 0));
  }

  SIMPLEBXH_ROWS_Y.forEach((y, i) => drawRow(SIMPLEBXH_COLS_LEFT, y, sortedTeams[i]));
  SIMPLEBXH_ROWS_Y.forEach((y, i) => drawRow(SIMPLEBXH_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 15 — "BẢNG XẾP HẠNG TỔNG" nền tím-xanh (Group Stage). 2 cột
// đối xứng ngang, cột TEAM khá hẹp (~130px) nên chữ nhỏ hơn + tên
// đội rút ngắn hơn các mẫu khác. Toạ độ đo trên ảnh mẫu gốc
// 1364x768.
// ============================================================
const BXHTONG_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "bxh_tong_template.png");
let _bxhTongImgCache = null;
async function getBxhTongImage() {
  if (!_bxhTongImgCache) _bxhTongImgCache = await loadTemplateImage(BXHTONG_TEMPLATE_PATH, "BXH Tổng");
  return _bxhTongImgCache;
}

const BXHTONG_BASE_W = 1364;
const BXHTONG_BASE_H = 768;
const BXHTONG_COLS_LEFT  = { team: 395, elim: 543, by: 599, pts: 648 };
const BXHTONG_COLS_RIGHT = { team: 754, elim: 902, by: 958, pts: 1007 };
const BXHTONG_ROWS_Y = [292, 351.5, 411, 471.5, 530.5, 590];

async function drawBxhTongTemplateImage(sortedTeams) {
  const img = await getBxhTongImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / BXHTONG_BASE_W;
  const scaleY = height / BXHTONG_BASE_H;
  ctx.textBaseline = "middle";

  function drawText(x, y, str, { align = "center", color = "#ffffff", size = 18 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    // Cột TEAM hẹp — cắt ngắn hơn các mẫu khác để không tràn cột ELIM
    if (align === "left" && text.length > 9) text = text.slice(0, 8) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawText(cols.team, y, squad.rep || "Unknown", { align: "left",  color: "#ffffff" });
    drawText(cols.elim, y, String(squad.kill ?? 0), { align: "center", color: "#ffffff" });
    drawText(cols.by,   y, String(squad.by ?? 0).padStart(2, "0"), { align: "center", color: "#ffffff" });
    drawText(cols.pts,  y, String(squad.score ?? 0), { align: "center", color: "#ffdc3c" });
  }

  BXHTONG_ROWS_Y.forEach((y, i) => drawRow(BXHTONG_COLS_LEFT, y, sortedTeams[i]));
  BXHTONG_ROWS_Y.forEach((y, i) => drawRow(BXHTONG_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 16 & 17 — "BẢNG XẾP HẠNG" nền tối, có ô #1 riêng (logo đội +
// ELIM/PTS nằm NGAY DƯỚI nhãn) + bảng 1 cột hạng 2-12. Mẫu 16 và 17
// dùng CHUNG 1 bộ toạ độ (2 ảnh nền có bố cục giống hệt nhau, chỉ khác
// nhân vật minh hoạ) — toạ độ đo trên ảnh gốc 1364x768.
// ⚠️ Cần copy 2 file ảnh gốc vào assets/templates/:
//   - kaito_dark_template.png  (mẫu 16)
//   - kaito_light_template.png (mẫu 17)
// ============================================================
const KAITO_BASE_W = 1364;
const KAITO_BASE_H = 768;

// Bảng chính hạng 2-12 (1 cột dọc bên phải)
const KAITO_COLS = { team: 640, elim: 895, by: 985, pts: 1057 };
const KAITO_ROWS_Y = {
  2: 204, 3: 247, 4: 290, 5: 332, 6: 374,
  7: 417, 8: 459, 9: 502, 10: 544, 11: 587, 12: 629,
};

// Ô #1 riêng (khung bên trái): tên đội cạnh chữ "TOP 1", số trận Booyah
// cạnh chữ "BOOYAH!" to, và ELIM/PTS nằm NGAY DƯỚI nhãn "ELIM"/"PTS".
const KAITO_TOP1 = {
  name: { x: 445, y: 435 },
  byCount: { x: 495, y: 530 },
  elim: { x: 330, y: 610 },
  pts: { x: 488, y: 610 },
};

function drawKaitoStyleRows(ctx, scaleX, scaleY, sortedTeams) {
  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 20 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 20) text = text.slice(0, 19) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(KAITO_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(KAITO_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#ffffff", size: 22 });
    drawCell(KAITO_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#ffffff", size: 20 });
    drawCell(KAITO_COLS.by,   y, String(t.by ?? 0),   { align: "center", color: "#ffffff", size: 20 });
    drawCell(KAITO_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color: "#ffd654", size: 20 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(KAITO_TOP1.name.x, KAITO_TOP1.name.y, top1.rep || "Unknown", { align: "center", color: "#ffffff", size: 26 });
    drawCell(KAITO_TOP1.byCount.x, KAITO_TOP1.byCount.y, `x${top1.by ?? 0}`, { align: "left", color: "#ffd654", size: 24 });
    drawCell(KAITO_TOP1.elim.x, KAITO_TOP1.elim.y, String(top1.kill ?? 0), { align: "center", color: "#ffffff", size: 30 });
    drawCell(KAITO_TOP1.pts.x, KAITO_TOP1.pts.y, String(top1.score ?? 0), { align: "center", color: "#ffd654", size: 30 });
  }
}

const KAITO_DARK_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "kaito_dark_template.png");
let _kaitoDarkImgCache = null;
async function getKaitoDarkImage() {
  if (!_kaitoDarkImgCache) _kaitoDarkImgCache = await loadTemplateImage(KAITO_DARK_TEMPLATE_PATH, "BXH Kaito (nền tối)");
  return _kaitoDarkImgCache;
}

async function drawKaitoDarkTemplateImage(sortedTeams) {
  const img = await getKaitoDarkImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = "middle";

  const scaleX = width / KAITO_BASE_W;
  const scaleY = height / KAITO_BASE_H;
  drawKaitoStyleRows(ctx, scaleX, scaleY, sortedTeams);

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

const KAITO_LIGHT_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "kaito_light_template.png");
let _kaitoLightImgCache = null;
async function getKaitoLightImage() {
  if (!_kaitoLightImgCache) _kaitoLightImgCache = await loadTemplateImage(KAITO_LIGHT_TEMPLATE_PATH, "BXH Kaito (nền sáng)");
  return _kaitoLightImgCache;
}

async function drawKaitoLightTemplateImage(sortedTeams) {
  const img = await getKaitoLightImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = "middle";

  const scaleX = width / KAITO_BASE_W;
  const scaleY = height / KAITO_BASE_H;
  drawKaitoStyleRows(ctx, scaleX, scaleY, sortedTeams);

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 18 — "BẢNG XẾP HẠNG TỔNG" nền đỏ Tết. Top 1-3 nằm trong khung
// trái (mỗi hạng 1 dòng: hạng 1 chữ TỐI vì nền vàng, hạng 2-3 chữ
// TRẮNG vì nền đỏ), hạng 4-12 nằm ở bảng phải (1 cột). Toạ độ đo trên
// ảnh mẫu gốc 1364x768.
// ⚠️ Cần copy file ảnh gốc "tet_bxhtong_template.png" vào assets/templates/.
// ============================================================
const TETBXH_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "tet_bxhtong_template.png");
let _tetBxhImgCache = null;
async function getTetBxhImage() {
  if (!_tetBxhImgCache) _tetBxhImgCache = await loadTemplateImage(TETBXH_TEMPLATE_PATH, "BXH Tổng Tết");
  return _tetBxhImgCache;
}

const TETBXH_BASE_W = 1364;
const TETBXH_BASE_H = 768;

// Top 1-3 (khung trái) — cùng cột X cho ELIM/BOOYAH/PTS ở cả 3 hạng,
// chỉ khác Y (từng hàng) và màu chữ (hạng 1 nền vàng → chữ tối).
const TETBXH_TOP3_COLS = { team: 230, elim: 460, by: 535, pts: 615 };
const TETBXH_TOP3_ROWS = {
  1: { y: 408, color: "#280505" }, // nền vàng → chữ tối
  2: { y: 475, color: "#ffffff" },
  3: { y: 542, color: "#ffffff" },
};

// Hạng 4-12 (bảng phải, 1 cột)
const TETBXH_MAIN_COLS = { team: 780, elim: 996, by: 1093, pts: 1190 };
const TETBXH_MAIN_ROWS_Y = {
  4: 214, 5: 262, 6: 310, 7: 358, 8: 406,
  9: 454, 10: 502, 11: 550, 12: 598,
};

async function drawTetBxhTongTemplateImage(sortedTeams) {
  const img = await getTetBxhImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / TETBXH_BASE_W;
  const scaleY = height / TETBXH_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 18 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 14) text = text.slice(0, 13) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(TETBXH_TOP3_ROWS).forEach(([rank, { y, color }]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(TETBXH_TOP3_COLS.team, y - 22, t.rep || "Unknown", { align: "left", color, size: 18 });
    drawCell(TETBXH_TOP3_COLS.elim, y, String(t.kill ?? 0), { align: "center", color, size: 16 });
    drawCell(TETBXH_TOP3_COLS.by,   y, String(t.by ?? 0),   { align: "center", color, size: 16 });
    drawCell(TETBXH_TOP3_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color, size: 16 });
  });

  Object.entries(TETBXH_MAIN_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(TETBXH_MAIN_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#ffffff", size: 16 });
    drawCell(TETBXH_MAIN_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#ffffff", size: 20 });
    drawCell(TETBXH_MAIN_COLS.by,   y, String(t.by ?? 0),   { align: "center", color: "#ffffff", size: 20 });
    drawCell(TETBXH_MAIN_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color: "#ffd654", size: 20 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 19 — "BẢNG XẾP HẠNG" phong cách One Piece. Ô #1 riêng (khung
// trái, chữ TRẮNG, ELIM/BOOYAH/PTS nằm dưới nhãn), hạng 2-12 nằm ở
// bảng phải (1 cột, chữ TỐI vì nền các dòng màu sáng/xám). Toạ độ đo
// trên ảnh mẫu gốc 1364x768.
// ⚠️ Cần copy file ảnh gốc "onepiece_bxh_template.png" vào assets/templates/.
// ============================================================
const ONEPIECE_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "onepiece_bxh_template.png");
let _onepieceImgCache = null;
async function getOnepieceImage() {
  if (!_onepieceImgCache) _onepieceImgCache = await loadTemplateImage(ONEPIECE_TEMPLATE_PATH, "BXH One Piece");
  return _onepieceImgCache;
}

const ONEPIECE_BASE_W = 1364;
const ONEPIECE_BASE_H = 768;

const ONEPIECE_MAIN_COLS = { team: 765, elim: 1134, by: 1217, pts: 1289 };
const ONEPIECE_MAIN_ROWS_Y = {
  2: 257, 3: 293, 4: 330, 5: 368, 6: 405,
  7: 442, 8: 478, 9: 516, 10: 553, 11: 590, 12: 627,
};
const ONEPIECE_TOP1 = { elim: { x: 290, y: 575 }, by: { x: 430, y: 575 }, pts: { x: 610, y: 575 } };

async function drawOnepieceTemplateImage(sortedTeams) {
  const img = await getOnepieceImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / ONEPIECE_BASE_W;
  const scaleY = height / ONEPIECE_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#191919", size = 18 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 20) text = text.slice(0, 19) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(ONEPIECE_MAIN_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(ONEPIECE_MAIN_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#191919", size: 18 });
    drawCell(ONEPIECE_MAIN_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#191919", size: 18 });
    drawCell(ONEPIECE_MAIN_COLS.by,   y, String(t.by ?? 0),   { align: "center", color: "#191919", size: 18 });
    drawCell(ONEPIECE_MAIN_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color: "#191919", size: 18 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(ONEPIECE_TOP1.elim.x, ONEPIECE_TOP1.elim.y, String(top1.kill ?? 0), { align: "center", color: "#ffffff", size: 20 });
    drawCell(ONEPIECE_TOP1.by.x,   ONEPIECE_TOP1.by.y,   String(top1.by ?? 0),   { align: "center", color: "#ffffff", size: 20 });
    drawCell(ONEPIECE_TOP1.pts.x,  ONEPIECE_TOP1.pts.y,  String(top1.score ?? 0),{ align: "center", color: "#ffffff", size: 20 });
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 20 — "BẢNG XẾP HẠNG" / "VÒNG BẢNG - FREE FIRE SRIM" (nền tím
// xanh, 1 cột dọc 12 dòng, KHÔNG có ô #1 riêng — hạng 1 nằm chung
// hàng đầu bảng như các hạng khác). Toạ độ đo trên ảnh mẫu gốc
// 922x1152.
// ⚠️ Cần copy file ảnh gốc "srim_bxh_template.png" vào assets/templates/.
// ============================================================
const SRIM_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "srim_bxh_template.png");
let _srimImgCache = null;
async function getSrimImage() {
  if (!_srimImgCache) _srimImgCache = await loadTemplateImage(SRIM_TEMPLATE_PATH, "BXH Free Fire Srim");
  return _srimImgCache;
}

const SRIM_BASE_W = 922;
const SRIM_BASE_H = 1152;
const SRIM_COLS = { team: 450, elim: 683, by: 765, pts: 857 };
const SRIM_ROWS_Y = {
  1: 413, 2: 465, 3: 517, 4: 569, 5: 621, 6: 673,
  7: 725, 8: 777, 9: 829, 10: 881, 11: 933, 12: 985,
};

async function drawSrimTemplateImage(sortedTeams) {
  const img = await getSrimImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / SRIM_BASE_W;
  const scaleY = height / SRIM_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 20 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 20) text = text.slice(0, 19) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(SRIM_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(SRIM_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#ffffff", size: 20 });
    drawCell(SRIM_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#ffffff", size: 20 });
    drawCell(SRIM_COLS.by,   y, String(t.by ?? 0),   { align: "center", color: "#ffffff", size: 20 });
    drawCell(SRIM_COLS.pts,  y, String(t.score ?? 0),{ align: "center", color: "#ffd654", size: 20 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 21 — "BẢNG XẾP HẠNG" One Piece (Zoro), CÓ ô #1 riêng + tên
// người chơi dưới khung logo + cả 3 cột ELIM/BOOYAH/PTS đều pad số 0
// ở đầu (VD "07", "00", "05") — khác mẫu 19 (không pad, không có tên
// người chơi). Toạ độ đo trực tiếp trên ảnh mẫu THỰC TẾ đã điền số
// (1920x1080), giữ nguyên hệ số đo gốc đó làm BASE để chính xác nhất.
// ⚠️ Cần copy file ảnh gốc "zoro_bxh_template.png" vào assets/templates/.
// ============================================================
const ZORO_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "zoro_bxh_template.png");
let _zoroImgCache = null;
async function getZoroImage() {
  if (!_zoroImgCache) _zoroImgCache = await loadTemplateImage(ZORO_TEMPLATE_PATH, "BXH One Piece Zoro");
  return _zoroImgCache;
}

const ZORO_BASE_W = 1920;
const ZORO_BASE_H = 1080;

const ZORO_MAIN_COLS = { team: 1080, elim: 1600, by: 1700, pts: 1810 };
const ZORO_MAIN_ROWS_Y = {
  2: 357, 3: 409, 4: 461, 5: 513, 6: 565,
  7: 617, 8: 669, 9: 721, 10: 773, 11: 825, 12: 877,
};
const ZORO_TOP1 = {
  elim: { x: 410, y: 820 },
  by:   { x: 610, y: 820 },
  pts:  { x: 880, y: 820 },
  playerName: { x: 110, y: 895 },
};

async function drawZoroTemplateImage(sortedTeams) {
  const img = await getZoroImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / ZORO_BASE_W;
  const scaleY = height / ZORO_BASE_H;
  ctx.textBaseline = "middle";

  // Pad số 0 ở đầu cho CẢ 3 cột — đã xác nhận trên ảnh mẫu thực tế
  // (VD "07", "00", "05"), khác mẫu 19 (không pad).
  const pad2 = (n) => String(n ?? 0).padStart(2, "0");

  function drawCell(x, y, str, { align = "center", color = "#191919", size = 24 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 20) text = text.slice(0, 19) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(ZORO_MAIN_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(ZORO_MAIN_COLS.team, y, t.rep || "Unknown", { align: "left",  color: "#191919", size: 26 });
    drawCell(ZORO_MAIN_COLS.elim, y, pad2(t.kill), { align: "center", color: "#191919", size: 26 });
    drawCell(ZORO_MAIN_COLS.by,   y, pad2(t.by),   { align: "center", color: "#191919", size: 26 });
    drawCell(ZORO_MAIN_COLS.pts,  y, pad2(t.score),{ align: "center", color: "#191919", size: 26 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(ZORO_TOP1.elim.x, ZORO_TOP1.elim.y, pad2(top1.kill), { align: "center", color: "#ffffff", size: 30 });
    drawCell(ZORO_TOP1.by.x,   ZORO_TOP1.by.y,   pad2(top1.by),   { align: "center", color: "#ffffff", size: 30 });
    drawCell(ZORO_TOP1.pts.x,  ZORO_TOP1.pts.y,  pad2(top1.score),{ align: "center", color: "#ffffff", size: 30 });
    drawCell(ZORO_TOP1.playerName.x, ZORO_TOP1.playerName.y, top1.rep || "Unknown", { align: "left", color: "#141414", size: 20 });
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}


// ============================================================
// MẪU 22 — "OVERALL STANDINGS" (nền tối, nhân vật hoạt hình mắt vàng,
// dây xích). 1 cột dọc 12 dòng liên tục (không có ô #1 riêng). Toạ độ
// đo trên ảnh mẫu gốc 928x1134.
// ⚠️ Cần copy file ảnh gốc "overall_standings_anime_template.png" vào
// assets/templates/.
// ============================================================
const OSANIME_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "overall_standings_anime_template.png");
let _osAnimeImgCache = null;
async function getOsAnimeImage() {
  if (!_osAnimeImgCache) _osAnimeImgCache = await loadTemplateImage(OSANIME_TEMPLATE_PATH, "Overall Standings Anime");
  return _osAnimeImgCache;
}

const OSANIME_BASE_W = 928;
const OSANIME_BASE_H = 1134;
const OSANIME_COLS = { team: 130, booyah: 520, elim: 568, pts: 615 };
const OSANIME_ROWS_Y = (() => {
  const start = 430, step = 46.3, out = {};
  for (let i = 1; i <= 12; i++) out[i] = start + (i - 1) * step;
  return out;
})();

async function drawOverallStandingsAnimeTemplateImage(sortedTeams) {
  const img = await getOsAnimeImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / OSANIME_BASE_W;
  const scaleY = height / OSANIME_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#1e160a", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(OSANIME_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(OSANIME_COLS.team, y, t.rep || "Unknown", { align: "left", size: 22 });
    drawCell(OSANIME_COLS.booyah, y, String(t.by ?? 0), { align: "center", size: 22 });
    drawCell(OSANIME_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 22 });
    drawCell(OSANIME_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 22 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 23 — "BẢNG XẾP HẠNG" nền tím-cam, mascot mèo robot. Ô #1 riêng
// (băng xanh lá dưới ảnh nhân vật, tên đội căn trái-trên) + bảng 1 cột
// hạng 2-12 bên phải. Toạ độ đo trên ảnh mẫu gốc 1364x768.
// ⚠️ Cần copy file ảnh gốc "purple_cat_bxh_template.png" vào assets/templates/.
// ============================================================
const PCAT_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "purple_cat_bxh_template.png");
let _pCatImgCache = null;
async function getPCatImage() {
  if (!_pCatImgCache) _pCatImgCache = await loadTemplateImage(PCAT_TEMPLATE_PATH, "BXH Mèo Tím");
  return _pCatImgCache;
}

const PCAT_BASE_W = 1364;
const PCAT_BASE_H = 768;
const PCAT_COLS = { team: 638, elim: 892, by: 985, pts: 1057 };
const PCAT_ROWS_Y = (() => {
  const start = 208, step = 44, out = {};
  for (let i = 2; i <= 12; i++) out[i] = start + (i - 2) * step;
  return out;
})();
const PCAT_TOP1 = { name: { x: 45, y: 445 }, elim: { x: 305, y: 635 }, pts: { x: 470, y: 635 } };

async function drawPurpleCatTemplateImage(sortedTeams) {
  const img = await getPCatImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / PCAT_BASE_W;
  const scaleY = height / PCAT_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(PCAT_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(PCAT_COLS.team, y, t.rep || "Unknown", { align: "left", size: 22 });
    drawCell(PCAT_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 24 });
    drawCell(PCAT_COLS.by, y, String(t.by ?? 0), { align: "center", size: 24 });
    drawCell(PCAT_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 24 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(PCAT_TOP1.name.x, PCAT_TOP1.name.y, top1.rep || "Unknown", { align: "left", size: 32 });
    drawCell(PCAT_TOP1.elim.x, PCAT_TOP1.elim.y, String(top1.kill ?? 0), { align: "center", size: 28 });
    drawCell(PCAT_TOP1.pts.x, PCAT_TOP1.pts.y, String(top1.score ?? 0), { align: "center", size: 28 });
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 24 — "BẢNG XẾP HẠNG" nền hồng, anime nữ. Ô #1 riêng (băng hồng
// dưới ảnh nhân vật) + bảng 1 cột hạng 2-12 bên phải. Toạ độ đo trên
// ảnh mẫu gốc 1364x768.
// ⚠️ Cần copy file ảnh gốc "pink_anime_bxh_template.png" vào assets/templates/.
// ============================================================
const PINKANIME_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "pink_anime_bxh_template.png");
let _pinkAnimeImgCache = null;
async function getPinkAnimeImage() {
  if (!_pinkAnimeImgCache) _pinkAnimeImgCache = await loadTemplateImage(PINKANIME_TEMPLATE_PATH, "BXH Hồng Anime");
  return _pinkAnimeImgCache;
}

const PINKANIME_BASE_W = 1364;
const PINKANIME_BASE_H = 768;
const PINKANIME_COLS = { team: 615, elim: 868, by: 945, pts: 1028 };
const PINKANIME_ROWS_Y = {
  2: 201, 3: 239, 4: 277, 5: 315, 6: 353,
  7: 391, 8: 429, 9: 467, 10: 505, 11: 543, 12: 581,
};
const PINKANIME_TOP1 = { name: { x: 55, y: 470 }, elim: { x: 305, y: 632 }, pts: { x: 470, y: 632 } };

async function drawPinkAnimeTemplateImage(sortedTeams) {
  const img = await getPinkAnimeImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / PINKANIME_BASE_W;
  const scaleY = height / PINKANIME_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(PINKANIME_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(PINKANIME_COLS.team, y, t.rep || "Unknown", { align: "left", size: 22 });
    drawCell(PINKANIME_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 24 });
    drawCell(PINKANIME_COLS.by, y, String(t.by ?? 0), { align: "center", size: 24 });
    drawCell(PINKANIME_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 24 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(PINKANIME_TOP1.name.x, PINKANIME_TOP1.name.y, top1.rep || "Unknown", { align: "left", size: 32 });
    drawCell(PINKANIME_TOP1.elim.x, PINKANIME_TOP1.elim.y, String(top1.kill ?? 0), { align: "center", size: 30 });
    drawCell(PINKANIME_TOP1.pts.x, PINKANIME_TOP1.pts.y, String(top1.score ?? 0), { align: "center", size: 30 });
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 25 — "OVERALL STANDING" nền đỏ-đen, lính Free Fire. 1 cột dọc 12
// dòng liên tục (không có ô #1 riêng). Toạ độ đo trên ảnh mẫu gốc
// 928x1134.
// ⚠️ Cần copy file ảnh gốc "overall_standing_red_template.png" vào
// assets/templates/.
// ============================================================
const OSRED_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "overall_standing_red_template.png");
let _osRedImgCache = null;
async function getOsRedImage() {
  if (!_osRedImgCache) _osRedImgCache = await loadTemplateImage(OSRED_TEMPLATE_PATH, "Overall Standing Đỏ");
  return _osRedImgCache;
}

const OSRED_BASE_W = 928;
const OSRED_BASE_H = 1134;
const OSRED_COLS = { team: 140, elim: 487, by: 578, pts: 655 };
const OSRED_ROWS_Y = {
  1: 507, 2: 552, 3: 596, 4: 640, 5: 684, 6: 728,
  7: 772, 8: 816, 9: 860, 10: 905, 11: 950, 12: 994,
};

async function drawOverallStandingRedTemplateImage(sortedTeams) {
  const img = await getOsRedImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / OSRED_BASE_W;
  const scaleY = height / OSRED_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(OSRED_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(OSRED_COLS.team, y, t.rep || "Unknown", { align: "left", size: 22 });
    drawCell(OSRED_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 22 });
    drawCell(OSRED_COLS.by, y, String(t.by ?? 0), { align: "center", size: 22 });
    drawCell(OSRED_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 22 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 26 — "BẢNG XẾP HẠNG" nền xanh cyber, mascot mèo robot. 2 bảng
// đối xứng ngang: trái RANK 1-6 / phải RANK 7-12, chữ TỐI vì nền các
// dòng màu sáng. Toạ độ đo trên ảnh mẫu gốc 922x1152.
// ⚠️ Cần copy file ảnh gốc "cyber_cat_bxh_template.png" vào assets/templates/.
// ============================================================
const CYBERCAT_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "cyber_cat_bxh_template.png");
let _cyberCatImgCache = null;
async function getCyberCatImage() {
  if (!_cyberCatImgCache) _cyberCatImgCache = await loadTemplateImage(CYBERCAT_TEMPLATE_PATH, "BXH Mèo Cyber");
  return _cyberCatImgCache;
}

const CYBERCAT_BASE_W = 922;
const CYBERCAT_BASE_H = 1152;
const CYBERCAT_COLS_LEFT = { team: 90, elim: 317, by: 368, pts: 423 };
const CYBERCAT_COLS_RIGHT = { team: 537, elim: 766, by: 815, pts: 871 };
const CYBERCAT_ROWS_Y = [413, 482, 554, 624, 694, 765];

async function drawCyberCatTemplateImage(sortedTeams) {
  const img = await getCyberCatImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / CYBERCAT_BASE_W;
  const scaleY = height / CYBERCAT_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#1e1e23", size = 17 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 16) text = text.slice(0, 15) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", size: 17 });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 24 });
    drawCell(cols.by, y, String(squad.by ?? 0), { align: "center", size: 24 });
    drawCell(cols.pts, y, String(squad.score ?? 0), { align: "center", size: 24 });
  }

  CYBERCAT_ROWS_Y.forEach((y, i) => drawRow(CYBERCAT_COLS_LEFT, y, sortedTeams[i]));
  CYBERCAT_ROWS_Y.forEach((y, i) => drawRow(CYBERCAT_COLS_RIGHT, y, sortedTeams[i + 6]));

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 27 & 28 — "BẢNG XẾP HẠNG" Jujutsu Kaisen / Dragon Ball. 2 mẫu
// dùng CHUNG bố cục (ô #1 riêng bên trái + bảng 1 cột hạng 2-12 bên
// phải), chỉ khác ảnh nền nhân vật minh hoạ. Toạ độ đo trên ảnh mẫu
// gốc 1364x768.
// ⚠️ Cần copy 2 file ảnh gốc vào assets/templates/:
//   - jjk_bxh_template.jpg        (mẫu 27)
//   - dragonball_bxh_template.png (mẫu 28)
// ============================================================
const ANIMEV2_BASE_W = 1364;
const ANIMEV2_BASE_H = 768;
const ANIMEV2_COLS = { team: 635, elim: 895, by: 985, pts: 1057 };
const ANIMEV2_ROWS_Y = {
  2: 207, 3: 249, 4: 291, 5: 334, 6: 376,
  7: 419, 8: 462, 9: 505, 10: 547, 11: 590, 12: 632,
};
// Ô #1: tên đội cạnh chữ "TOP 1", ELIM/PTS trong khung chalkboard, và
// (chỉ mẫu Dragon Ball) số Booyah cạnh chữ "BOOYAH!" to.
const ANIMEV2_TOP1 = {
  name: { x: 410, y: 430 },
  elim: { x: 330, y: 615 },
  pts: { x: 495, y: 615 },
  by: { x: 535, y: 532 },
};

function drawAnimeV2StyleRows(ctx, scaleX, scaleY, sortedTeams, { drawTop1By = false } = {}) {
  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(ANIMEV2_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(ANIMEV2_COLS.team, y, t.rep || "Unknown", { align: "left", size: 22 });
    drawCell(ANIMEV2_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 24 });
    drawCell(ANIMEV2_COLS.by, y, String(t.by ?? 0), { align: "center", size: 24 });
    drawCell(ANIMEV2_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 24 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(ANIMEV2_TOP1.name.x, ANIMEV2_TOP1.name.y, top1.rep || "Unknown", { align: "center", size: 30 });
    drawCell(ANIMEV2_TOP1.elim.x, ANIMEV2_TOP1.elim.y, String(top1.kill ?? 0), { align: "center", size: 30 });
    drawCell(ANIMEV2_TOP1.pts.x, ANIMEV2_TOP1.pts.y, String(top1.score ?? 0), { align: "center", size: 30 });
    if (drawTop1By) {
      drawCell(ANIMEV2_TOP1.by.x, ANIMEV2_TOP1.by.y, String(top1.by ?? 0), { align: "center", size: 36 });
    }
  }
}

const JJK_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "jjk_bxh_template.jpg");
let _jjkImgCache = null;
async function getJjkImage() {
  if (!_jjkImgCache) _jjkImgCache = await loadTemplateImage(JJK_TEMPLATE_PATH, "BXH Jujutsu Kaisen");
  return _jjkImgCache;
}

async function drawJjkTemplateImage(sortedTeams) {
  const img = await getJjkImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = "middle";

  const scaleX = width / ANIMEV2_BASE_W;
  const scaleY = height / ANIMEV2_BASE_H;
  drawAnimeV2StyleRows(ctx, scaleX, scaleY, sortedTeams, { drawTop1By: false });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

const DRAGONBALL_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "dragonball_bxh_template.png");
let _dragonballImgCache = null;
async function getDragonballImage() {
  if (!_dragonballImgCache) _dragonballImgCache = await loadTemplateImage(DRAGONBALL_TEMPLATE_PATH, "BXH Dragon Ball");
  return _dragonballImgCache;
}

async function drawDragonballTemplateImage(sortedTeams) {
  const img = await getDragonballImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = "middle";

  const scaleX = width / ANIMEV2_BASE_W;
  const scaleY = height / ANIMEV2_BASE_H;
  drawAnimeV2StyleRows(ctx, scaleX, scaleY, sortedTeams, { drawTop1By: true });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 29 & 31 — "BẢNG XẾP HẠNG" Lính Việt Nam / Demon Slayer. 2 mẫu
// dùng CHUNG bố cục (ô #1 riêng dạng thanh chéo màu đỏ + bảng 1 cột
// hạng 2-12 nằm chồng lên các dải chéo). Mẫu Demon Slayer CÓ thêm tên
// đội #1 (mẫu lính KHÔNG có ô tên đội #1 riêng biệt). Toạ độ đo trên
// ảnh mẫu gốc 1364x768.
// ⚠️ Cần copy 2 file ảnh gốc vào assets/templates/:
//   - soldier_bxh_template.png      (mẫu 29)
//   - demonslayer_bxh_template.png  (mẫu 31)
// ============================================================
const SOLDIERV2_BASE_W = 1364;
const SOLDIERV2_BASE_H = 768;
const SOLDIERV2_COLS = { team: 840, elim: 1132, by: 1218, pts: 1290 };
const SOLDIERV2_ROWS_Y = {
  2: 256, 3: 293, 4: 330, 5: 367, 6: 404,
  7: 441, 8: 478, 9: 515, 10: 552, 11: 589, 12: 626,
};
const SOLDIERV2_TOP1 = { elim: { x: 293, y: 595 }, by: { x: 453, y: 595 }, pts: { x: 618, y: 595 }, name: { x: 165, y: 460 } };

function drawSoldierV2StyleRows(ctx, scaleX, scaleY, sortedTeams, { drawTop1Name = false, textColor = "#1e0a05" } = {}) {
  function drawCell(x, y, str, { align = "center", color = textColor, size = 20 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(SOLDIERV2_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(SOLDIERV2_COLS.team, y, t.rep || "Unknown", { align: "left", size: 20 });
    drawCell(SOLDIERV2_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 24 });
    drawCell(SOLDIERV2_COLS.by, y, String(t.by ?? 0), { align: "center", size: 24 });
    drawCell(SOLDIERV2_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 24 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(SOLDIERV2_TOP1.elim.x, SOLDIERV2_TOP1.elim.y, String(top1.kill ?? 0), { align: "center", color: "#ffffff", size: 30 });
    drawCell(SOLDIERV2_TOP1.by.x, SOLDIERV2_TOP1.by.y, String(top1.by ?? 0), { align: "center", color: "#ffffff", size: 30 });
    drawCell(SOLDIERV2_TOP1.pts.x, SOLDIERV2_TOP1.pts.y, String(top1.score ?? 0), { align: "center", color: "#ffffff", size: 30 });
    if (drawTop1Name) {
      drawCell(SOLDIERV2_TOP1.name.x, SOLDIERV2_TOP1.name.y, top1.rep || "Unknown", { align: "left", color: "#ffffff", size: 28 });
    }
  }
}

const SOLDIER_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "soldier_bxh_template.png");
let _soldierImgCache = null;
async function getSoldierImage() {
  if (!_soldierImgCache) _soldierImgCache = await loadTemplateImage(SOLDIER_TEMPLATE_PATH, "BXH Lính Việt Nam");
  return _soldierImgCache;
}

async function drawSoldierTemplateImage(sortedTeams) {
  const img = await getSoldierImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = "middle";

  const scaleX = width / SOLDIERV2_BASE_W;
  const scaleY = height / SOLDIERV2_BASE_H;
  drawSoldierV2StyleRows(ctx, scaleX, scaleY, sortedTeams, { drawTop1Name: false });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

const DEMONSLAYER_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "demonslayer_bxh_template.png");
let _demonslayerImgCache = null;
async function getDemonslayerImage() {
  if (!_demonslayerImgCache) _demonslayerImgCache = await loadTemplateImage(DEMONSLAYER_TEMPLATE_PATH, "BXH Demon Slayer");
  return _demonslayerImgCache;
}

async function drawDemonslayerTemplateImage(sortedTeams) {
  const img = await getDemonslayerImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  ctx.textBaseline = "middle";

  const scaleX = width / SOLDIERV2_BASE_W;
  const scaleY = height / SOLDIERV2_BASE_H;
  drawSoldierV2StyleRows(ctx, scaleX, scaleY, sortedTeams, { drawTop1Name: true });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 30 — "BẢNG XẾP HẠNG TỔNG" nền xanh, nhân vật anime tóc nâu. Ô #1
// riêng chỉ có tên đội (không có ô ELIM/BOOYAH/PTS riêng cho #1 trong
// mẫu này) + bảng 1 cột hạng 2-12. Toạ độ đo trên ảnh mẫu gốc
// 1364x768.
// ⚠️ Cần copy file ảnh gốc "anime_blue_bxhtong_template.png" vào
// assets/templates/.
// ============================================================
const ANIMEBLUE_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "anime_blue_bxhtong_template.png");
let _animeBlueImgCache = null;
async function getAnimeBlueImage() {
  if (!_animeBlueImgCache) _animeBlueImgCache = await loadTemplateImage(ANIMEBLUE_TEMPLATE_PATH, "BXH Tổng Anime Xanh");
  return _animeBlueImgCache;
}

const ANIMEBLUE_BASE_W = 1364;
const ANIMEBLUE_BASE_H = 768;
const ANIMEBLUE_COLS = { team: 615, elim: 972, by: 1057, pts: 1128 };
const ANIMEBLUE_ROWS_Y = {
  2: 255, 3: 290, 4: 326, 5: 362, 6: 398,
  7: 434, 8: 470, 9: 507, 10: 543, 11: 579, 12: 615,
};
const ANIMEBLUE_TOP1_NAME = { x: 110, y: 460 };

async function drawAnimeBlueBxhTongTemplateImage(sortedTeams) {
  const img = await getAnimeBlueImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / ANIMEBLUE_BASE_W;
  const scaleY = height / ANIMEBLUE_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 20 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(ANIMEBLUE_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(ANIMEBLUE_COLS.team, y, t.rep || "Unknown", { align: "left", size: 20 });
    drawCell(ANIMEBLUE_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 22 });
    drawCell(ANIMEBLUE_COLS.by, y, String(t.by ?? 0), { align: "center", size: 22 });
    drawCell(ANIMEBLUE_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 22 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    drawCell(ANIMEBLUE_TOP1_NAME.x, ANIMEBLUE_TOP1_NAME.y, top1.rep || "Unknown", { align: "left", size: 26 });
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 32 — "FREE FIRE SCRIM" nền vàng-đen, mascot robot chó. 1 cột dọc
// 12 dòng liên tục (rank1 nằm chung hàng đầu, không có ô riêng), chữ
// TRẮNG cho tên đội/tổng điểm, chữ TỐI cho Booyah/Elims (do nền đổi
// màu xen kẽ theo cột). Toạ độ đo trên ảnh mẫu gốc 1024x1024.
// ⚠️ Cần copy file ảnh gốc "ff_scrim_yellow_template.png" vào
// assets/templates/.
// ============================================================
const FFSCRIM_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "ff_scrim_yellow_template.png");
let _ffScrimImgCache = null;
async function getFfScrimImage() {
  if (!_ffScrimImgCache) _ffScrimImgCache = await loadTemplateImage(FFSCRIM_TEMPLATE_PATH, "BXH Free Fire Scrim Vàng");
  return _ffScrimImgCache;
}

const FFSCRIM_BASE_W = 1024;
const FFSCRIM_BASE_H = 1024;
const FFSCRIM_COLS = { team: 430, by: 858, pts: 918, elim: 985 };
const FFSCRIM_ROWS_Y = {
  1: 229, 2: 284, 3: 338, 4: 393, 5: 447, 6: 502,
  7: 556, 8: 611, 9: 665, 10: 720, 11: 774, 12: 829,
};

async function drawFfScrimYellowTemplateImage(sortedTeams) {
  const img = await getFfScrimImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / FFSCRIM_BASE_W;
  const scaleY = height / FFSCRIM_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 20 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(FFSCRIM_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(FFSCRIM_COLS.team, y, t.rep || "Unknown", { align: "left", color: "#ffffff", size: 20 });
    drawCell(FFSCRIM_COLS.by, y, String(t.by ?? 0), { align: "center", color: "#141414", size: 20 });
    drawCell(FFSCRIM_COLS.pts, y, String(t.score ?? 0), { align: "center", color: "#ffffff", size: 20 });
    drawCell(FFSCRIM_COLS.elim, y, String(t.kill ?? 0), { align: "center", color: "#141414", size: 20 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 33 — "OVERALL STANDINGS" nền neon tím-hồng-xanh, khổ dọc. 1 cột
// dọc 12 dòng liên tục. Toạ độ đo trên ảnh mẫu gốc 1024x1536.
// ⚠️ Cần copy file ảnh gốc "neon_overall_standings_template.png" vào
// assets/templates/.
// ============================================================
const NEONOS_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "neon_overall_standings_template.png");
let _neonOsImgCache = null;
async function getNeonOsImage() {
  if (!_neonOsImgCache) _neonOsImgCache = await loadTemplateImage(NEONOS_TEMPLATE_PATH, "Overall Standings Neon");
  return _neonOsImgCache;
}

const NEONOS_BASE_W = 1024;
const NEONOS_BASE_H = 1536;
const NEONOS_COLS = { team: 250, by: 650, elim: 790, pts: 915 };
const NEONOS_ROWS_Y = {
  1: 614, 2: 675, 3: 736, 4: 797, 5: 858, 6: 921,
  7: 984, 8: 1047, 9: 1109, 10: 1172, 11: 1234, 12: 1296,
};

async function drawNeonOverallStandingsTemplateImage(sortedTeams) {
  const img = await getNeonOsImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / NEONOS_BASE_W;
  const scaleY = height / NEONOS_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 26 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  Object.entries(NEONOS_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(NEONOS_COLS.team, y, t.rep || "Unknown", { align: "left", size: 26 });
    drawCell(NEONOS_COLS.by, y, String(t.by ?? 0), { align: "center", size: 26 });
    drawCell(NEONOS_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 26 });
    drawCell(NEONOS_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 26 });
  });

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 34 — "BẢNG XẾP HẠNG" nền xanh lá, khổ ngang rộng (1672x940). Ô
// #1 có khung banner riêng chứa PLACEHOLDER chữ "TEAM NAME" cần XOÁ
// (tô đè màu nền tối trước khi vẽ tên thật) + số Booyah cạnh logo lớn
// + bảng chính 1 cột hạng 1-12 (rank1 CŨNG xuất hiện trong bảng
// chính, tách biệt với ô #1 phía trên). Toạ độ đo trên ảnh mẫu gốc
// 1672x940.
// ⚠️ Cần copy file ảnh gốc "green_bxh_template.png" vào assets/templates/.
// ============================================================
const GREENBXH_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "green_bxh_template.png");
let _greenBxhImgCache = null;
async function getGreenBxhImage() {
  if (!_greenBxhImgCache) _greenBxhImgCache = await loadTemplateImage(GREENBXH_TEMPLATE_PATH, "BXH Xanh Lá");
  return _greenBxhImgCache;
}

const GREENBXH_BASE_W = 1672;
const GREENBXH_BASE_H = 940;
const GREENBXH_MAIN_COLS = { team: 790, by: 1108, elim: 1192, pts: 1265 };
const GREENBXH_MAIN_ROWS_Y = {
  1: 305, 2: 358, 3: 411, 4: 465, 5: 518, 6: 572,
  7: 625, 8: 676, 9: 727, 10: 776, 11: 824, 12: 872,
};
// Vùng chữ "TEAM NAME" placeholder cần xoá (banner teal dưới ảnh nhân
// vật) — toạ độ hình chữ nhật [x1,y1,x2,y2] để tô đè trước khi vẽ tên
// thật đè lên.
const GREENBXH_NAME_ERASE_RECT = [62, 598, 448, 665];
const GREENBXH_ERASE_COLOR = "#021009"; // màu nền teal-đen của banner gốc, dùng để "xoá" placeholder/dash
const GREENBXH_TOP1_NAME = { x: 80, y: 631 };
// 3 ô số bị dấu "—" (dash rỗng) đè lên phía dưới nhãn KILL/ELIM/PTS —
// cần xoá dash trước khi vẽ số thật.
const GREENBXH_TOP1_STATS = {
  kill: { eraseRect: [260, 828, 340, 848], x: 290, y: 845 },
  elim: { eraseRect: [390, 828, 460, 848], x: 420, y: 845 },
  pts: { eraseRect: [535, 815, 625, 848], x: 580, y: 845 },
};

async function drawGreenBxhTemplateImage(sortedTeams) {
  const img = await getGreenBxhImage();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / GREENBXH_BASE_W;
  const scaleY = height / GREENBXH_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 22 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 18) text = text.slice(0, 17) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  function eraseRect([x1, y1, x2, y2]) {
    ctx.fillStyle = GREENBXH_ERASE_COLOR;
    ctx.fillRect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY);
  }

  Object.entries(GREENBXH_MAIN_ROWS_Y).forEach(([rank, y]) => {
    const t = sortedTeams[parseInt(rank) - 1];
    if (!t) return;
    drawCell(GREENBXH_MAIN_COLS.team, y, t.rep || "Unknown", { align: "left", size: 22 });
    drawCell(GREENBXH_MAIN_COLS.by, y, String(t.by ?? 0), { align: "center", size: 24 });
    drawCell(GREENBXH_MAIN_COLS.elim, y, String(t.kill ?? 0), { align: "center", size: 24 });
    drawCell(GREENBXH_MAIN_COLS.pts, y, String(t.score ?? 0), { align: "center", size: 24 });
  });

  const top1 = sortedTeams[0];
  if (top1) {
    // Xoá placeholder "TEAM NAME" rồi vẽ tên đội thật lên đúng chỗ.
    eraseRect(GREENBXH_NAME_ERASE_RECT);
    drawCell(GREENBXH_TOP1_NAME.x, GREENBXH_TOP1_NAME.y, top1.rep || "Unknown", { align: "left", size: 40, color: "#f5faf5" });

    // Xoá dấu "—" rồi vẽ số thật cho KILL / ELIM / PTS của đội #1.
    eraseRect(GREENBXH_TOP1_STATS.kill.eraseRect);
    drawCell(GREENBXH_TOP1_STATS.kill.x, GREENBXH_TOP1_STATS.kill.y, String(top1.kill ?? 0), { align: "center", size: 30 });
    eraseRect(GREENBXH_TOP1_STATS.elim.eraseRect);
    drawCell(GREENBXH_TOP1_STATS.elim.x, GREENBXH_TOP1_STATS.elim.y, String(top1.by ?? 0), { align: "center", size: 30 });
    eraseRect(GREENBXH_TOP1_STATS.pts.eraseRect);
    drawCell(GREENBXH_TOP1_STATS.pts.x, GREENBXH_TOP1_STATS.pts.y, String(top1.score ?? 0), { align: "center", size: 30 });
  }

  const _buf = canvas.toBuffer("image/png");
  console.log("Canvas buffer size:", _buf.length, "bytes");
  return _buf;
}

// ============================================================
// MẪU 35 — "BẢNG XẾP HẠNG" One Piece, khổ dọc (1024x1536). 2 bảng đối
// xứng ngang trái RANK 1-6 / phải RANK 7-12 (không có ô #1 riêng —
// hạng 1 nằm ngay hàng đầu bảng trái). Toạ độ đo trên ảnh mẫu gốc
// 1024x1536.
// ⚠️ Cần copy file ảnh gốc "onepiece2_bxh_template.png" vào
// assets/templates/.
// ============================================================
const ONEPIECE2_TEMPLATE_PATH = path.join(__dirname, "assets", "templates", "onepiece2_bxh_template.png");
let _onepiece2ImgCache = null;
async function getOnepiece2Image() {
  if (!_onepiece2ImgCache) _onepiece2ImgCache = await loadTemplateImage(ONEPIECE2_TEMPLATE_PATH, "BXH One Piece 2 Cột");
  return _onepiece2ImgCache;
}

const ONEPIECE2_BASE_W = 1024;
const ONEPIECE2_BASE_H = 1536;
const ONEPIECE2_COLS_LEFT = { team: 110, elim: 305, by: 370, pts: 440 };
const ONEPIECE2_COLS_RIGHT = { team: 625, elim: 820, by: 885, pts: 955 };
const ONEPIECE2_ROWS_Y = [683, 737, 791, 845, 898, 952];

async function drawOnepiece2TemplateImage(sortedTeams) {
  const img = await getOnepiece2Image();
  const width = img.width;
  const height = img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const scaleX = width / ONEPIECE2_BASE_W;
  const scaleY = height / ONEPIECE2_BASE_H;
  ctx.textBaseline = "middle";

  function drawCell(x, y, str, { align = "center", color = "#ffffff", size = 15 } = {}) {
    ctx.font = `bold ${Math.round(size * scaleY)}px AppFont`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let text = str;
    if (align === "left" && text.length > 16) text = text.slice(0, 15) + "…";
    ctx.fillText(text, x * scaleX, y * scaleY);
  }

  function drawRow(cols, y, squad) {
    if (!squad) return;
    drawCell(cols.team, y, squad.rep || "Unknown", { align: "left", size: 15 });
    drawCell(cols.elim, y, String(squad.kill ?? 0), { align: "center", size: 18 });
    drawCell(cols.by, y, String(squad.by ?? 0), { align: "center", size: 18 });
    drawCell(cols.pts, y, String(squad.score ?? 0), { align: "center", size: 18 });
  }

  ONEPIECE2_ROWS_Y.forEach((y, i) => drawRow(ONEPIECE2_COLS_LEFT, y, sortedTeams[i]));
  ONEPIECE2_ROWS_Y.forEach((y, i) => drawRow(ONEPIECE2_COLS_RIGHT, y, sortedTeams[i + 6]));

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
  drawOverallStandingTemplateImage,
  drawSimpleBxhTemplateImage,
  drawBxhTongTemplateImage,
  drawKaitoDarkTemplateImage,
  drawKaitoLightTemplateImage,
  drawTetBxhTongTemplateImage,
  drawOnepieceTemplateImage,
  drawSrimTemplateImage,
  drawZoroTemplateImage,
  drawOverallStandingsAnimeTemplateImage,
  drawPurpleCatTemplateImage,
  drawPinkAnimeTemplateImage,
  drawOverallStandingRedTemplateImage,
  drawCyberCatTemplateImage,
  drawJjkTemplateImage,
  drawDragonballTemplateImage,
  drawSoldierTemplateImage,
  drawAnimeBlueBxhTongTemplateImage,
  drawDemonslayerTemplateImage,
  drawFfScrimYellowTemplateImage,
  drawNeonOverallStandingsTemplateImage,
  drawGreenBxhTemplateImage,
  drawOnepiece2TemplateImage,
};
