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
const governedInputValidator = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'validate-governed-inputs.sh'),
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
  'deploy-to-prod': /scripts\/deploy-tomcat\.sh/,
  'post-deploy-verify': /scripts\/verify-deployment\.sh/
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
    assert.match(jobDefinition(job), /runs-on: \[self-hosted, "\$\{\{ vars\.HELIO_RUNNER_LABEL \|\| 'helio-tomcat' \}\}"\]/,
      `${job} needs on-premise systems and must run on the on-premise runner`);
  }
  assert.match(jobDefinition('unit-tests'), /runs-on: ubuntu-latest/, 'unit-tests runs on GitHub-hosted runners');
  assert.match(jobDefinition('build-and-package'), /runs-on: \[self-hosted, "\$\{\{ vars\.HELIO_RUNNER_LABEL \|\| 'helio-tomcat' \}\}"\]/, 'the build publishes to the internal Nexus, so it runs on-premise');
  assert.match(jobDefinition('build-and-package'), /scripts\/publish-artifact\.sh/, 'the build must publish to the artifact system of record');
});

test('every stage does real work and nothing is padded', () => {
  for (const [job, pattern] of Object.entries(realWork)) {
    assert.match(jobDefinition(job), pattern, `${job} must do its real work`);
  }
  assert.doesNotMatch(workflow, /\bsleep \d+/, 'no stage may pad its runtime with sleep');
  assert.doesNotMatch(workflow, /\bbny\b|bny_/i, 'the workflow contract is helio_*');
});

test('production is only ever touched by a Helio dispatch', () => {
  assert.doesNotMatch(workflow, /\n  push:/,
    'the segmented workflow is dispatched by Helio; native standalone execution has its own workflow');
  for (const productionJob of ['deploy-to-prod', 'post-deploy-verify']) {
    assert.doesNotMatch(jobDefinition(productionJob), /github\.event_name != 'workflow_dispatch'/,
      `${productionJob} must never mutate or verify production from a push build`);
    assert.match(jobDefinition(productionJob), /inputs\.helio_execution_id != ''/,
      `${productionJob} must require a Helio correlation id`);
  }
});

test('every segmented provider stage validates the complete Helio dispatch envelope', () => {
  for (const job of ['build-and-package', ...independentlyDispatchedJobs]) {
    const definition = jobDefinition(job);
    assert.match(definition, /scripts\/validate-governed-inputs\.sh/,
      `${job} must validate the release, execution, stage and workflow revision`);
  }
  assert.match(governedInputValidator, /\[0-9a-fA-F\]\{8\}.*\[1-5\].*\[89abAB\].*\[0-9a-fA-F\]\{12\}/,
    'governed identifiers must use the UUID shape, not merely contain 36 hex/hyphen characters');
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
    assert.match(nativeJob(job), /runs-on: \[self-hosted, "\$\{\{ vars\.HELIO_RUNNER_LABEL \|\| 'helio-tomcat' \}\}"\]/);
  }
  for (const required of ['deployments: write', 'helio_execution_id:', 'helio_release_id:',
    'helio-forward-release', 'rollback_workflow_id']) {
    assert.ok(native.includes(required), `native workflow must keep the Helio contract marker ${required}`);
  }
});

// ── Production hardening that both governed files must keep ──
for (const [label, text] of [['segmented', workflow], ['native', native]]) {
  test(`${label}: every action is pinned to a full commit SHA`, () => {
    const uses = [...text.matchAll(/uses: ([^\s#]+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 4);
    for (const ref of uses) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} must be pinned to a commit SHA`);
  });
  test(`${label}: deployments:write is granted only to the production job`, () => {
    const workflowLevel = text.slice(0, text.indexOf('\njobs:'));
    assert.doesNotMatch(workflowLevel, /deployments: write/);
    const prod = label === 'native' ? nativeJob('deploy-to-prod') : jobDefinition('deploy-to-prod');
    assert.match(prod, /deployments: write/);
    assert.equal((text.match(/deployments: write/g) || []).length, 1);
  });
  test(`${label}: deployments to one environment are serialised without cancelling`, () => {
    for (const env of ['test', 'uat', 'preprod', 'production']) {
      assert.match(text, new RegExp(`group: billing-api-${env}\\n\\s+cancel-in-progress: false`), `concurrency group for ${env}`);
    }
  });
  test(`${label}: nothing leaves the boundary as a GitHub artifact unless allowed`, () => {
    const uploads = text.split('\n').filter((l) => l.includes('actions/upload-artifact')).length;
    const gated = (text.match(/vars\.KEEP_GITHUB_ARTIFACTS == 'true'/g) || []).length;
    assert.ok(uploads >= 3 && gated === uploads, `${uploads} uploads, ${gated} gated`);
  });
  test(`${label}: governed runs validate their inputs and verify the served artifact`, () => {
    assert.ok((text.match(/Validate governed inputs/g) || []).length >= 2);
    assert.match(label === 'segmented' ? governedInputValidator : text,
      /workflow_revision" == "\$executing_revision|WORKFLOW_REVISION" == "\$GITHUB_SHA"/);
    assert.match(text, /scripts\/verify-deployment\.sh "\$ONPREM_TOMCAT\/billing-api" "\$/);
    assert.match(text, /PRODUCTION_URL: \$\{\{ env\.ONPREM_TOMCAT \}\}\/billing-api\//,
      'deployment evidence must point at the configured production target');
  });
}

test('official JavaScript actions use pinned Node 24 releases', () => {
  const fast = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'billing-api-fast.yml'),
    'utf8'
  );
  const requiredPins = {
    'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1', // v7.0.1
    'actions/setup-java': 'dd06d9cba3e5552c54d9f8ea23572deb30010f7c', // v6.0.0
    'actions/setup-node': '820762786026740c76f36085b0efc47a31fe5020', // v7.0.0
    'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' // v7.0.1
  };
  for (const [label, text] of [['segmented', workflow], ['native', native], ['fast', fast]]) {
    for (const [action, sha] of Object.entries(requiredPins)) {
      const refs = [...text.matchAll(new RegExp(`uses: ${action.replace('/', '\\/')}@([^\\s#]+)`, 'g'))]
        .map((match) => match[1]);
      if (refs.length === 0) continue;
      assert.deepEqual([...new Set(refs)], [sha], `${label} must pin ${action} to its Node 24 release`);
    }
  }
});

test('no expression ternary yields an empty string (rollback verification bug)', () => {
  for (const text of [workflow, native, fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'billing-api-fast.yml'), 'utf8')]) {
    assert.doesNotMatch(text, /&& '' \|\|/, "GitHub expressions treat '' as falsey; decide in the shell instead");
    assert.match(text, /DEPLOYMENT_ONLY" == "true" \]\] && EXPECTED_VERSION=""/);
    assert.match(text, /format\('v3\.4\.2-\{0\}', github\.sha\)/, 'an unversioned run must not reuse an immutable registry version');
    assert.doesNotMatch(text, /-z "\$WORKFLOW_REVISION" \|\|/, 'workflow_revision is mandatory on governed runs');
  }
});
test('native: one release at a time, and each environment lock covers its validation stage', () => {
  assert.match(native, /^concurrency:\n  group: billing-api-release\n  cancel-in-progress: false/m);
  for (const [job, env] of [['qa-automated-tests', 'test'], ['policy-evaluation', 'uat'], ['smoke-and-perf-tests', 'preprod'], ['post-deploy-verify', 'production']]) {
    assert.match(nativeJob(job), new RegExp(`group: billing-api-${env}`), `${job} holds the ${env} lock`);
    assert.match(jobDefinition(job), new RegExp(`group: billing-api-${env}`), `${job} holds the ${env} lock (segmented)`);
  }
});
