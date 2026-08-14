const axios = require("axios");

const GARENA_COOKIE = process.env.GARENA_COOKIE || "";

const HEADERS = {
  "Cookie": GARENA_COOKIE,
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://congdong.ff.garena.vn/tinh-diem",
  "Origin": "https://congdong.ff.garena.vn",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

const KHUNG_GIO = {
  1: { label: "13h - 15h",     start: "13:00", end: "15:00" },
  2: { label: "15h - 17h",     start: "15:00", end: "17:00" },
  3: { label: "18h - 20h",     start: "18:00", end: "20:00" },
  4: { label: "20h - 21h50",   start: "20:00", end: "21:50" },
  5: { label: "21h40 - 23h30", start: "21:40", end: "23:30" },
  6: { label: "23h30 - 1h30",  start: "23:30", end: "01:30" },
  7: { label: "1h - 3h",       start: "01:00", end: "03:00" },
  8: { label: "10h - 12h",     start: "10:00", end: "12:00" },
};

// Cú pháp "xoaN" đi kèm ID để loại bỏ trận thứ N ra khỏi danh sách trước khi tính điểm.
const XOA_REGEX = /^xoa(\d+)$/i;

async function findMatches(accountId, startTime, endTime) {
  const res = await axios.post(
    "https://congdong.ff.garena.vn/league-score-api/player/find-match",
    { accountId: String(accountId), startTime, endTime },
    { headers: HEADERS, timeout: 15000 }
  );
  return res.data?.matches || [];
}

async function getMatchDetail(matchId) {
  const res = await axios.post(
    "https://congdong.ff.garena.vn/league-score-api/match",
    { matchId: String(matchId) },
    { headers: HEADERS, timeout: 10000 }
  );
  return res.data?.match || null;
}

// Tìm player trong trận — ID bị che 2 số cuối: "70122364**" → so với "7012236439"
function findPlayer(match, accountId) {
  const accStr = String(accountId);
  for (const team of (match?.ranks || [])) {
    const idx = team.playerAccountIds.findIndex(pid => {
      const clean = pid.replace(/\*+$/, "");
      return accStr.startsWith(clean);
    });
    if (idx !== -1) {
      const playerScore  = Array.isArray(team.playerScores)  ? (team.playerScores[idx]  ?? team.score)  : team.score;
      const playerKill   = Array.isArray(team.playerKills)   ? (team.playerKills[idx]   ?? team.kill)   : team.kill;
      const playerBooyah = Array.isArray(team.playerBooyahs) ? (team.playerBooyahs[idx] ?? team.booyah) : team.booyah;
      return {
        rank:   team.rank,
        booyah: playerBooyah,
        kill:   playerKill,
        score:  playerScore,
        name:   team.accountNames[idx] || null,
      };
    }
  }
  return null;
}

function toTimestamp(dateStr, timeStr) {
  const [d, m, y] = dateStr.split("/");
  const [h, min] = timeStr.split(":");
  return Math.floor(new Date(`${y}-${m}-${d}T${h.padStart(2,"0")}:${min}:00+07:00`).getTime() / 1000);
}

function todayVN() {
  const vn = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return `${String(vn.getDate()).padStart(2,"0")}/${String(vn.getMonth()+1).padStart(2,"0")}/${vn.getFullYear()}`;
}

module.exports = {
  KHUNG_GIO, XOA_REGEX,
  findMatches, getMatchDetail, findPlayer,
  toTimestamp, todayVN,
};
