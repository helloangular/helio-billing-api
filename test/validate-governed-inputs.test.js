const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, '..', 'scripts', 'validate-governed-inputs.sh');
const uuid = '914585e3-30d0-4eff-b01a-002785979cae';
const segmentedExecution =
  'helio-release-62dbb192-2027-4598-a5b5-8e87fdfc83e2-stage-2275a0cc-b9b8-4641-af00-e364f6693511-lease-d9083855-1d12-4c24-9cb2-8759dccc331b';
const sha = '498c50cb50cfe157a78992cdc51aba5eadb65989';

test('accepts a pinned forward-stage envelope', () => {
  execFileSync(script, [uuid, uuid, 'deploy-to-test', sha, sha, 'deploy-to-test', 'false']);
});

test('accepts Helio rollback correlation and an omitted stage id', () => {
  execFileSync(script, [`bny-rollback-${uuid}`, uuid, '', sha, sha, 'deploy-to-prod', 'true']);
});

test('accepts the fenced correlation emitted by the segmented orchestrator', () => {
  execFileSync(script, [segmentedExecution, uuid, 'deploy-to-test', sha, sha, 'deploy-to-test', 'false']);
});

for (const [label, args] of [
  ['malformed release id', [uuid, '------------------------------------', 'deploy-to-test', sha, sha, 'deploy-to-test', 'false']],
  ['wrong revision', [uuid, uuid, 'deploy-to-test', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sha, 'deploy-to-test', 'false']],
  ['wrong stage', [uuid, uuid, 'deploy-to-uat', sha, sha, 'deploy-to-test', 'false']],
  ['missing execution id', ['', uuid, 'deploy-to-test', sha, sha, 'deploy-to-test', 'false']]
]) {
  test(`rejects ${label}`, () => {
    const result = spawnSync(script, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  });
}
