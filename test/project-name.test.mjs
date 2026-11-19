import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { asciiSlug, projectDisplayName } from '../src/project-name.js'

/**
 * Create a temporary project directory.
 * @returns {string} absolute path.
 */
function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ghp-name-'))
}

/**
 * Write one file under a project.
 * @param {string} root project root.
 * @param {string} relative relative path.
 * @param {string} content file content.
 * @returns {void}
 */
function write(root, relative, content) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

test('display name prefers Chinese and English plugin titles', () => {
  const root = tempProject()
  write(root, 'locale/zh.json', JSON.stringify({ meta: { title: '推送到 GitHub' } }))
  write(root, 'locale/en.json', JSON.stringify({ meta: { title: 'Push to GitHub' } }))
  write(root, 'package.json', JSON.stringify({ name: 'dsh-plugin-github-push' }))
  assert.equal(projectDisplayName(root), 'github-push')
  assert.equal(projectDisplayName(root, 'bilingual'), '推送到 GitHub/Push to GitHub')
})

test('display name falls back to one title, then package name, then directory', () => {
  const zhOnly = tempProject()
  write(zhOnly, 'locale/zh.json', JSON.stringify({ meta: { title: '消息编辑' } }))
  write(zhOnly, 'package.json', JSON.stringify({ name: '@local/message-edit' }))
  assert.equal(projectDisplayName(zhOnly), 'message-edit')
  assert.equal(projectDisplayName(zhOnly, 'bilingual'), '消息编辑')

  const packaged = tempProject()
  write(packaged, 'package.json', JSON.stringify({ name: 'dsh-plugin-github-push' }))
  assert.equal(projectDisplayName(packaged), 'github-push')

  const bare = tempProject()
  assert.equal(projectDisplayName(bare), asciiSlug(path.basename(bare)))

  const malformed = tempProject()
  write(malformed, 'package.json', '{not json')
  assert.equal(projectDisplayName(malformed), asciiSlug(path.basename(malformed)))
  assert.equal(asciiSlug('My Plugin!'), 'my-plugin')
  assert.equal(asciiSlug('推送到 GitHub'), 'github')
})
