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

  // ── BƯỚC 0 (FIX): xác định danh tính đội (gộp theo giao ≥2 ID) TRƯỚC,
  // dựa trên TOÀN BỘ raw key xuất hiện trong ≤5 trận đang xét.
  // Lý do: API có thể che ID (dấu *) không nhất quán giữa các trận, khiến
  // cùng 1 đội sinh ra 2 raw key khác nhau ở 2 trận. Nếu gộp đội SAU khi
  // đã tính xong activation/champion (bản cũ), activation/champion bị
  // tính trên danh tính "gãy" khác với danh tính hiển thị cuối cùng →
  // vô địch nhầm đội, điểm hiển thị không khớp điều kiện kích hoạt. Nay
  // gộp trước, mọi bước sau (tích điểm, kích hoạt, check top1, hiển thị)
  // dùng chung MỘT groupId cho mỗi đội xuyên suốt cả 5 trận.
  const rawKeysPerMatch = limited.map(match =>
    (match?.ranks || []).map(team => ({
      team,
      cleanIds: team.playerAccountIds.map(pid => pid.replace(/\*+$/, "")).sort().join("|"),
    }))
  );

  // Union-Find đơn giản trên raw key
  const parent = {};
  const find = (k) => {
    if (!(k in parent)) parent[k] = k;
    while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
    return k;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const idSetOfKey = {};
  for (const list of rawKeysPerMatch) {
    for (const { cleanIds } of list) {
      if (!idSetOfKey[cleanIds]) idSetOfKey[cleanIds] = new Set(cleanIds.split("|"));
    }
  }
  const allKeys = Object.keys(idSetOfKey);
  for (let i = 0; i < allKeys.length; i++) {
    for (let j = i + 1; j < allKeys.length; j++) {
      const a = idSetOfKey[allKeys[i]], b = idSetOfKey[allKeys[j]];
      let common = 0;
      for (const id of a) if (b.has(id)) common++;
      if (common >= 2) union(allKeys[i], allKeys[j]);
    }
  }

  // ── BƯỚC 1: xử lý từng trận theo groupId đã gộp ──
  const groupTotals = {};          // groupId -> { rep, by, kill, score }
  const cprActivated = new Set();  // groupId đã đạt ≥N điểm
  let championGroupId = null;

  for (const list of rawKeysPerMatch) {
    if (championGroupId) break; // đã có đội vô địch ở trận trước, dừng hẳn

    // Bước a: kiểm tra đội TOP 1 của TRẬN NÀY — nếu đã kích hoạt TỪ TRƯỚC
    // (chưa cộng điểm trận này) → vô địch ngay.
    const top1Entry = list.find(({ team }) => Number(team.rank) === 1);
    if (top1Entry) {
      const gid = find(top1Entry.cleanIds);
      if (cprActivated.has(gid)) championGroupId = gid;
    }

    // Bước b: cộng điểm trận này vào tổng theo groupId (ép kiểu Number)
    for (const { team, cleanIds } of list) {
      const gid = find(cleanIds);
      const repName = team.accountNames?.[0] || cleanIds;
      if (!groupTotals[gid]) groupTotals[gid] = { rep: repName, by: 0, kill: 0, score: 0 };
      groupTotals[gid].by    += Number(team.booyah) || 0;
      groupTotals[gid].kill  += Number(team.kill) || 0;
      groupTotals[gid].score += Number(team.score) || 0;
    }

    // Bước c: cập nhật tập "đã kích hoạt" cho TẤT CẢ group đạt ≥N điểm
    // TÍNH ĐẾN HẾT TRẬN NÀY (có hiệu lực để xét top1 ở TRẬN SAU)
    for (const gid of Object.keys(groupTotals)) {
      if (groupTotals[gid].score >= N) cprActivated.add(gid);
    }
  }

  // ── Xuất danh sách đội đã gộp, gắn cờ champion ──
  const merged = Object.entries(groupTotals).map(([gid, v]) => ({
    rep: v.rep, by: v.by, kill: v.kill, score: v.score,
    champion: gid === championGroupId,
  }));

  let sorted;
  if (championGroupId) {
    const championGroup = merged.find(g => g.champion);
    const rest = merged.filter(g => !g.champion).sort((a, b) => b.score - a.score);
    sorted = [championGroup, ...rest];
  } else {
    sorted = merged.sort((a, b) => b.score - a.score);
  }

  return { sortedTeams: sorted.slice(0, 12), hasChampion: !!championGroupId };
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
