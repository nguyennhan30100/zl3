// ============================================================
// LOGIC "VÔ ĐỊCH" (CPR) — port nguyên vẹn từ bot Discord gốc.
// Xem chi tiết luật trong comment gốc của file index.js cũ.
// ============================================================
function computeChampionBoard(matchesOrdered, threshold = 50) {
  const MAX_MATCHES = 5;
  const limited = matchesOrdered.slice(0, MAX_MATCHES);

  const teamTotals = {};
  const cprActivated = new Set();
  let championKey = null;

  for (const match of limited) {
    if (championKey) break;

    const ranks = match?.ranks || [];

    const top1Team = ranks.find(t => t.rank === 1);
    if (top1Team) {
      const top1Key = top1Team.playerAccountIds
        .map(pid => pid.replace(/\*+$/, ""))
        .sort()
        .join("|");
      if (cprActivated.has(top1Key)) {
        championKey = top1Key;
      }
    }

    for (const team of ranks) {
      const cleanIds = team.playerAccountIds
        .map(pid => pid.replace(/\*+$/, ""))
        .sort()
        .join("|");
      const repName = team.accountNames?.[0] || cleanIds;
      if (!teamTotals[cleanIds]) {
        teamTotals[cleanIds] = { rep: repName, by: 0, kill: 0, score: 0, cleanIds };
      }
      teamTotals[cleanIds].by    += team.booyah || 0;
      teamTotals[cleanIds].kill  += team.kill || 0;
      teamTotals[cleanIds].score += team.score || 0;
    }

    for (const key of Object.keys(teamTotals)) {
      if (teamTotals[key].score >= threshold) cprActivated.add(key);
    }
  }

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

  let championGroup = null;
  if (championKey) {
    const champIdSet = new Set(championKey.split("|"));
    championGroup = merged.find(g => [...g.cleanIds].some(id => champIdSet.has(id)));
  }

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
    by:    val.by,
    kill:  val.kill,
    score: val.score,
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
