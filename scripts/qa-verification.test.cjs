const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { evaluate, hook, run } = require('./qa-verification.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-verification-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'integration');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'original\n');
  git('add', 'tracked.txt');
  git('commit', '-m', 'Initial commit');
  const revision = git('rev-parse', 'HEAD');
  const planPath = path.join(dir, 'plan.json');
  const resultPath = path.join(dir, 'result.json');
  const plan = {
    worktree: repo, branch: 'integration', revision, commits: [revision],
    checks: [{ id: 'check', cwd: repo, executable: process.execPath, args: ['-e', 'console.log("checked")'] }],
  };
  const writePlan = () => fs.writeFileSync(planPath, JSON.stringify(plan));
  writePlan();
  return { repo, git, plan, planPath, resultPath, writePlan };
}

test('records output and exit codes and appends the hook verdict', (t) => {
  const { planPath, resultPath } = fixture(t);
  const result = run(planPath, resultPath);
  assert.equal(result.checks[0].exitCode, 0);
  assert.match(fs.readFileSync(`${resultPath}.log`, 'utf8'), /checked/);
  assert.equal(evaluate(resultPath), 'PASS');
  const response = `Tests completed.\nQA_EVIDENCE_FILE: ${resultPath}`;
  assert.match(hook({ agentName: 'qa-reviewer', response }).modifiedResponse, /Deterministic QA hook: PASS/);
  assert.throws(() => run(planPath, resultPath), /EEXIST/);
});

test('reports failing and unstarted checks separately', (t) => {
  const { plan, planPath, resultPath, writePlan } = fixture(t);
  plan.checks[0].args = ['-e', 'console.error("failed"); process.exit(3)'];
  writePlan();
  run(planPath, resultPath);
  assert.equal(evaluate(resultPath), 'FAIL');
  assert.match(fs.readFileSync(`${resultPath}.log`, 'utf8'), /failed/);
  assert.match(hook({ agentName: 'QA Reviewer', response: `QA_EVIDENCE_FILE: ${resultPath}` }).modifiedResponse, /hook: FAIL/);
});

test('blocks a missing executable and missing or malformed evidence', (t) => {
  const { plan, planPath, resultPath, writePlan } = fixture(t);
  plan.checks[0].executable = path.join(path.dirname(resultPath), 'missing-executable');
  writePlan();
  run(planPath, resultPath);
  assert.throws(() => evaluate(resultPath), /did not complete/);
  assert.match(hook({ agentName: 'qa-reviewer', response: `QA_EVIDENCE_FILE: ${resultPath}` }).modifiedResponse, /hook: BLOCKED/);
  assert.match(hook({ agentName: 'qa-reviewer', response: 'no evidence' }).modifiedResponse, /hook: BLOCKED/);
  assert.deepEqual(hook({ agentName: 'architect', response: 'no evidence' }), {});
});

test('blocks changed worktree, plan, or output and missing required checks', (t) => {
  const { repo, plan, planPath, resultPath, writePlan } = fixture(t);
  run(planPath, resultPath);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n');
  assert.throws(() => evaluate(resultPath), /Worktree changed/);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'original\n');
  fs.writeFileSync(path.join(repo, 'new-test.txt'), 'new\n');
  assert.throws(() => evaluate(resultPath), /Worktree changed/);
  fs.unlinkSync(path.join(repo, 'new-test.txt'));
  plan.checks.push({ id: 'other', cwd: repo, executable: process.execPath, args: [] });
  writePlan();
  assert.throws(() => evaluate(resultPath), /Plan or log changed/);
  plan.checks.pop();
  writePlan();
  fs.appendFileSync(`${resultPath}.log`, 'altered');
  assert.throws(() => evaluate(resultPath), /Plan or log changed/);
});

test('rejects a wrong revision or a non-ancestor implementation commit', (t) => {
  const { plan, planPath, resultPath, writePlan } = fixture(t);
  plan.revision = '0'.repeat(40);
  writePlan();
  assert.throws(() => run(planPath, resultPath), /Revision does not match/);
  plan.revision = plan.commits[0];
  plan.commits.push('0'.repeat(40));
  writePlan();
  assert.throws(() => run(planPath, resultPath), /merge-base failed/);
});

test('hook command handles a subagent event on stdin', (t) => {
  const { planPath, resultPath } = fixture(t);
  run(planPath, resultPath);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'qa-verification.cjs'), 'hook'], {
    input: JSON.stringify({ agentName: 'qa-reviewer', response: `QA_EVIDENCE_FILE: ${resultPath}` }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).modifiedResponse, /hook: PASS/);
});

test('blocks incomplete metadata and a branch change', (t) => {
  const { git, planPath, resultPath } = fixture(t);
  run(planPath, resultPath);
  git('switch', '-c', 'different');
  assert.throws(() => evaluate(resultPath), /Branch does not match/);
  git('switch', 'integration');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  result.checks = [];
  fs.writeFileSync(resultPath, JSON.stringify(result));
  assert.throws(() => evaluate(resultPath), /Required checks are missing/);
});
