// Simple leaderboard sorter for the hackathon scoreboard
function sortLeaderboard(entries) {
  return entries.slice().sort((a, b) => b.score - a.score);
}

function topN(entries, n) {
  return sortLeaderboard(entries).slice(0, n);
}

module.exports = { sortLeaderboard, topN };
