const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceTotal } = require('./invoice');

test('totals line items and applies the default tax rate', () => {
  const invoice = invoiceTotal({ lineItems: [{ quantity: 2, unitPrice: 50 }, { quantity: 1, unitPrice: 19.99 }] });
  assert.deepEqual(invoice, { currency: 'GBP', net: 119.99, tax: 24, gross: 143.99 });
});

test('honours an explicit tax rate and currency', () => {
  const invoice = invoiceTotal({ lineItems: [{ quantity: 4, unitPrice: 25 }], taxRate: 0.05, currency: 'USD' });
  assert.deepEqual(invoice, { currency: 'USD', net: 100, tax: 5, gross: 105 });
});

test('an invoice without line items is rejected', () => {
  assert.throws(() => invoiceTotal({ lineItems: [] }));
  assert.throws(() => invoiceTotal({}));
});

test('a line item with a bad quantity or price is rejected', () => {
  assert.throws(() => invoiceTotal({ lineItems: [{ quantity: 0, unitPrice: 10 }] }));
  assert.throws(() => invoiceTotal({ lineItems: [{ quantity: 1, unitPrice: -1 }] }));
});
