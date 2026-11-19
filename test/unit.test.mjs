import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeConfig } from '../src/config.js'
import { parseLogOutput, parseShortStat, parseStatus } from '../src/git.js'
import { Github } from '../src/github.js'
import { chooseMessage, prBody, prTitle, templateMessage } from '../src/message.js'
import { normalizeOptions, optionsFromCommand } from '../src/options.js'
import { branchSegment, deniedBy, featureBranchName, hostAllowed, isInside, matchesGlob, ownerAllowed, parseRemote, repositoryName } from '../src/policy.js'
import { clip, describeStat, jsonSafe, normalizeMessage, redact, shellQuote, splitNul } from '../src/util.js'
import { summarizeResult } from '../src/service.js'

test('parseRemote understands https, ssh, and scp forms', () => {
  assert.deepEqual(parseRemote('https://github.com/acme/widget.git'), {
    host: 'github.com',
    owner: 'acme',
    name: 'widget',
    webUrl: 'https://github.com/acme/widget',
    httpsUrl: 'https://github.com/acme/widget.git',
  })
  assert.equal(parseRemote('git@github.com:acme/widget.git').name, 'widget')
  assert.equal(parseRemote('ssh://git@github.com/acme/widget').owner, 'acme')
  assert.equal(parseRemote('git://github.com/acme/widget.git').host, 'github.com')
  assert.equal(parseRemote('/tmp/local/repo.git'), null)
  assert.equal(parseRemote(''), null)
})

test('host, owner, and path policy', () => {
  assert.equal(hostAllowed('GitHub.com', ['github.com']), true)
  assert.equal(hostAllowed('ghe.example.com', ['github.com']), false)
  assert.equal(ownerAllowed('tester', [], 'tester'), true)
  assert.equal(ownerAllowed('other', [], 'tester'), false)
  assert.equal(ownerAllowed('other', ['other'], 'tester'), true)
  assert.equal(isInside('/work', '/work/project'), true)
  assert.equal(isInside('/work', '/other/project'), false)
  assert.equal(matchesGlob('.env', '.env'), true)
  assert.equal(matchesGlob('config/.env', '.env'), false)
  assert.equal(matchesGlob('secret.pem', '*.pem'), true)
  assert.equal(deniedBy('config/.env', ['.env', '*.pem'], []), '.env')
  assert.equal(deniedBy('keys/secret.pem', ['.env', '*.pem'], []), '*.pem')
  assert.equal(deniedBy('keys/secret.pem', ['.env', '*.pem'], ['keys/*.pem']), undefined)
  assert.equal(repositoryName('/tmp/My Project!'), 'My-Project-')
})

test('shell quoting, redaction, and JSON safety', () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`)
  assert.match(redact('token ghp_' + 'a'.repeat(30)), /\[redacted\]/)
  assert.match(redact('https://user:pass@github.com/x'), /https:\/\/\[redacted\]@github\.com/)
  assert.deepEqual(jsonSafe({ a: undefined, b: [1, Number.NaN], c: { d: undefined, e: 'x' } }), { b: [1, null], c: { e: 'x' } })
  assert.equal(splitNul('a\0b\0').length, 2)
  assert.equal(clip('abcdef', 3).text.startsWith('abc'), true)
  assert.equal(clip('abc', 10).truncated, false)
})

test('message, stat, and trimming helpers', () => {
  assert.equal(templateMessage({ files: 0, branch: 'main' }), 'chore: sync branch with GitHub')
  assert.equal(templateMessage({ files: 2, branch: 'main' }), 'chore: update 2 files')
  assert.equal(chooseMessage({ message: '  feat: x  ', files: 3, branch: 'main' }), 'feat: x')
  assert.equal(describeStat({ files: 0, insertions: 0, deletions: 0 }), 'no staged changes')
  assert.equal(prTitle(''), 'Update project from DeepSeek Harness')
  assert.match(prBody({ subject: 'feat: x', stat: { files: 1, insertions: 2, deletions: 0 }, branch: 'feat' }), /Branch: `feat`/)
  assert.equal(normalizeMessage('  a\r\nb  '), 'a\nb')
})

test('tool option validation', () => {
  assert.deepEqual(normalizeOptions({}), { action: 'apply' })
  assert.deepEqual(normalizeOptions({ dryRun: true }), { action: 'plan' })
  assert.deepEqual(normalizeOptions({ action: 'status' }), { action: 'status' })
  assert.deepEqual(normalizeOptions({ message: 'fix: x', visibility: 'public', createPr: false }), {
    action: 'apply', message: 'fix: x', visibility: 'public', createPr: false,
  })
  assert.deepEqual(normalizeOptions({ branchPolicy: 'feature' }), { action: 'apply', branchPolicy: 'feature' })
  assert.deepEqual(normalizeOptions({ tag: 'v1.2.0', release: true }), { action: 'apply', tag: 'v1.2.0', release: true })
  assert.throws(() => normalizeOptions({ tag: 'bad tag' }), /tag must be/)
  assert.throws(() => normalizeOptions({ tag: '-v1' }), /tag must be/)
  assert.throws(() => normalizeOptions({ branchPolicy: 'other' }), /branchPolicy must be/)
  assert.throws(() => normalizeOptions({ action: 'delete' }), /action must be/)
  assert.throws(() => normalizeOptions({ branch: '--upload-pack=x' }), /branch must be/)
  assert.throws(() => normalizeOptions({ visibility: 'internal' }), /visibility must be/)
  assert.deepEqual(optionsFromCommand('  fix: x '), { action: 'apply', message: 'fix: x' })
  assert.deepEqual(optionsFromCommand(''), { action: 'apply' })
})

test('configuration defaults and warnings', () => {
  const defaults = normalizeConfig(undefined)
  assert.equal(defaults.config.visibility, 'private')
  assert.equal(defaults.config.createPullRequest, true)
  assert.equal(defaults.config.remoteName, 'origin')
  assert.equal(defaults.config.hosts[0], 'github.com')
  const overridden = normalizeConfig({ visibility: 'private', allowedOwners: ['ACME'], timeoutMs: -1, hosts: ['ghe.example.com'] })
  assert.equal(overridden.config.hosts[0], 'ghe.example.com')
  assert.deepEqual(overridden.config.allowedOwners, ['acme'])
  assert.equal(overridden.config.timeoutMs, 120000)
  assert.equal(normalizeConfig(undefined).config.branchPolicy, 'feature')
  assert.equal(normalizeConfig(undefined).config.branchNaming, 'public')
  assert.equal(normalizeConfig({ branchNaming: 'bilingual' }).config.branchNaming, 'bilingual')
  assert.equal(normalizeConfig({ branchPolicy: 'current' }).config.branchPolicy, 'current')
  assert.equal(normalizeConfig({ branchPolicy: 'nope' }).config.branchPolicy, 'feature')
})

test('feature branch names and check parsing', async () => {
  assert.equal(featureBranchName('推送到 GitHub/Push to GitHub'), 'dsh/推送到-GitHub/Push-to-GitHub')
  assert.equal(featureBranchName('github-push'), 'dsh/github-push')
  assert.equal(featureBranchName(''), 'dsh/project')
  assert.equal(branchSegment('  a/b:c  '), 'a-b-c')
  assert.equal(branchSegment('..dsh..name..'), 'dsh.name')

  const run = async invocation => {
    if (invocation.command.includes('/check-runs')) {
      return {
        code: 0,
        stdout: JSON.stringify({ check_runs: [
          { name: 'build', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'in_progress', conclusion: null },
        ] }),
        stderr: '',
      }
    }
    if (invocation.command.includes('/statuses')) {
      return { code: 0, stdout: JSON.stringify([{ context: 'lint', state: 'success' }]), stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  }
  const github = new Github({ run, cwd: '/tmp', config: { ghCommand: 'gh', timeoutMs: 1000 } })
  const checks = await github.commitChecks('tester/project', 'a'.repeat(40))
  assert.equal(checks.total, 3)
  assert.equal(checks.passed, 2)
  assert.equal(checks.pending, 1)
  assert.equal(checks.failed, 0)
  assert.equal(checks.state, 'pending')
  assert.equal(checks.runs.length, 3)

  const failing = new Github({
    run: async invocation => invocation.command.includes('/check-runs')
      ? { code: 0, stdout: JSON.stringify({ check_runs: [{ name: 'build', status: 'completed', conclusion: 'failure' }] }), stderr: '' }
      : { code: 0, stdout: '[]', stderr: '' },
    cwd: '/tmp',
    config: { ghCommand: 'gh', timeoutMs: 1000 },
  })
  assert.equal((await failing.commitChecks('tester/project', 'b'.repeat(40))).state, 'failure')
})

test('result summaries cover plan, apply, status, and failures', () => {
  assert.match(summarizeResult({
    ok: true,
    action: 'status',
    cwd: '/work',
    isRepository: false,
    repository: null,
    branch: null,
    changeRequests: [],
    warnings: [],
  }), /Not a Git repository/)
  assert.match(summarizeResult({ ok: false, error: { code: 'busy', message: 'busy', hint: 'wait' } }), /busy: busy Hint: wait/)
  assert.match(summarizeResult({
    ok: true,
    action: 'apply',
    repository: { nameWithOwner: 'a/b' },
    branch: 'feat',
    commit: { shortSha: 'abc1234', subject: 'feat: x' },
    pushed: { newCommit: true, upToDate: false, commitUrl: 'https://github.com/a/b/commit/x' },
    pullRequest: { url: 'https://github.com/a/b/pull/1' },
    tracking: { bound: true },
    warnings: [],
  }), /Pull request: https:\/\/github\.com\/a\/b\/pull\/1/)
})

test('parseLogOutput reads NUL fields and record separators', () => {
  const record = [
    'a'.repeat(40), 'aaaaaaa', `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Ada', '2026-11-19T12:00:00+08:00', 'feat: graph', 'HEAD -> main, origin/main',
  ].join('\x00')
  const commits = parseLogOutput(`\n${record}\x1e${['d'.repeat(40), 'ddddddd', '', 'Bob', '2026-11-18T09:00:00+08:00', 'chore: init', ''].join('\x00')}\x1e`)
  assert.equal(commits.length, 2)
  assert.equal(commits[0].shortSha, 'aaaaaaa')
  assert.deepEqual(commits[0].parents, ['b'.repeat(40), 'c'.repeat(40)])
  assert.deepEqual(commits[0].refs, ['HEAD -> main', 'origin/main'])
  assert.equal(commits[0].subject, 'feat: graph')
  assert.deepEqual(commits[1].parents, [])
})

test('git status and shortstat parsers', () => {
  const status = parseStatus([
    '# branch.oid abcdef',
    '# branch.head feat',
    '# branch.upstream origin/feat',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 aaa bbb file.txt',
    '? new.txt',
  ].join('\n'))
  assert.equal(status.branch, 'feat')
  assert.equal(status.upstream, 'origin/feat')
  assert.equal(status.ahead, 2)
  assert.equal(status.behind, 1)
  assert.equal(status.dirty, true)
  assert.equal(status.staged, 1)
  assert.equal(status.untracked, 1)
  const detached = parseStatus('# branch.head (detached)')
  assert.equal(detached.detached, true)
  assert.deepEqual(parseShortStat(' 2 files changed, 10 insertions(+), 3 deletions(-)'), { files: 2, insertions: 10, deletions: 3 })
  assert.deepEqual(parseShortStat(''), { files: 0, insertions: 0, deletions: 0 })
})
