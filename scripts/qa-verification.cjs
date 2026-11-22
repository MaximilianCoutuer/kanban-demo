const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.error ? result.error.message : result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function snapshot(worktree) {
  const status = git(worktree, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  const diff = git(worktree, 'diff', '--binary', 'HEAD', '--');
  const untracked = git(worktree, 'ls-files', '--others', '--exclude-standard', '-z');
  const digest = crypto.createHash('sha256').update(status).update(diff);
  for (const name of untracked.split('\0').filter(Boolean).sort()) {
    const file = path.join(worktree, name);
    const stat = fs.lstatSync(file);
    digest.update(name).update('\0');
    if (stat.isSymbolicLink()) digest.update(fs.readlinkSync(file));
    else if (stat.isFile()) digest.update(fs.readFileSync(file));
    else throw new Error(`Cannot fingerprint untracked path: ${name}`);
    digest.update('\0');
  }
  return digest.digest('hex');
}

function readPlan(planPath) {
  if (!path.isAbsolute(planPath)) throw new Error('Plan path must be absolute.');
  const bytes = fs.readFileSync(planPath);
  const plan = JSON.parse(bytes);
  if (!plan || typeof plan !== 'object' || !path.isAbsolute(plan.worktree || '') ||
      typeof plan.branch !== 'string' || !plan.branch ||
      typeof plan.revision !== 'string' || !/^[a-f0-9]{40,64}$/i.test(plan.revision) ||
      !Array.isArray(plan.commits) || plan.commits.length === 0 ||
      !plan.commits.every((commit) => typeof commit === 'string' && /^[a-f0-9]{40,64}$/i.test(commit)) ||
      !Array.isArray(plan.checks) || plan.checks.length === 0) {
    throw new Error('Invalid plan: worktree, branch, full revision, commits, and checks are required.');
  }
  const ids = new Set();
  for (const check of plan.checks) {
    if (!check || typeof check.id !== 'string' || !check.id.trim() || ids.has(check.id) ||
        typeof check.cwd !== 'string' || !path.isAbsolute(check.cwd) ||
        typeof check.executable !== 'string' || !check.executable.trim() ||
        !Array.isArray(check.args) || !check.args.every((arg) => typeof arg === 'string')) {
      throw new Error('Invalid check: unique id, absolute cwd, executable, and string args are required.');
    }
    ids.add(check.id);
  }
  return { plan, digest: hash(bytes) };
}

function verifyRevision(plan) {
  const root = fs.realpathSync(git(plan.worktree, 'rev-parse', '--show-toplevel'));
  if (root !== fs.realpathSync(plan.worktree)) throw new Error('Plan worktree is not the Git worktree root.');
  if (git(root, 'branch', '--show-current') !== plan.branch) throw new Error('Branch does not match the plan.');
  if (git(root, 'rev-parse', 'HEAD') !== plan.revision) throw new Error('Revision does not match the plan.');
  for (const commit of plan.commits) git(root, 'merge-base', '--is-ancestor', commit, plan.revision);
  return root;
}

function outsideWorktree(file, worktree) {
  const parent = fs.realpathSync(path.dirname(file));
  const relative = path.relative(fs.realpathSync(worktree), parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Evidence files must be outside the worktree.');
  }
}

function run(planPath, resultPath) {
  if (!path.isAbsolute(resultPath || '')) throw new Error('Result path must be absolute.');
  const { plan, digest } = readPlan(planPath);
  const root = verifyRevision(plan);
  outsideWorktree(planPath, root);
  outsideWorktree(resultPath, root);
  const before = snapshot(root);
  const resultFd = fs.openSync(resultPath, 'wx');
  try {
    const logPath = `${resultPath}.log`;
    const logFd = fs.openSync(logPath, 'wx');
    const checks = [];
    try {
      for (const check of plan.checks) {
        fs.writeSync(logFd, `\n== ${check.id} ==\nWorking directory: ${check.cwd}\nCommand: ${JSON.stringify([check.executable, ...check.args])}\n`);
        const child = spawnSync(check.executable, check.args, {
          cwd: check.cwd, stdio: ['ignore', logFd, logFd], windowsHide: true,
        });
        const error = child.error ? child.error.message : null;
        fs.writeSync(logFd, `\nExit code: ${child.status === null ? 'unavailable' : child.status}; signal: ${child.signal || 'none'}${error ? `; startup error: ${error}` : ''}\n`);
        checks.push({ ...check, exitCode: child.status, signal: child.signal, error });
      }
    } finally {
      fs.closeSync(logFd);
    }
    const after = snapshot(root);
    const result = {
      version: 1, planPath, planHash: digest, logPath, logHash: hash(fs.readFileSync(logPath)),
      revision: plan.revision, before, after, checks,
    };
    fs.writeFileSync(resultFd, JSON.stringify(result, null, 2));
    return result;
  } finally {
    fs.closeSync(resultFd);
  }
}

function evaluate(resultPath) {
  if (!path.isAbsolute(resultPath)) throw new Error('Evidence path must be absolute.');
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (result.version !== 1 || typeof result.planPath !== 'string' ||
      typeof result.logPath !== 'string' || result.logPath !== `${resultPath}.log`) {
    throw new Error('Invalid evidence metadata.');
  }
  const { plan, digest } = readPlan(result.planPath);
  const root = verifyRevision(plan);
  outsideWorktree(result.planPath, root);
  outsideWorktree(resultPath, root);
  if (digest !== result.planHash || result.revision !== plan.revision ||
      hash(fs.readFileSync(result.logPath)) !== result.logHash) throw new Error('Plan or log changed since execution.');
  if (result.before !== result.after || result.after !== snapshot(root)) throw new Error('Worktree changed during or after execution.');
  if (!Array.isArray(result.checks) || result.checks.length !== plan.checks.length) throw new Error('Required checks are missing.');
  let failed = false;
  for (let i = 0; i < plan.checks.length; i++) {
    const expected = plan.checks[i];
    const actual = result.checks[i];
    if (!actual || actual.id !== expected.id || actual.cwd !== expected.cwd ||
        actual.executable !== expected.executable || JSON.stringify(actual.args) !== JSON.stringify(expected.args)) {
      throw new Error('Recorded checks do not match the plan.');
    }
    if (actual.error || actual.signal || !Number.isInteger(actual.exitCode)) throw new Error(`Check did not complete: ${expected.id}`);
    if (actual.exitCode !== 0) failed = true;
  }
  return failed ? 'FAIL' : 'PASS';
}

function hook(event) {
  const name = event.agentName || event.agent_name;
  const displayName = event.agentDisplayName || event.agent_display_name;
  if (![name, displayName].some((value) => typeof value === 'string' && /^(qa-reviewer|QA Reviewer)$/i.test(value))) return {};
  const response = event.response || event.last_assistant_message || '';
  const markers = [...response.matchAll(/^QA_EVIDENCE_FILE: (.+)$/gm)];
  let message;
  try {
    if (markers.length !== 1) throw new Error('Expected exactly one QA_EVIDENCE_FILE marker in the QA response.');
    const resultPath = markers[0][1].trim();
    message = `Deterministic QA hook: ${evaluate(resultPath)} (execution evidence only; acceptance criteria still require Verification Gate review).`;
  } catch (error) {
    message = `Deterministic QA hook: BLOCKED (${error.message}).`;
  }
  return { modifiedResponse: `${response}\n\n${message}` };
}

if (require.main === module) {
  try {
    if (process.argv[2] === 'run' && process.argv.length === 5) {
      const result = run(process.argv[3], process.argv[4]);
      process.stdout.write(`Evidence: ${process.argv[4]}\nLog: ${result.logPath}\n`);
    } else if (process.argv[2] === 'hook' && process.argv.length === 3) {
      process.stdout.write(JSON.stringify(hook(JSON.parse(fs.readFileSync(0, 'utf8')))));
    } else {
      throw new Error('Usage: node scripts/qa-verification.cjs run <absolute-plan> <absolute-result> | hook');
    }
  } catch (error) {
    if (process.argv[2] === 'hook') {
      process.stdout.write(JSON.stringify({ decision: 'block', reason: `QA hook could not process its input: ${error.message}` }));
    } else {
      process.stderr.write(`QA evidence error: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = { evaluate, hook, run };
