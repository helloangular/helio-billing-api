// Minimal invoice calculation. Small on purpose: the pipeline is the
// subject of this repo, not the application.
function invoiceTotal({ lineItems, taxRate = 0.2, currency = 'GBP' }) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error('lineItems must be a non-empty array');
  }
  const net = lineItems.reduce((sum, { quantity, unitPrice }) => {
    if (!(quantity > 0) || !(unitPrice >= 0)) {
      throw new Error('line items need a positive quantity and a non-negative unit price');
    }
    return sum + quantity * unitPrice;
  }, 0);
  const round = (value) => Math.round(value * 100) / 100;
  const tax = round(net * taxRate);
  return { currency, net: round(net), tax, gross: round(net + tax) };
}
module.exports = { invoiceTotal };
