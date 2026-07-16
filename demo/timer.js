// Live re-run demo: a small countdown timer helper.
function secondsLeft(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
module.exports = { secondsLeft };
