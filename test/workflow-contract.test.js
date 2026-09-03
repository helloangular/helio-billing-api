// Structural contract of the governed workflow. Every stage must stay
// individually dispatchable by Helio, the on-premise stages must run on the
// on-premise runner, and nothing may pad the pipeline with fake work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'quote-to-bind.yml'),
  'utf8'
);

function jobDefinition(job) {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `workflow must define ${job}`);
  const remainder = workflow.slice(start + 1);
  const next = remainder.slice(3).match(/\n  [a-z][a-z0-9-]+:\n/);
  return next ? remainder.slice(0, next.index + 3) : remainder;
}

const independentlyDispatchedJobs = [
  'unit-tests', 'sast-scan', 'sca-dependency', 'deploy-to-test', 'qa-automated-tests',
  'deploy-to-uat', 'policy-evaluation', 'deploy-to-preprod', 'smoke-and-perf-tests',
  'deploy-to-prod', 'post-deploy-verify'
];
const onPremiseJobs = [
  'sast-scan', 'sca-dependency', 'deploy-to-test', 'qa-automated-tests', 'deploy-to-uat',
  'policy-evaluation', 'deploy-to-preprod', 'smoke-and-perf-tests', 'deploy-to-prod',
  'post-deploy-verify'
];
const realWork = {
  'sast-scan': /scripts\/sonar-scan\.sh/,
  'sca-dependency': /scripts\/sca-scan\.sh/,
  'deploy-to-test': /TOMCAT_CONTEXT: marine-cargo-test/,
  'qa-automated-tests': /npm run qa/,
  'deploy-to-uat': /TOMCAT_CONTEXT: marine-cargo-uat/,
  'policy-evaluation': /scripts\/opa-policy-check\.sh/,
  'deploy-to-preprod': /TOMCAT_CONTEXT: marine-cargo-preprod/,
  'smoke-and-perf-tests': /scripts\/smoke-perf\.sh/,
  'deploy-to-prod': /scripts\/deploy-tomcat\.sh/
};

test('every automated stage is individually dispatchable by Helio', () => {
  for (const job of independentlyDispatchedJobs) {
    const definition = jobDefinition(job);
    assert.match(definition, /if: \$\{\{ always\(\) &&/,
      `${job} must evaluate its dispatch guard even when prerequisite jobs are skipped`);
    assert.match(definition, new RegExp(`inputs\\.helio_stage_id == '${job}'`),
      `${job} must only run when Helio dispatches exactly this stage`);
  }
});

test('stages that need on-premise systems run on the on-premise runner', () => {
  for (const job of onPremiseJobs) {
    assert.match(jobDefinition(job), /runs-on: \[self-hosted, helio-tomcat\]/,
      `${job} needs on-premise systems and must run on the on-premise runner`);
  }
  for (const job of ['build-and-package', 'unit-tests']) {
    assert.match(jobDefinition(job), /runs-on: ubuntu-latest/, `${job} runs on GitHub-hosted runners`);
  }
});

test('every stage does real work and nothing is padded', () => {
  for (const [job, pattern] of Object.entries(realWork)) {
    assert.match(jobDefinition(job), pattern, `${job} must do its real work`);
  }
  assert.doesNotMatch(workflow, /\bsleep \d+/, 'no stage may pad its runtime with sleep');
  assert.doesNotMatch(workflow, /\bbny\b|bny_/i, 'the workflow contract is helio_*');
});

test('production is only ever touched by a Helio dispatch', () => {
  for (const productionJob of ['deploy-to-prod', 'post-deploy-verify']) {
    assert.doesNotMatch(jobDefinition(productionJob), /github\.event_name != 'workflow_dispatch'/,
      `${productionJob} must never mutate or verify production from a push build`);
  }
});

test('the Helio managed-release contract markers are present', () => {
  for (const required of ['deployments: write', 'helio_execution_id:', 'helio_release_id:',
    'helio_stage_id:', 'helio-forward-release', 'rollback_workflow_id']) {
    assert.ok(workflow.includes(required), `workflow must keep the Helio contract marker ${required}`);
  }
});
