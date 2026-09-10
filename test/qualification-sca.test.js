const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const scripts = path.join(__dirname, '..', 'scripts', 'qualification');
function run(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helio-sca-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'sleep'), '#!/bin/sh\nexit 0\n', {mode:0o700});
    fs.writeFileSync(path.join(dir, 'bin', 'trivy'), `#!/usr/bin/env bash
echo "$*" >> "$TEST_DIR/calls"
if [[ "$*" == *--download-db-only* ]]; then
  n=$(wc -l < "$TEST_DIR/calls")
  if (( n <= DB_FAILURES )); then echo 'temporary registry failure' >&2; exit 1; fi
  exit 0
fi
[[ "$*" == --version ]] && { echo 'Version: test'; exit 0; }
[[ "$SCAN_EXIT" == 0 ]] || exit "$SCAN_EXIT"
out=''; previous=''; for arg in "$@"; do [[ "$previous" == --output ]] && out="$arg"; previous="$arg"; done
if [[ "$*" == *cyclonedx* ]]; then echo '{"components":[]}' > "$out";
else printf '{"Results":[{"Vulnerabilities":[{"Severity":"%s"}]}]}' "$FINDING" > "$out"; fi
`, {mode:0o700});
    const result = spawnSync('bash', [path.join(scripts, 'sca-scan.sh')], {
      cwd:dir, encoding:'utf8', timeout:10000,
      env:{...process.env,PATH:`${dir}/bin:${process.env.PATH}`,TEST_DIR:dir,DB_FAILURES:'0',SCAN_EXIT:'0',FINDING:'LOW',...env}
    });
    return {...result,calls:fs.readFileSync(path.join(dir,'calls'),'utf8')};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
test('DB pre-download precedes scanning; bounded retry handles transient download failures', () => {
  const result=run({DB_FAILURES:'2'});
  assert.equal(result.status,0,result.stderr);
  const calls=result.calls.trim().split('\n');
  assert.equal(calls.filter(c=>c.includes('--download-db-only')).length,3);
  assert(calls[0].includes('--download-db-only'));
  for(const call of calls.filter(c=>c.includes('--download-db-only'))) assert.match(call,/--timeout 3m/);
  assert.match(result.calls,/--skip-db-update/);
});
test('exhausted downloads fail before scanning and emit an actionable annotation', () => {
  const result=run({DB_FAILURES:'99'});
  assert.notEqual(result.status,0);
  assert.equal(result.calls.trim().split('\n').length,3);
  assert.match(result.stdout+result.stderr,/Trivy vulnerability database unavailable/);
});
test('scanner failures and critical findings cannot turn into successful stages', () => {
  assert.equal(run({SCAN_EXIT:'7'}).status,7);
  assert.equal(run({FINDING:'CRITICAL'}).status,1);
});
