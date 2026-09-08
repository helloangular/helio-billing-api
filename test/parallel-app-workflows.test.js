'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const names = ['orders', 'inventory', 'shipping', 'customer', 'catalog', 'pricing', 'notification', 'reporting', 'settlement', 'audit'];
const read = p => fs.readFileSync(p, 'utf8');

test('ten independent eight-job workflows preserve gates and parallel scan fan-in', () => {
  const apps = JSON.parse(read('config/parallel-apps.json'));
  assert.deepEqual(apps.map(a => a.slug), names.map(n => `${n}-api-parallel-test`));
  const groups = new Set();
  for (const { slug } of apps) {
    const yaml = read(`.github/workflows/${slug}.yml`);
    const jobs = [...yaml.matchAll(/^  ([a-z][a-z-]+):\n    name:/gm)].map(m => m[1]);
    assert.deepEqual(jobs, ['build-and-package', 'unit-tests', 'sast-scan', 'sca-dependency', 'deploy-to-test', 'qa-automated-tests', 'deploy-to-prod', 'post-deploy-verify']);
    assert(yaml.includes(`group: ${slug}-release`));
    assert(!groups.has(`${slug}-release`)); groups.add(`${slug}-release`);
    assert(yaml.includes(`APP_SLUG: ${slug}`));
    assert(yaml.includes('PINNED_ARTIFACT_DIGEST: ${{ inputs.artifact_digest }}'));
    assert(!yaml.includes('"${{ inputs.artifact_digest }}"'));
    assert(yaml.includes(`environment: ${slug}-test`));
    assert(yaml.includes(`environment: ${slug}-production`));
    assert(yaml.includes('needs: [sast-scan, sca-dependency]'));
    assert(yaml.includes('needs: [qa-automated-tests, build-and-package]'));
    for (const job of ['sast-scan', 'sca-dependency']) {
      assert.match(yaml, new RegExp(`  ${job}:\\n    name: [^\\n]+\\n    needs: unit-tests`));
    }
    assert(yaml.includes(`ROLLBACK_WORKFLOW_ID: .github/workflows/${slug}.yml`));
    assert(yaml.includes(`environment:"${slug}-production"`));
    assert(!/group: (billing|payment)/.test(yaml));
    assert(!yaml.includes('payment-api-manual-test'));
    assert(!yaml.includes('$ONPREM_TOMCAT/billing-api'));
    assert(yaml.includes("needs.deploy-to-prod.result == 'success'"));
    for (const match of yaml.matchAll(/uses: ([^\s#]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
  }
});

test('deployment guards refuse other apps and non-allowlisted identities before touching disk', () => {
  for (const [app, context] of [['orders-api-parallel-test', 'billing-api'], ['orders-api-parallel-test', 'inventory-api-parallel-test'], ['../../billing-api', 'billing-api']]) {
    const r = spawnSync('bash', ['scripts/parallel-apps/deploy-tomcat.sh', 'sha256:' + 'a'.repeat(64)], {
      env: { ...process.env, APP_SLUG: app, TOMCAT_CONTEXT: context, CATALINA_HOME: '/nonexistent/tomcat/libexec' }, encoding: 'utf8'
    });
    assert.equal(r.status, 2); assert.match(r.stderr, /unknown Tomcat context|Unknown parallel app/);
  }
  const deploy = read('scripts/parallel-apps/deploy-tomcat.sh');
  assert(deploy.includes('current-digest-$context.txt'));
  assert(deploy.includes('artifacts/$APP_SLUG'));
  assert(!deploy.includes('current-digest.txt"'));
});

test('artifact and Sonar namespaces derive only from the validated app identity', () => {
  for (const helper of ['publish-artifact', 'resolve-artifact', 'sonar-scan']) {
    const script = read(`scripts/parallel-apps/${helper}.sh`);
    assert(script.includes('identity.sh'));
    assert(script.includes('$APP_SLUG'));
    assert(!script.includes('payment-api-manual-test'));
  }
  const resolve = read('scripts/parallel-apps/resolve-artifact.sh');
  assert(resolve.includes('exactly one'));
  assert(!resolve.includes('.downloadUrl'));
});

test('resolver verifies exact-coordinate bytes and refuses missing, ambiguous or mismatched records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-artifact-test-'));
  const bytes = 'test WAR bytes';
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const item = { path: 'io/helio/orders-api-parallel-test/v1/orders-api-parallel-test-v1.war', checksum: { sha256: digest }, downloadUrl: 'https://not-the-registry.invalid/leak' };
  try {
    fs.writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--get')) process.stdout.write(process.env.TEST_RECORD);
else {
  if (!args.at(-1).startsWith('http://registry.invalid/repository/helio-releases/io/helio/orders-api-parallel-test/')) process.exit(98);
  fs.writeFileSync(args[args.indexOf('--output') + 1], process.env.TEST_WAR);
}
`, { mode: 0o700 });
    const run = record => spawnSync('bash', ['scripts/parallel-apps/resolve-artifact.sh', '123', '', 'v1'], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, APP_SLUG: 'orders-api-parallel-test', NEXUS_URL: 'http://registry.invalid',
        NEXUS_TOKEN: 'test-only', RUNNER_TEMP: dir, TEST_RECORD: JSON.stringify(record), TEST_WAR: bytes }, encoding: 'utf8'
    });
    const good = run({ items: [item], continuationToken: null });
    assert.equal(good.status, 0, good.stderr); assert(good.stdout.includes(`artifact_digest=sha256:${digest}`));
    for (const record of [{ items: [] }, { items: [item, item] }, { items: [item], continuationToken: 'next' },
      { items: [{ ...item, checksum: { sha256: 'a'.repeat(64) } }] }, { items: [{ ...item, path: 'another-app.war' }] }]) {
      assert.notEqual(run(record).status, 0);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
