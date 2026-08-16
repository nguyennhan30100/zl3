// ============================================================
// LOGIC "VÔ ĐỊCH" (CPR)
//
// Luật (đúng theo mô tả gốc):
//   .td [ID] cprN  → N là số điểm KÍCH HOẠT.
//   - Xét tối đa 5 trận đầu tiên (theo thời gian, cũ → mới).
//   - Một đội "đã kích hoạt" khi tổng điểm cộng dồn của đội đó
//     (tính đến HẾT một trận) đạt ≥ N điểm.
//   - Đội ĐÃ KÍCH HOẠT (từ (các) trận trước) mà TRẬN SAU (bất kỳ
//     trận nào tiếp theo) giành TOP 1 (booyah) → đội đó VÔ ĐỊCH
//     ngay lập tức, dừng xét các trận còn lại.
//   - Điểm của chính trận top1 đang xét KHÔNG được cộng vào TRƯỚC
//     khi check kích hoạt của trận đó — nghĩa là nếu đội chỉ vừa
//     đủ N điểm NHỜ điểm của chính trận top1 này thì CHƯA được
//     tính vô địch ở trận này (phải đợi lần top1 kế tiếp).
//   - Hết 5 trận mà không ai thoả → không có đội vô địch, bảng
//     xếp hạng chỉ sắp theo tổng điểm giảm dần như bình thường.
//
// FIX quan trọng: API có thể trả rank/score/booyah/kill dạng
// CHUỖI ("1", "20"...) thay vì số. Nếu so sánh rank === 1 (strict)
// hoặc cộng dồn bằng += mà không ép kiểu Number() thì:
//   - rank === 1 sẽ KHÔNG BAO GIỜ đúng nếu rank là "1" (chuỗi)
//     → không đội nào được nhận vô địch dù đã đủ điều kiện.
//   - "0" + "20" = "020" (nối chuỗi, không phải cộng số) → điểm
//     tích lũy sai.
// → Toàn bộ số liệu đọc từ match đều được ép Number(...) trước khi
//   dùng, để tránh 2 lỗi trên.
// ============================================================
function computeChampionBoard(matchesOrdered, threshold = 50) {
  const N = Number(threshold) || 50;
  const MAX_MATCHES = 5;
  const limited = matchesOrdered.slice(0, MAX_MATCHES);

  const teamTotals = {};       // key(cleanIds joined) -> { rep, by, kill, score, cleanIds }
  const cprActivated = new Set(); // key của các đội đã đạt ≥N điểm (đã kích hoạt)
  let championKey = null;

  for (const match of limited) {
    if (championKey) break; // đã có đội vô địch ở trận trước, dừng hẳn

    const ranks = match?.ranks || [];

    // Bước 1: kiểm tra đội TOP 1 của TRẬN NÀY — nếu đội đó ĐÃ kích hoạt
    // TỪ TRƯỚC trận này (chưa cộng điểm trận này vào) → vô địch ngay.
    const top1Team = ranks.find(t => Number(t.rank) === 1);
    if (top1Team) {
      const top1Key = top1Team.playerAccountIds
        .map(pid => pid.replace(/\*+$/, ""))
        .sort()
        .join("|");
      if (cprActivated.has(top1Key)) {
        championKey = top1Key;
      }
    }

    // Bước 2: cộng điểm trận này vào tổng cho TẤT CẢ đội (ép kiểu Number)
    for (const team of ranks) {
      const cleanIds = team.playerAccountIds
        .map(pid => pid.replace(/\*+$/, ""))
        .sort()
        .join("|");
      const repName = team.accountNames?.[0] || cleanIds;
      if (!teamTotals[cleanIds]) {
        teamTotals[cleanIds] = { rep: repName, by: 0, kill: 0, score: 0, cleanIds };
      }
      teamTotals[cleanIds].by    += Number(team.booyah) || 0;
      teamTotals[cleanIds].kill  += Number(team.kill) || 0;
      teamTotals[cleanIds].score += Number(team.score) || 0;
    }

    // Bước 3: cập nhật tập "đã kích hoạt" cho TẤT CẢ đội đạt ≥N điểm
    // TÍNH ĐẾN HẾT TRẬN NÀY (có hiệu lực để xét top1 ở TRẬN SAU)
    for (const key of Object.keys(teamTotals)) {
      if (teamTotals[key].score >= N) cprActivated.add(key);
    }
  }

  // ── Gộp đội thông minh (giao ≥2 ID → cùng đội) ──
  const rawTeams = Object.values(teamTotals).map(v => ({
    cleanIds: new Set(v.cleanIds.split("|")),
    rep: v.rep, by: v.by, kill: v.kill, score: v.score,
  }));
  const merged = [];
  const used = new Array(rawTeams.length).fill(false);
  for (let i = 0; i < rawTeams.length; i++) {
    if (used[i]) continue;
    let group = { ...rawTeams[i], cleanIds: new Set(rawTeams[i].cleanIds) };
    used[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < rawTeams.length; j++) {
        if (used[j]) continue;
        const inter = [...rawTeams[j].cleanIds].filter(id => group.cleanIds.has(id));
        if (inter.length >= 2) {
          group.by += rawTeams[j].by;
          group.kill += rawTeams[j].kill;
          group.score += rawTeams[j].score;
          rawTeams[j].cleanIds.forEach(id => group.cleanIds.add(id));
          used[j] = true;
          changed = true;
        }
      }
    }
    merged.push(group);
  }

  // Đánh dấu đội vô địch (so theo giao ID với championKey)
  let championGroup = null;
  if (championKey) {
    const champIdSet = new Set(championKey.split("|"));
    championGroup = merged.find(g => [...g.cleanIds].some(id => champIdSet.has(id)));
  }

  // Sắp xếp: đội vô địch lên đầu, còn lại theo điểm giảm dần
  let sorted;
  if (championGroup) {
    const rest = merged.filter(g => g !== championGroup).sort((a, b) => b.score - a.score);
    sorted = [{ ...championGroup, champion: true }, ...rest];
  } else {
    sorted = merged.sort((a, b) => b.score - a.score);
  }

  return { sortedTeams: sorted.slice(0, 12), hasChampion: !!championGroup };
}

// Gộp đội thông minh dùng ở luồng .td thường (giao ≥2 ID → cùng đội)
function mergeTeams(teamTotals) {
  const rawTeams = Object.entries(teamTotals).map(([key, val]) => ({
    cleanIds: new Set(key.split("|")),
    rep:   val.rep,
    by:    Number(val.by) || 0,
    kill:  Number(val.kill) || 0,
    score: Number(val.score) || 0,
  }));
  const merged = [];
  const used = new Array(rawTeams.length).fill(false);
  for (let i = 0; i < rawTeams.length; i++) {
    if (used[i]) continue;
    let group = { ...rawTeams[i], cleanIds: new Set(rawTeams[i].cleanIds) };
    used[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < rawTeams.length; j++) {
        if (used[j]) continue;
        const inter = [...rawTeams[j].cleanIds].filter(id => group.cleanIds.has(id));
        if (inter.length >= 2) {
          group.by    += rawTeams[j].by;
          group.kill  += rawTeams[j].kill;
          group.score += rawTeams[j].score;
          rawTeams[j].cleanIds.forEach(id => group.cleanIds.add(id));
          used[j] = true;
          changed = true;
        }
      }
    }
    merged.push(group);
  }
  return merged;
}

module.exports = { computeChampionBoard, mergeTeams };
