// Real QA stage: exercise the application deployed to the TEST environment
// over HTTP. Nothing is mocked; the target is the Tomcat context the
// deploy-to-test stage just installed. Run with: npm run qa
//
// Env: QA_TARGET_URL     (default http://127.0.0.1:8080/marine-cargo-test)
//      EXPECTED_VERSION  (optional; the release version the WAR must carry)
const test = require('node:test');
const assert = require('node:assert/strict');

const base = (process.env.QA_TARGET_URL || 'http://127.0.0.1:8080/marine-cargo-test').replace(/\/$/, '');
const expectedVersion = process.env.EXPECTED_VERSION || '';
const DIGEST = /^sha256:[0-9a-f]{64}$/;

async function get(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
  return { status: response.status, type: response.headers.get('content-type') || '', body: await response.text() };
}

async function health() {
  const response = await get('/health');
  assert.equal(response.status, 200, '/health must answer 200');
  assert.match(response.type, /application\/json/, '/health must be JSON');
  return JSON.parse(response.body);
}

test(`health of ${base} reports an UP Tomcat with an immutable digest`, async () => {
  const state = await health();
  assert.equal(state.status, 'UP');
  assert.equal(state.runtime, 'Apache Tomcat');
  assert.match(state.artifact_digest, DIGEST, 'health must expose the serving WAR digest');
  if (expectedVersion) {
    assert.equal(state.version, expectedVersion, 'deployed version must be the release under test');
  }
});

test('identity endpoints agree with health', async () => {
  const state = await health();
  const digest = await get('/artifact-digest');
  assert.equal(digest.status, 200);
  assert.equal(digest.body.trim(), state.artifact_digest, 'digest endpoint must agree with health');
  const version = await get('/version');
  assert.equal(version.status, 200);
  assert.equal(version.body.trim(), state.version, 'version endpoint must agree with health');
});

test('landing page shows the release identity', async () => {
  const state = await health();
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.ok(page.body.includes(state.version), 'landing page must show the release version');
  assert.ok(page.body.includes(state.artifact_digest), 'landing page must show the serving digest');
});
