import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { GithubPushService } from '../src/service.js'
import {
  createBareRemote,
  initProject,
  makeContext,
  run,
  tempDir,
  useLocalRemote,
  writeFakeGh,
} from './helpers.mjs'

/**
 * Configure the shared test environment for one scenario.
 * @param {{ repoExists?: boolean, prExists?: boolean, auth?: boolean, checks?: object[], releaseExists?: boolean }} [state] fake GitHub state.
 * @returns {{ parent: string, project: string, bare: string, fakeGh: string, githubUrl: string }} fixture paths.
 */
function fixture(state = {}) {
  const parent = tempDir()
  const project = path.join(parent, 'project')
  fs.mkdirSync(project)
  const bare = createBareRemote(parent)
  const githubUrl = 'https://github.com/tester/project.git'
  useLocalRemote(parent, bare, githubUrl)
  const fakeGh = writeFakeGh(parent)
  process.env.FAKE_GHP_AUTH = state.auth === false ? 'no' : 'ok'
  process.env.FAKE_GHP_REPO_EXISTS = state.repoExists === true ? '1' : '0'
  process.env.FAKE_GHP_PR_EXISTS = state.prExists === true ? '1' : '0'
  process.env.FAKE_GHP_RELEASE = state.releaseExists === true ? '1' : '0'
  process.env.FAKE_GHP_CHECKS = state.checks === undefined ? '' : JSON.stringify({ check_runs: state.checks })
  return { parent, project, bare, fakeGh, githubUrl }
}

/**
 * Count commits in one repository.
 * @param {string} cwd repository directory or bare path.
 * @param {boolean} [bare] whether the directory is bare.
 * @returns {number} commit count; 0 when the repository has no commits.
 */
function commitCount(cwd, bare = false) {
  const prefix = bare ? `git --git-dir '${cwd}'` : `git -C '${cwd}'`
  const result = run(`${prefix} rev-list --count HEAD`)
  return result.code === 0 ? Number(result.stdout.trim()) : 0
}

test('plan neither initializes nor commits', async () => {
  const f = fixture()
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  fs.writeFileSync(path.join(f.project, 'main.js'), 'console.log(1)\n')
  const result = await service.plan({ id: 'session-test' }, {}, new AbortController().signal)
  assert.equal(result.ok, true)
  assert.equal(result.isRepository, false)
  assert.equal(result.willInitRepo, true)
  assert.equal(result.willCreateRepo, true)
  assert.equal(result.changes.untracked, 1)
  assert.equal(fs.existsSync(path.join(f.project, '.git')), false)
})

test('apply publishes a new project: init, identity, commit, create repo, push', async () => {
  const f = fixture()
  const { ctx, tracked } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  fs.writeFileSync(path.join(f.project, 'main.js'), 'console.log(1)\n')
  const result = await service.apply({ id: 'session-test' }, { message: 'feat: initial project' }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.repository.nameWithOwner, 'tester/project')
  assert.equal(result.repository.created, true)
  assert.equal(result.commit.subject, 'feat: initial project')
  assert.match(result.commit.sha, /^[0-9a-f]{40}$/)
  assert.equal(result.pullRequest, null)
  assert.equal(result.tracking.bound, false)
  assert.equal(result.pushed.newCommit, true)
  assert.equal(result.pushed.upToDate, false)
  assert.equal(tracked.length, 0)
  assert.equal(commitCount(f.project), 1)
  const remoteHead = run(`git --git-dir '${f.bare}' rev-parse main`)
  assert.equal(remoteHead.code, 0)
  assert.match(remoteHead.stdout.trim(), /^[0-9a-f]{40}$/)
  const identityName = run(`git -C '${f.project}' config --local user.name`)
  assert.equal(identityName.stdout.trim(), 'Tester')
})

test('apply on a feature branch pushes and opens a tracked pull request', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' config --local user.name Tester`)
  run(`git -C '${f.project}' config --local user.email tester@example.com`)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  run(`git -C '${f.project}' switch -c feat`)
  fs.writeFileSync(path.join(f.project, 'feature.js'), 'export const x = 1\n')

  const { ctx, tracked } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, { message: 'feat: add feature' }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.branch, 'feat')
  assert.equal(result.baseBranch, 'main')
  assert.equal(result.pullRequest.url, 'https://github.com/tester/proj/pull/7')
  assert.equal(result.pullRequest.created, true)
  assert.equal(result.tracking.bound, true)
  assert.deepEqual(tracked, ['https://github.com/tester/proj/pull/7'])
  assert.equal(commitCount(f.project), 2)
  const remoteBranches = run(`git --git-dir '${f.bare}' branch --list feat`)
  assert.match(remoteBranches.stdout, /feat/)
})

test('a second apply creates no commit and reuses the open pull request', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' config --local user.name Tester`)
  run(`git -C '${f.project}' config --local user.email tester@example.com`)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  run(`git -C '${f.project}' switch -c feat`)
  fs.writeFileSync(path.join(f.project, 'feature.js'), 'export const x = 1\n')

  const { ctx, tracked } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const first = await service.apply({ id: 'session-test' }, { message: 'feat: add feature' }, new AbortController().signal)
  assert.equal(first.ok, true, JSON.stringify(first))
  process.env.FAKE_GHP_PR_EXISTS = '1'
  const second = await service.apply({ id: 'session-test' }, { message: 'feat: add feature' }, new AbortController().signal)
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.equal(second.commit.sha, first.commit.sha)
  assert.equal(second.pullRequest.created, false)
  assert.equal(second.pushed.upToDate, true)
  assert.equal(second.pushed.newCommit, false)
  assert.equal(commitCount(f.project), 2)
  assert.equal(tracked.length, 2)
})

test('detached HEAD pushes a branch created from HEAD', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  run(`git -C '${f.project}' checkout --detach`)
  fs.writeFileSync(path.join(f.project, 'detached.js'), 'export const detached = true\n')
  const { ctx, tracked } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, { branch: 'detached-work', message: 'feat: detached work' }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.branch, 'detached-work')
  assert.equal(result.pushed.newCommit, true)
  assert.equal(result.tracking.bound, true)
  const branches = run(`git -C '${f.project}' branch --list detached-work`)
  assert.match(branches.stdout, /detached-work/)
  assert.equal(tracked.length, 1)
})

test('an empty new project reports nothing-to-commit', async () => {
  const f = fixture()
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, {}, new AbortController().signal)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'nothing-to-commit')
  assert.equal(commitCount(f.project), 0)
})

test('push failures are classified with actionable codes', () => {
  const { ctx } = makeContext({ projectDir: tempDir() })
  const service = new GithubPushService(ctx, {})
  const classified = detail => service._pushError({ stdout: '', stderr: detail }, 'feat').code
  assert.equal(classified('! [rejected] feat -> feat (non-fast-forward)'), 'non-fast-forward')
  assert.equal(classified('fatal: Authentication failed for https://github.com/x/y.git'), 'push-auth-failed')
  assert.equal(classified('remote: Repository not found.'), 'repo-not-found')
  assert.equal(classified('some other failure'), 'push-failed')
})

test('read-only sessions, missing auth, and secret paths fail without committing', async () => {
  const readonly = fixture()
  const readonlyContext = makeContext({ projectDir: readonly.project, mode: 'read-only' })
  const readonlyService = new GithubPushService(readonlyContext.ctx, { ghCommand: readonly.fakeGh })
  const readonlyResult = await readonlyService.apply({ id: 'session-test' }, {}, new AbortController().signal)
  assert.equal(readonlyResult.ok, false)
  assert.equal(readonlyResult.error.code, 'read-only-session')

  const unauthorized = fixture({ auth: false })
  const unauthorizedContext = makeContext({ projectDir: unauthorized.project })
  const unauthorizedService = new GithubPushService(unauthorizedContext.ctx, { ghCommand: unauthorized.fakeGh })
  const unauthorizedResult = await unauthorizedService.apply({ id: 'session-test' }, {}, new AbortController().signal)
  assert.equal(unauthorizedResult.ok, false)
  assert.equal(unauthorizedResult.error.code, 'gh-not-authenticated')
  assert.equal(commitCount(unauthorized.project), 0)

  const secret = fixture()
  fs.writeFileSync(path.join(secret.project, '.env'), 'TOKEN=secret\n')
  const secretContext = makeContext({ projectDir: secret.project })
  const secretService = new GithubPushService(secretContext.ctx, { ghCommand: secret.fakeGh })
  const secretResult = await secretService.apply({ id: 'session-test' }, {}, new AbortController().signal)
  assert.equal(secretResult.ok, false)
  assert.equal(secretResult.error.code, 'secret-path-blocked')
  assert.equal(commitCount(secret.project), 0)
  assert.equal(fs.existsSync(path.join(secret.project, '.git')), true)
})

test('status reports bound change requests and tracking availability', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  const changeRequests = [{
    url: 'https://github.com/tester/project/pull/3',
    origin: 'tracked',
    update: {
      snapshot: {
        ref: { repository: {}, number: 3 },
        title: 'chore: demo',
        state: 'open',
        draft: false,
        checksRollup: 'success',
        reviewDecision: 'none',
        mergeability: 'mergeable',
        headBranch: 'feat',
      },
    },
  }]
  const { ctx } = makeContext({ projectDir: f.project, changeRequests })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.status({ id: 'session-test' })
  assert.equal(result.ok, true)
  assert.equal(result.trackingAvailable, true)
  assert.equal(result.changeRequests.length, 1)
  assert.equal(result.changeRequests[0].number, 3)
  assert.equal(result.changeRequests[0].checksRollup, 'success')
  assert.equal(result.branch, 'main')
})

test('feature branch policy pushes a dsh branch and opens a pull request from it', async () => {
  const f = fixture({ repoExists: true, checks: [{ name: 'build', status: 'completed', conclusion: 'success' }] })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  fs.writeFileSync(path.join(f.project, 'feature.js'), 'export const feature = true\n')
  const { ctx, tracked } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })

  const plan = await service.plan({ id: 'session-test' }, { branchPolicy: 'feature' }, new AbortController().signal)
  assert.equal(plan.ok, true, JSON.stringify(plan))
  assert.equal(plan.featureBranchPossible, true)
  assert.equal(plan.willCreateBranch, true)
  assert.match(plan.proposedBranch, /^dsh\/project$/)
  assert.equal(plan.baseBranch, 'main')

  const result = await service.apply({ id: 'session-test' }, { branchPolicy: 'feature', message: 'feat: feature policy' }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.match(result.branch, /^dsh\//)
  assert.equal(result.baseBranch, 'main')
  assert.equal(result.pullRequest.created, true)
  assert.equal(result.tracking.bound, true)
  assert.equal(result.checks.state, 'success')
  assert.equal(tracked.length, 1)
  const branches = run(`git -C '${f.project}' branch --list 'dsh/*'`)
  assert.match(branches.stdout, /dsh\//)
  const remoteBranches = run(`git --git-dir '${f.bare}' branch --list 'dsh/*'`)
  assert.match(remoteBranches.stdout, /dsh\//)
})

test('feature branch policy defers to the default branch when the repository is new', async () => {
  const f = fixture()
  fs.writeFileSync(path.join(f.project, 'main.js'), 'console.log(1)\n')
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, { branchPolicy: 'feature' }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.branch, 'main')
  assert.equal(result.pullRequest, null)
  assert.equal(result.repository.created, true)
  assert.match(result.warnings.join('\n'), /branchPolicy=feature needs an existing GitHub repository/)
})

test('status reports the checks of the checked-out commit', async () => {
  const f = fixture({ repoExists: true, checks: [
    { name: 'build', status: 'completed', conclusion: 'success' },
    { name: 'test', status: 'in_progress', conclusion: null },
  ] })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.status({ id: 'session-test' })
  assert.equal(result.ok, true)
  assert.match(result.commit.sha, /^[0-9a-f]{40}$/)
  assert.equal(result.checks.state, 'pending')
  assert.equal(result.checks.total, 2)
  assert.equal(result.checks.pending, 1)
})

test('tag and release are created after the push', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  fs.writeFileSync(path.join(f.project, 'release.js'), 'export const release = true\n')
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, {
    branchPolicy: 'feature',
    message: 'feat: release test',
    tag: 'v0.1.0-test',
    release: true,
  }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.branch, 'main')
  assert.equal(result.pullRequest, null)
  assert.equal(result.tag.name, 'v0.1.0-test')
  assert.equal(result.tag.pushed, true)
  assert.match(result.release.url, /releases\/tag\/v0\.1\.0-test$/)
  const localTags = run(`git -C '${f.project}' tag --list 'v0.1.0-test'`)
  assert.match(localTags.stdout, /v0\.1\.0-test/)
  const remoteTags = run(`git --git-dir '${f.bare}' tag --list 'v0.1.0-test'`)
  assert.match(remoteTags.stdout, /v0\.1\.0-test/)
  const branches = run(`git -C '${f.project}' branch --list 'dsh/*'`)
  assert.equal(branches.stdout.trim(), '')
})

test('tag/release on a non-default branch is refused before committing', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  run(`git -C '${f.project}' switch -c feat/release`)
  fs.writeFileSync(path.join(f.project, 'release-branch.js'), 'export const x = 1\n')
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, {
    branchPolicy: 'current',
    message: 'feat: should not commit',
    tag: 'v9.9.9',
  }, new AbortController().signal)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'release-requires-default-branch')
  assert.equal(commitCount(f.project), 1)
  const tags = run(`git -C '${f.project}' tag --list 'v9.9.9'`)
  assert.equal(tags.stdout.trim(), '')
})

test('tag without release pushes only the tag', async () => {
  const f = fixture({ repoExists: true })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  fs.writeFileSync(path.join(f.project, 'tag-only.js'), 'export const tagged = true\n')
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.apply({ id: 'session-test' }, {
    branchPolicy: 'current',
    message: 'chore: tag only',
    tag: 'v0.0.1-tag-only',
    release: false,
  }, new AbortController().signal)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.tag.name, 'v0.0.1-tag-only')
  assert.equal(result.release, null)
  const remoteTags = run(`git --git-dir '${f.bare}' tag --list 'v0.0.1-tag-only'`)
  assert.match(remoteTags.stdout, /v0\.0\.1-tag-only/)
})

test('graph reports commits, bound pull requests, and checks', async () => {
  const f = fixture({ repoExists: true, checks: [{ name: 'build', status: 'completed', conclusion: 'success' }] })
  initProject(f.project)
  run(`git -C '${f.project}' remote add origin '${f.githubUrl}'`)
  const headSha = run(`git -C '${f.project}' rev-parse HEAD`).stdout.trim()
  const changeRequests = [{
    url: 'https://github.com/tester/project/pull/9',
    origin: 'tracked',
    update: {
      snapshot: {
        ref: { repository: {}, number: 9 },
        title: 'feat: graph',
        state: 'open',
        draft: false,
        headBranch: 'main',
        headSha,
        baseBranch: 'main',
        checksRollup: 'success',
        reviewDecision: 'none',
        mergeability: 'mergeable',
      },
    },
  }]
  const { ctx } = makeContext({ projectDir: f.project, changeRequests })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.graph({ id: 'session-test' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.isRepository, true)
  assert.equal(result.repository.nameWithOwner, 'tester/project')
  assert.equal(result.branch, 'main')
  assert.ok(result.commits.length >= 1)
  assert.equal(result.commits[0].sha, headSha)
  assert.equal(result.pullRequests.length, 1)
  assert.equal(result.pullRequests[0].headSha, headSha)
  assert.equal(result.pullRequests[0].number, 9)
  assert.equal(result.checks.state, 'success')
})

test('graph returns an empty state outside a repository', async () => {
  const f = fixture()
  const { ctx } = makeContext({ projectDir: f.project })
  const service = new GithubPushService(ctx, { ghCommand: f.fakeGh })
  const result = await service.graph({ id: 'session-test' })
  assert.equal(result.ok, true)
  assert.equal(result.isRepository, false)
  assert.deepEqual(result.commits, [])
  assert.equal(result.repository, null)
})
