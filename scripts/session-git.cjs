const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function main() {
  const event = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (typeof event.sessionId !== 'string' || !event.sessionId || typeof event.cwd !== 'string') {
    throw new Error('Expected a session hook payload with sessionId and cwd.');
  }

  process.chdir(event.cwd);
  const root = git('rev-parse', '--show-toplevel');
  process.chdir(root);
  const stateDir = path.resolve(root, git('rev-parse', '--git-path', 'copilot-session-git'));
  const stateFile = path.join(stateDir, `${createHash('sha256').update(event.sessionId).digest('hex')}.json`);
  const branch = () => git('symbolic-ref', '--quiet', '--short', 'HEAD');
  const head = () => git('rev-parse', 'HEAD');

  if (process.argv[2] === 'start') {
    if (fs.existsSync(stateFile)) return;
    if (git('status', '--porcelain', '--untracked-files=all')) {
      throw new Error('Worktree is not clean at session start; automatic commit and push are disabled for this session.');
    }
    const state = { root, branch: branch(), head: head() };
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state), { flag: 'wx' });
    return;
  }

  if (process.argv[2] !== 'end') throw new Error('Expected start or end.');
  if (!fs.existsSync(stateFile)) {
    throw new Error('No clean session-start snapshot exists; refusing to commit or push.');
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.root !== root || state.branch !== branch()) {
    throw new Error('Worktree or branch changed during the session; refusing to commit or push.');
  }

  if (git('status', '--porcelain', '--untracked-files=all')) {
    git('add', '--all');
    git('commit', '-m', 'Save session changes', '-m', 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
  }

  if (head() !== state.head) {
    const remote = git('config', '--default', 'origin', '--get', `branch.${state.branch}.remote`);
    const destination = git('config', '--default', `refs/heads/${state.branch}`, '--get', `branch.${state.branch}.merge`);
    git('push', '--set-upstream', remote, `HEAD:${destination}`);
  }
  fs.unlinkSync(stateFile);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Session Git hook failed: ${error.stderr?.toString().trim() || error.message}\n`);
  process.exitCode = 1;
}
