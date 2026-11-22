const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.join(__dirname, 'session-git.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-git-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const remote = path.join(dir, 'remote.git');
  fs.mkdirSync(repo);
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(dir, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'session-branch');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'original\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'Initial commit');
  const hook = (action) => spawnSync(process.execPath, [script, action], {
    cwd: repo,
    input: JSON.stringify({ sessionId: 'test-session', cwd: repo }),
    encoding: 'utf8',
  });
  return { repo, remote, git, hook };
}

test('commits and pushes session changes on the existing branch', (t) => {
  const { repo, remote, git, hook } = fixture(t);
  assert.equal(hook('start').status, 0);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'updated\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  const result = hook('end');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(repo, '--git-dir', remote, 'rev-parse', 'refs/heads/session-branch'));
  assert.match(git(repo, 'log', '-1', '--format=%B'), /Co-authored-by: Copilot/);
  assert.equal(hook('start').status, 0);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'updated again\n');
  assert.equal(hook('end').status, 0);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(repo, '--git-dir', remote, 'rev-parse', 'refs/heads/session-branch'));
});

test('refuses pre-existing changes and does not commit them', (t) => {
  const { repo, git, hook } = fixture(t);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'pre-existing\n');
  const original = git(repo, 'rev-parse', 'HEAD');
  assert.notEqual(hook('start').status, 0);
  assert.notEqual(hook('end').status, 0);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), original);
  assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'pre-existing\n');
});

test('does not commit when the branch changed during the session', (t) => {
  const { repo, git, hook } = fixture(t);
  assert.equal(hook('start').status, 0);
  git(repo, 'switch', '-c', 'other');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  assert.notEqual(hook('end').status, 0);
  assert.match(git(repo, 'status', '--porcelain'), /new\.txt/);
});

test('does not create or push an empty commit', (t) => {
  const { repo, remote, git, hook } = fixture(t);
  const original = git(repo, 'rev-parse', 'HEAD');
  assert.equal(hook('start').status, 0);
  assert.equal(hook('end').status, 0);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), original);
  assert.equal(git(repo, '--git-dir', remote, 'for-each-ref', '--format=%(refname)'), '');
});

test('preserves the commit when pushing fails', (t) => {
  const { repo, git, hook } = fixture(t);
  assert.equal(hook('start').status, 0);
  git(repo, 'remote', 'set-url', 'origin', path.join(repo, 'missing-remote'));
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'updated\n');
  const original = git(repo, 'rev-parse', 'HEAD');
  const result = hook('end');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Session Git hook failed/);
  assert.notEqual(git(repo, 'rev-parse', 'HEAD'), original);
});

test('pushes to an existing differently named upstream branch', (t) => {
  const { repo, remote, git, hook } = fixture(t);
  git(repo, 'push', '-u', 'origin', 'HEAD:refs/heads/remote-target');
  assert.equal(hook('start').status, 0);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'updated\n');
  const result = hook('end');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(repo, '--git-dir', remote, 'rev-parse', 'refs/heads/remote-target'));
});
