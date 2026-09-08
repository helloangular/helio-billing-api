'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const workflow = () => fs.readFileSync('.github/workflows/payment-api-manual-test.yml', 'utf8');

test('full payment workflow is isolated from Billing queues and deployments', () => {
  const yaml = workflow();
  assert.equal((yaml.match(/^  [a-z][a-z-]+:\n    name:/gm) || []).length, 12);
  for (const env of ['test', 'uat', 'preprod', 'production']) {
    assert(yaml.includes(`environment: payment-manual-${env}`));
  }
  assert(yaml.includes('group: payment-api-manual-test-release'));
  assert(!yaml.includes('group: billing-api'));
  assert(!yaml.includes('$ONPREM_TOMCAT/billing-api'));
  assert(!yaml.includes('TOMCAT_CONTEXT: billing-api'));
  assert(yaml.includes('ROLLBACK_WORKFLOW_ID: .github/workflows/payment-api-manual-test.yml'));
  assert(yaml.includes('environment:"payment-manual-production"'));
  for (const job of ['sast-scan', 'sca-dependency']) {
    assert.match(yaml, new RegExp(`  ${job}:\\n    name: [^\\n]+\\n    needs: unit-tests`));
  }
});

test('payment deployment cannot touch Billing contexts or its production digest file', () => {
  const script = fs.readFileSync('scripts/payment-manual/deploy-tomcat.sh', 'utf8');
  assert(!script.includes('state_file="$state_root/current-digest.txt"'));
  assert(script.includes('state_file="$state_root/current-digest-$context.txt"'));
  const result = spawnSync('bash', ['scripts/payment-manual/deploy-tomcat.sh', 'sha256:' + 'a'.repeat(64)], {
    env: { ...process.env, CATALINA_HOME: '/nonexistent/tomcat/libexec', TOMCAT_CONTEXT: 'billing-api' }, encoding: 'utf8'
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown Tomcat context/);
});

test('payment registry, scan project and policy are separate', () => {
  for (const name of ['publish-artifact', 'resolve-artifact']) {
    const script = fs.readFileSync(`scripts/payment-manual/${name}.sh`, 'utf8');
    assert(script.includes('payment-api-manual-test'));
    assert(!script.includes('name=billing-api'));
  }
  assert.match(fs.readFileSync('sonar-project-payment-manual.properties', 'utf8'), /sonar.projectKey=payment-api-manual-test/);
  assert.match(fs.readFileSync('policies/payment-manual-release-gate.rego', 'utf8'), /package helio.payment_manual/);
});
