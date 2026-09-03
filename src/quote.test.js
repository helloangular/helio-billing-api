const test = require('node:test');
const assert = require('node:assert/strict');
const { premium } = require('./quote');

test('coastal basic cover is priced from the base rate', () => {
  assert.equal(premium({ cargoValue: 100000, route: 'coastal', coverType: 'basic' }), 420);
});

test('trans-pacific all-risk cover costs more than coastal basic', () => {
  assert.ok(premium({ cargoValue: 100000, route: 'trans-pacific', coverType: 'all-risk' }) > 420);
});

test('unknown routes fall back to the default route factor', () => {
  assert.equal(premium({ cargoValue: 100000, route: 'arctic', coverType: 'basic' }), 483);
});

test('a non-positive cargo value is rejected', () => {
  assert.throws(() => premium({ cargoValue: 0, route: 'coastal', coverType: 'basic' }));
});
