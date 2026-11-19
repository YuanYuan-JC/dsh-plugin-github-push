import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { Git } from '../src/git.js'
import { createBareRemote, createRealShell, run, tempDir, useLocalRemote } from './helpers.mjs'

/**
 * Build a Git instance backed by the real local shell executor.
 * @param {string} cwd working directory.
 * @returns {Git} adapter.
 */
function gitAt(cwd) {
  const shell = createRealShell()
  const runCommand = async invocation => {
    const spec = shell.resolve(invocation)
    const handle = await shell.execute(spec)
    const result = await handle.result()
    return {
      code: result.exitCode,
      stdout: result.stdout.text,
      stderr: result.stderr.text,
      timedOut: result.timedOut,
      aborted: result.aborted,
    }
  }
  return new Git({ run: runCommand, cwd, config: { gitCommand: 'git', timeoutMs: 60000, pushTimeoutMs: 60000 } })
}

test('Git adapter commits and pushes through a rewritten local remote', async () => {
  const parent = tempDir()
  const project = path.join(parent, 'project')
  fs.mkdirSync(project)
  const git = gitAt(project)
  const version = await git.version()
  assert.equal(version.code, 0)
  assert.match(version.stdout, /git version/)

  const init = await git.init()
  assert.equal(init.code, 0)
  assert.equal((await git.branch(project)).branch, 'main')

  const initialStatus = await git.status(project)
  assert.equal(initialStatus.dirty, false)

  fs.writeFileSync(path.join(project, 'README.md'), '# hello\n')
  const added = await git.addAll(project)
  assert.equal(added.code, 0)
  assert.equal(await git.hasStagedChanges(project), true)
  assert.deepEqual(await git.stagedFiles(project), ['README.md'])
  assert.deepEqual(await git.stagedStat(project), { files: 1, insertions: 1, deletions: 0 })

  const staged = await git.status(project)
  assert.equal(staged.staged, 1)

  const configured = await git.configureIdentity(project, 'Tester', 'tester@example.com')
  assert.equal(configured.code, 0)
  const identity = await git.identity(project)
  assert.deepEqual(identity, { name: 'Tester', email: 'tester@example.com' })

  const committed = await git.commit(project, 'feat: initial commit\n\nBody line.\n')
  assert.equal(committed.code, 0)
  const head = await git.headCommit(project)
  assert.match(head.sha, /^[0-9a-f]{40}$/)
  assert.equal(head.subject, 'feat: initial commit')
  assert.equal(await git.hasStagedChanges(project), false)

  const bare = createBareRemote(parent)
  const githubUrl = 'https://github.com/tester/project.git'
  useLocalRemote(parent, bare, githubUrl)
  const remoteAdded = await git.addRemote(project, 'origin', githubUrl)
  assert.equal(remoteAdded.code, 0)
  const pushed = await git.push(project, { remote: 'origin', branch: 'main', force: false })
  assert.equal(pushed.code, 0, pushed.stderr)

  const remoteHead = run(`git --git-dir '${bare}' rev-parse main`)
  assert.equal(remoteHead.code, 0)
  assert.equal(remoteHead.stdout.trim(), head.sha)
  const divergence = await git.aheadBehind(project, 'origin/main')
  assert.equal(divergence.ahead, 0)
  assert.equal(await git.branchExists(project, 'main'), true)
  assert.equal(await git.branchExists(project, 'feat'), false)
})
