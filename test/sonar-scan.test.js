const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'sonar-scan.sh');

function scan(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helio-sonar-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.mkdirSync(path.join(dir, 'target', 'classes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sonar-project.properties'), 'sonar.projectKey=test-project\n');
    fs.writeFileSync(path.join(dir, 'bin', 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$TEST_DIR/docker-args"
printf '%s\\n' "$SONAR_SCANNER_JAVA_OPTS" > "$TEST_DIR/java-opts"
[[ " $* " != *" $SONAR_TOKEN "* ]] || exit 99
[[ "\${SCAN_EXIT:-0}" == 0 ]] || exit "$SCAN_EXIT"
echo 'ANALYSIS SUCCESSFUL, you can find the results at: http://localhost:9000/dashboard?id=test-project'
echo 'http://localhost:9000/api/ce/task?id=test-task'
`, { mode: 0o700 });
    fs.copyFileSync(path.join(dir, 'bin', 'docker'), path.join(dir, 'bin', 'scanner'));
    fs.writeFileSync(path.join(dir, 'bin', 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_DIR/curl-args"
case "$*" in
  *api/system/status*) echo '{"status":"UP"}' ;;
  *api/ce/task*) echo '{"task":{"status":"SUCCESS","analysisId":"test-analysis"}}' ;;
  *api/qualitygates/project_status*) printf '{"projectStatus":{"status":"%s","conditions":[]}}' "\${GATE_STATUS:-OK}" ;;
  *) exit 98 ;;
esac
`, { mode: 0o700 });
    const result = spawnSync('bash', [script, 'test-version'], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, TEST_DIR: dir,
        SONAR_TOKEN: 'test-only-not-a-real-token', SONAR_SCANNER_IMAGE: '', SONAR_SCANNER_BIN: '',
        SONAR_SCANNER_JAVA_OPTS: '', GITHUB_OUTPUT: path.join(dir, 'outputs'), ...overrides },
      encoding: 'utf8', timeout: 10000
    });
    const read = name => fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : '';
    return { ...result, args: read('docker-args'), java: read('java-opts'), calls: read('curl-args'), outputs: read('outputs') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('pins the scanner and bounds JVM and JavaScript memory without passing a token in Docker arguments', () => {
  const result = scan();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.args, /sonarsource\/sonar-scanner-cli@sha256:[a-f0-9]{64}/);
  assert.match(result.args, /-e\nSONAR_TOKEN\n/);
  assert.match(result.args, /-e\nSONAR_SCANNER_JAVA_OPTS\n/);
  assert.match(result.java, /-Xmx512m/);
  assert.match(result.args, /-Dsonar.javascript.node.maxspace=512/);
  assert.doesNotMatch(result.args, /sonar\.(exclusions|skip)|qualitygate.*false/);
  assert.match(result.outputs, /quality_gate=OK\nanalysis_id=test-analysis/);
});

test('scanner startup failure cannot become a successful quality gate', () => {
  const result = scan({ SCAN_EXIT: '3' });
  assert.equal(result.status, 3);
  assert.doesNotMatch(result.calls, /api\/ce\/task|api\/qualitygates/);
  assert.equal(result.outputs, '');
});

test('an explicitly configured host scanner uses the same full analysis and quality gate', () => {
  const result = scan({ SONAR_SCANNER_BIN: 'scanner' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.args, /--network|sonarsource\/sonar-scanner-cli/);
  assert.match(result.args, /-Dsonar.projectVersion=test-version/);
  assert.match(result.args, /-Dsonar.javascript.node.maxspace=512/);
  assert.match(result.outputs, /quality_gate=OK/);
  assert.equal(scan({ SONAR_SCANNER_BIN: 'scanner', GATE_STATUS: 'ERROR' }).status, 6);
  assert.equal(scan({ SONAR_SCANNER_BIN: 'scanner', SCAN_EXIT: '3' }).status, 3);
});

test('an unavailable explicitly configured host scanner fails without silently changing runtimes', () => {
  const result = scan({ SONAR_SCANNER_BIN: '/nonexistent/helio-scanner' });
  assert.equal(result.status, 2);
  assert.equal(result.args, '');
});

for (const status of ['ERROR', 'NONE', 'UNKNOWN']) {
  test(`quality gate ${status} fails closed`, () => {
    assert.equal(scan({ GATE_STATUS: status }).status, 6);
  });
}

test('every Sonar HTTP request has a connection and overall timeout', () => {
  const result = scan();
  assert.equal(result.status, 0);
  for (const call of result.calls.trim().split('\n')) {
    assert.match(call, /--connect-timeout \d+/);
    assert.match(call, /--max-time \d+/);
  }
});
