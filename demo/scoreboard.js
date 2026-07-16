// Live demo feature: a tiny scoreboard for the HackRate reviewer to look at.
function tally(scores) {
  return scores.reduce((sum, s) => sum + s, 0);
}

function average(scores) {
  if (scores.length === 0) return 0;
  return tally(scores) / scores.length;
}

module.exports = { tally, average };
