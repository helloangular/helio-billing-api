const assert = require('node:assert');
const { premium } = require('./quote');
assert.strictEqual(premium({ cargoValue: 100000, route: 'coastal', coverType: 'basic' }), 420);
assert.ok(premium({ cargoValue: 100000, route: 'trans-pacific', coverType: 'all-risk' }) > 420);
assert.throws(() => premium({ cargoValue: 0, route: 'coastal', coverType: 'basic' }));
console.log('unit tests passed');
