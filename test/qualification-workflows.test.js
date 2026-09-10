'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const lanes = ['overnight', 'recovery', 'approval-failure', 'backout'];
test('qualification lanes have isolated eight-job workflows and destinations', () => {
  const apps = JSON.parse(fs.readFileSync('config/qualification-apps.json', 'utf8'));
  assert.deepEqual(apps.map(a => a.slug), lanes.map(n => `${n}-api-qualification`));
  const groups = new Set();
  for (const {slug} of apps) {
    const yaml = fs.readFileSync(`.github/workflows/${slug}.yml`, 'utf8');
    assert.equal([...yaml.matchAll(/^  [a-z][a-z-]+:\n    name:/gm)].length, 8);
    assert(yaml.includes(`group: ${slug}-release`));
    for (const match of yaml.matchAll(/group: (\S+)/g)) {
      assert(match[1].startsWith(slug + '-'));
      groups.add(match[1]);
    }
    assert(yaml.includes(`APP_SLUG: ${slug}`));
    assert(yaml.includes(`environment: ${slug}-test`));
    assert(yaml.includes(`environment: ${slug}-production`));
    assert(yaml.includes(`TOMCAT_CONTEXT: ${slug}\n`));
    assert(yaml.includes(`TOMCAT_CONTEXT: ${slug}-test\n`));
    assert(yaml.includes(`ROLLBACK_WORKFLOW_ID: .github/workflows/${slug}.yml`));
    assert(yaml.includes('needs: [sast-scan, sca-dependency]'));
    assert(yaml.includes('bash scripts/qualification/sca-scan.sh'));
    assert(yaml.includes("needs.deploy-to-prod.result == 'success'"));
    assert(!/^  (push|schedule|pull_request):/m.test(yaml));
    assert(!yaml.includes('orders-api-parallel-test'));
    for (const m of yaml.matchAll(/uses: ([^\s#]+)/g)) assert.match(m[1], /@[a-f0-9]{40}$/);
    const accepted = spawnSync('bash', ['-c', 'source scripts/parallel-apps/identity.sh'], {env: {...process.env, APP_SLUG: slug}});
    assert.equal(accepted.status, 0);
    const rejected = spawnSync('bash', ['scripts/parallel-apps/deploy-tomcat.sh', 'sha256:'+'a'.repeat(64)],
      {env: {...process.env, APP_SLUG: slug, TOMCAT_CONTEXT: 'billing-api',
             CATALINA_HOME: '/nonexistent/qualification-test-tomcat'}, encoding: 'utf8'});
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /unknown Tomcat context/);
  }
  assert.equal(groups.size, lanes.length * 3);
});
