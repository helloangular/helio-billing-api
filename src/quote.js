// Minimal quote-to-bind calculation. Small on purpose: the pipeline is the
// subject of this repo, not the application.
function premium({ cargoValue, route, coverType }) {
  if (!(cargoValue > 0)) throw new Error('cargoValue must be positive');
  const base = cargoValue * 0.0042;
  const routeFactor = { 'trans-pacific': 1.35, 'trans-atlantic': 1.20, coastal: 1.0 }[route] ?? 1.15;
  const coverFactor = coverType === 'all-risk' ? 1.4 : 1.0;
  return Math.round(base * routeFactor * coverFactor * 100) / 100;
}
module.exports = { premium };
