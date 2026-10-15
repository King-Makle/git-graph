import { test, expect } from 'claude-code/testing'

import type { ChangedFile } from '../types'
import { BASES, DIFF_MAX, branchPrompt, capDiff, commitPrompt, describeCommands, parseDraft, parseSummary, unwrap, writeReadiness } from './draft'

const f = (path: string, status: ChangedFile['status'], isStaged = false, extra: Partial<ChangedFile> = {}): ChangedFile => ({ path, status, isStaged, isUnstaged: !isStaged, ...extra })

test('capDiff keeps a short diff whole and cuts a long one at a file boundary, counting what it dropped', () => {
  const file = (name: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-${'x'.repeat(40)}\n+${'y'.repeat(40)}\n`
  const small = file('a.ts') + file('b.ts')
  expect(capDiff(small, 10_000)).toEqual({ text: small, dropped: 0 })
  const cut = capDiff(file('a.ts') + file('b.ts') + file('c.ts'), file('a.ts').length * 2 + 5)
  expect(cut.text).toBe(file('a.ts') + file('b.ts'))
  expect(cut.dropped).toBe(1)
})

test('capDiff trims a single file larger than the cap at a line, never mid-line', () => {
  const huge = `diff --git a/a b/a\n${'+line of text\n'.repeat(2000)}`
  const cut = capDiff(huge, 500)
  expect(cut.text.length).toBeLessThanOrEqual(500)
  expect(cut.text.endsWith('\n')).toBe(true)
  expect(cut.dropped).toBe(0)
  expect(DIFF_MAX).toBeGreaterThan(1000)
})

test('commitPrompt carries the diff, the changed files and the repository\'s recent subjects, and asks for a subject plus a body', () => {
  const prompt = commitPrompt({ stat: ' a.ts | 2 +-', diff: 'diff --git a/a.ts b/a.ts', recent: ['Add the thing', 'Fix the other'], untracked: ['new.ts'], dropped: 0 })
  expect(prompt).toContain('72')
  expect(prompt).toMatch(/body/i)
  expect(prompt).toContain('- Add the thing')
  expect(prompt).toContain('- Fix the other')
  expect(prompt).toContain('a.ts | 2 +-')
  expect(prompt).toContain('diff --git a/a.ts b/a.ts')
  expect(prompt).toContain('new.ts')
  expect(prompt).not.toMatch(/more files/)
  expect(commitPrompt({ stat: '', diff: 'd', recent: [], untracked: [], dropped: 3 })).toMatch(/3 more files/)
})

test('parseDraft strips fences, quotes and a label, and puts one blank line between subject and body', () => {
  expect(parseDraft('Add search\n\nFilters the graph.')).toBe('Add search\n\nFilters the graph.')
  expect(parseDraft('```\nAdd search\n\nFilters the graph.\n```')).toBe('Add search\n\nFilters the graph.')
  expect(parseDraft('```text\nAdd search\n```')).toBe('Add search')
  expect(parseDraft('"Add search"')).toBe('Add search')
  expect(parseDraft('Commit message: Add search\nBecause.')).toBe('Add search\n\nBecause.')
  expect(parseDraft('Add search\n\n\n\nOne.\n\n\n\nTwo.  \n')).toBe('Add search\n\nOne.\n\nTwo.')
  expect(parseDraft('   \n')).toBe('')
})

test('writeReadiness names what is missing and never overwrites a message the person typed', () => {
  expect(writeReadiness({ message: '', files: [] })).toEqual({ isReady: false, why: 'Nothing to describe.' })
  expect(writeReadiness({ message: 'mine', files: [f('a', 'M')] })).toEqual({ isReady: false, why: 'Clear the message first.' })
  expect(writeReadiness({ message: '  \n', files: [f('a', 'M')] })).toEqual({ isReady: true, why: null })
})

test('describeCommands reads the ticked files, as Commit takes them, and every file when none is ticked', () => {
  const ticked = describeCommands([f('a.ts', 'M'), f('b.ts', 'M'), f('dir/new.ts', 'U')], ['a.ts', 'dir/new.ts'])
  expect(ticked.stat).toEqual(['git', 'diff', 'HEAD', '--stat', '--', 'a.ts'])
  expect(ticked.diffs).toEqual([['git', 'diff', 'HEAD', '--', 'a.ts'], ['git', 'diff', '--no-index', '--', '/dev/null', 'dir/new.ts']])
  expect(ticked.untracked).toEqual(['dir/new.ts'])
  const all = describeCommands([f('a.ts', 'M'), f('dir/b.ts', 'U'), f('c.ts', 'A')], [])
  expect(all.stat).toEqual(['git', 'diff', 'HEAD', '--stat'])
  expect(all.diffs).toEqual([['git', 'diff', 'HEAD'], ['git', 'diff', '--no-index', '--', '/dev/null', 'dir/b.ts']])
  expect(all.untracked).toEqual(['dir/b.ts'])
  // A renamed file is read by both names, or its deletion would be missing from the diff.
  expect(describeCommands([f('new.md', 'M', true, { orig: 'old.md' })], ['new.md']).diffs).toEqual([['git', 'diff', 'HEAD', '--', 'new.md', 'old.md']])
  // Only new files: there is no tracked diff to ask for.
  expect(describeCommands([f('b.ts', 'U')], []).diffs).toEqual([['git', 'diff', '--no-index', '--', '/dev/null', 'b.ts']])
  // Past eight new files the rest are names only.
  const many = describeCommands(Array.from({ length: 12 }, (_, i) => f(`n${i}.ts`, 'U')), [])
  expect(many.diffs).toHaveLength(8)
  expect(many.untracked).toHaveLength(12)
})

test('branchPrompt names the base and the head and carries their commits and diff', () => {
  const prompt = branchPrompt({ base: 'origin/main', head: 'feature', commits: ['Add search', 'Fix it'], stat: ' a.ts | 2 +-', diff: 'diff --git a/a.ts b/a.ts', dropped: 0 })
  expect(prompt).toContain('origin/main')
  expect(prompt).toContain('feature')
  expect(prompt).toContain('- Add search')
  expect(prompt).toContain('diff --git a/a.ts b/a.ts')
  expect(prompt).toMatch(/title/i)
  expect(BASES[0]).toBe('origin/main')
})

test('parseSummary splits a title from its description and drops a heading or label', () => {
  expect(parseSummary('Add search\n\nFilters the graph.\n- one\n- two')).toEqual({ title: 'Add search', description: 'Filters the graph.\n- one\n- two' })
  expect(parseSummary('```\nAdd search\n\nBody.\n```')).toEqual({ title: 'Add search', description: 'Body.' })
  expect(parseSummary('# Add search\n\n## Description\n\nBody.')).toEqual({ title: 'Add search', description: 'Body.' })
  expect(parseSummary('Title: **Add search**\n\nDescription:\nBody.')).toEqual({ title: 'Add search', description: 'Body.' })
  expect(parseSummary('Only a title')).toEqual({ title: 'Only a title', description: '' })
  expect(parseSummary('  ')).toEqual({ title: '', description: '' })
})

test('unwrap joins the lines of a paragraph a model wrapped, and keeps blank lines, list items and indented lines', () => {
  expect(unwrap('One sentence that was\nwrapped by the model\nacross three lines.')).toBe('One sentence that was wrapped by the model across three lines.')
  expect(unwrap('First paragraph\nwrapped.\n\nSecond paragraph\nwrapped.')).toBe('First paragraph wrapped.\n\nSecond paragraph wrapped.')
  expect(unwrap('Intro line\n- one\n- two that\nwraps\n1. numbered')).toBe('Intro line\n- one\n- two that wraps\n1. numbered')
  // A model sometimes indents a wrapped row; that is still the same paragraph. A nested list item is not.
  expect(unwrap('A sentence that wraps to\n  reflect the rest.')).toBe('A sentence that wraps to reflect the rest.')
  expect(unwrap('- parent\n  - child\n  - child two')).toBe('- parent\n  - child\n  - child two')
  expect(unwrap('')).toBe('')
})

test('a drafted commit message is one continuous body, not a line per wrapped row', () => {
  const reply = 'Add search to the graph\n\nFilters the history by message, author, hash\nand path, which also keeps the drawing under\nthe pressable budget.'
  expect(parseDraft(reply)).toBe('Add search to the graph\n\nFilters the history by message, author, hash and path, which also keeps the drawing under the pressable budget.')
  expect(commitPrompt({ stat: '', diff: 'd', recent: [], untracked: [], dropped: 0 })).not.toMatch(/wrapped at/i)
})

test('a drafted PR description is unwrapped too, its bullets kept', () => {
  expect(parseSummary('Add search\n\nFilters the history by\nmessage and author.\n- one\n- two')).toEqual({ title: 'Add search', description: 'Filters the history by message and author.\n- one\n- two' })
})
