const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'quote-to-bind.yml'),
  'utf8'
);

const independentlyDispatchedJobs = [
  'unit-tests',
  'sast-scan',
  'sca-dependency',
  'deploy-to-test',
  'qa-automated-tests',
  'deploy-to-uat',
  'policy-evaluation',
  'deploy-to-preprod',
  'smoke-and-perf-tests',
  'deploy-to-prod',
  'post-deploy-verify'
];

for (const job of independentlyDispatchedJobs) {
  const start = workflow.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `workflow must define ${job}`);
  const remainder = workflow.slice(start + 3);
  const nextJobMatch = remainder.match(/\n  [a-z][a-z0-9-]+:\n/);
  const end = nextJobMatch ? start + 3 + nextJobMatch.index : undefined;
  const definition = workflow.slice(start, end);
  assert.match(
    definition,
    /if: \$\{\{ always\(\) &&/,
    `${job} must evaluate its dispatch guard even when prerequisite jobs are skipped`
  );
  assert.match(
    definition,
    /sleep 8/,
    `${job} must remain observable long enough for the governed UI to render running`
  );
}

const buildStart = workflow.indexOf('  build-and-package:');
const buildEnd = workflow.indexOf('\n  unit-tests:', buildStart);
assert.match(workflow.slice(buildStart, buildEnd), /sleep 8/,
  'build-and-package must expose an observable running interval');

console.log('workflow contract tests passed');
