// Auto-send proof: a small currency formatter.
function formatUSD(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
module.exports = { formatUSD };
