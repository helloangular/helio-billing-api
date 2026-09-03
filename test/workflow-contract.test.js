// Structural contract of the governed workflow. Every stage must stay
// individually dispatchable by Helio, the on-premise stages must run on the
// on-premise runner, and nothing may pad the pipeline with fake work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'billing-api.yml'),
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
  'deploy-to-test': /TOMCAT_CONTEXT: billing-api-test/,
  'qa-automated-tests': /npm run qa/,
  'deploy-to-uat': /TOMCAT_CONTEXT: billing-api-uat/,
  'policy-evaluation': /scripts\/opa-policy-check\.sh/,
  'deploy-to-preprod': /TOMCAT_CONTEXT: billing-api-preprod/,
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

// ── Provider-owned variant: one run, gates as environment protection rules ──
const native = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'billing-api-native.yml'),
  'utf8'
);

function nativeJob(job) {
  const start = native.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `native workflow must define ${job}`);
  const remainder = native.slice(start + 1);
  const next = remainder.slice(3).match(/\n  [a-z][a-z0-9-]+:\n/);
  return next ? remainder.slice(0, next.index + 3) : remainder;
}

test('the native workflow is one provider-owned run', () => {
  assert.doesNotMatch(native, /helio_stage_id/, 'no per-stage dispatch guards in the native workflow');
  assert.doesNotMatch(native, /\n  push:/, 'the native workflow is dispatch-only');
  assert.doesNotMatch(native, /\bsleep \d+/);
  const inputs = native.match(/^      [a-z_]+:\n(?:        .*\n)+/gm) || [];
  assert.ok(inputs.length >= 6, 'inputs must be declared');
  for (const input of inputs) {
    assert.match(input, /default:/, `every input needs a default so Helio can start the run: ${input.split('\n')[0]}`);
  }
});

test('native gates are the environments the deploy jobs enter', () => {
  const gates = { 'deploy-to-test': 'test', 'deploy-to-uat': 'uat', 'deploy-to-preprod': 'preprod', 'deploy-to-prod': 'production' };
  for (const [job, environment] of Object.entries(gates)) {
    assert.match(nativeJob(job), new RegExp(`environment: ${environment}\\n`), `${job} must enter environment ${environment}`);
  }
  for (const gateJob of ['security-gate', 'cab-approval', 'app-owner-signoff', 'prod-release-gate']) {
    assert.equal(native.indexOf(`\n  ${gateJob}:\n`), -1, `${gateJob} is a protection rule, not a job, in the native workflow`);
  }
});

test('the native workflow does the same real work on the same runners', () => {
  for (const [job, pattern] of Object.entries(realWork)) {
    assert.match(nativeJob(job), pattern, `${job} must do its real work`);
  }
  for (const job of onPremiseJobs) {
    assert.match(nativeJob(job), /runs-on: \[self-hosted, helio-tomcat\]/);
  }
  for (const required of ['deployments: write', 'helio_execution_id:', 'helio_release_id:',
    'helio-forward-release', 'rollback_workflow_id']) {
    assert.ok(native.includes(required), `native workflow must keep the Helio contract marker ${required}`);
  }
});
