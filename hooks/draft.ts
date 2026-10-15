import type { ChangedFile } from '../types'
import { diffCommand } from './actions'

/** The most of a diff the model is sent; the file list beside it still names every file. */
export const DIFF_MAX = 40_000
/** The most of `--stat` sent. */
export const STAT_MAX = 3_000
/** New files whose content is sent; the rest are named only. */
const NEW_FILES = 8
/** The default branch, in the order tried when `origin/HEAD` is not set. */
export const BASES = ['origin/main', 'origin/master', 'main', 'master'] as const

/** The diff cut at a file boundary: whole files while they fit, one file trimmed at a line when even the first is too big. `dropped` counts the files left out. */
export function capDiff(diff: string, max = DIFF_MAX): { text: string; dropped: number } {
  if (diff.length <= max) return { text: diff, dropped: 0 }
  const parts = diff.split(/(?=^diff --git )/m)
  let text = ''
  let kept = 0
  for (const part of parts) {
    if (text.length + part.length > max) break
    text += part
    kept++
  }
  if (kept === 0) {
    const head = diff.slice(0, max)
    text = head.slice(0, head.lastIndexOf('\n') + 1)
    kept = 1
  }
  return { text, dropped: parts.length - kept }
}

/** Whether ✎ may write: it never replaces a message the person typed. */
export function writeReadiness(model: { message: string; files: ChangedFile[] }): { isReady: boolean; why: string | null } {
  if (model.files.length === 0) return { isReady: false, why: 'Nothing to describe.' }
  if (model.message.trim().length > 0) return { isReady: false, why: 'Clear the message first.' }
  return { isReady: true, why: null }
}

/** What to read for the message, as Commit would take it: the ticked files, or every file when none is ticked. */
export function describeCommands(files: ChangedFile[], ticked: string[]): { stat: string[]; diffs: string[][]; untracked: string[] } {
  const picked = files.filter(file => ticked.includes(file.path))
  const chosen = picked.length > 0 ? picked : files
  const fresh = chosen.filter(file => file.status === 'U')
  const tracked = chosen.filter(file => file.status !== 'U')
  const paths = tracked.flatMap(file => (file.orig === undefined ? [file.path] : [file.path, file.orig]))
  const scope = picked.length > 0 ? ['--', ...paths] : []
  const diffs = [...(tracked.length > 0 ? [['git', 'diff', 'HEAD', ...scope]] : []), ...fresh.slice(0, NEW_FILES).map(diffCommand)]
  return { stat: ['git', 'diff', 'HEAD', '--stat', ...(tracked.length > 0 ? scope : [])], diffs, untracked: fresh.map(file => file.path) }
}

const list = (lines: string[]): string => lines.map(line => `- ${line}`).join('\n')

export function commitPrompt(input: { stat: string; diff: string; recent: string[]; untracked: string[]; dropped: number }): string {
  const parts = [
    'Write a git commit message for the changes below.',
    '',
    'Format:',
    '- Line 1: a subject of at most 72 characters, imperative mood ("Add", "Fix"), no trailing period.',
    '- A blank line.',
    '- A body of one short paragraph (2 to 4 sentences) saying what changed and why, written as continuous text with no line breaks inside it. Plain text: no markdown, no headings. Leave the body out only for a one-line change such as a typo.',
    'Reply with the message and nothing else.',
  ]
  if (input.recent.length > 0) parts.push('', "This repository's recent subjects, for style:", list(input.recent))
  if (input.stat.trim().length > 0) parts.push('', 'Changed files:', input.stat.trim().slice(0, STAT_MAX))
  if (input.untracked.length > 0) parts.push('', 'New files:', list(input.untracked))
  parts.push('', 'Diff:', input.diff)
  if (input.dropped > 0) parts.push('', `[${input.dropped} more files left out of the diff]`)
  return parts.join('\n')
}

/** The model's reply as a commit message: no fence, quotes or label around it, one blank line between subject and body. */
export function parseDraft(reply: string): string {
  const text = unquote(unfence(reply.trim())).replace(/^(commit message|message)\s*:\s*/i, '')
  const [subject = '', ...rest] = text.split('\n').map(line => line.trimEnd())
  const body = unwrap(collapse(rest.join('\n')))
  return body.length > 0 ? `${subject.trim()}\n\n${body}` : subject.trim()
}

export function branchPrompt(input: { base: string; head: string; commits: string[]; stat: string; diff: string; dropped: number }): string {
  const parts = [
    `Write a pull request title and description for the branch ${input.head || 'HEAD'}, which is ahead of ${input.base}.`,
    '',
    'Format:',
    '- Line 1: the title, at most 72 characters, imperative mood, no trailing period.',
    '- A blank line.',
    '- The description: a short paragraph on what the branch does and why, then a bullet list of the main changes. Markdown is fine.',
    'Reply with the title and description and nothing else.',
    '',
    `Commits (newest first):`,
    list(input.commits),
  ]
  if (input.stat.trim().length > 0) parts.push('', 'Changed files:', input.stat.trim().slice(0, STAT_MAX))
  parts.push('', 'Diff:', input.diff)
  if (input.dropped > 0) parts.push('', `[${input.dropped} more files left out of the diff]`)
  return parts.join('\n')
}

/** The model's reply as a title and a description: a heading, label or emphasis around the title, and a "Description" line before the body, are dropped. */
export function parseSummary(reply: string): { title: string; description: string } {
  const lines = unfence(reply.trim()).split('\n')
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
  const first = lines.shift()
  if (first === undefined) return { title: '', description: '' }
  const title = unquote(first.replace(/^#+\s*/, '').replace(/^title\s*:\s*/i, '').trim().replace(/^\*\*([\s\S]*)\*\*$/, '$1')).trim()
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
  if (lines.length > 0 && /^(#+\s*)?(description|summary)\s*:?\s*$/i.test(lines[0]!.trim())) lines.shift()
  return { title, description: unwrap(collapse(lines.join('\n'))) }
}

/**
 * The lines of each paragraph joined with a space. A model that wraps at 72 columns leaves hard newlines, and the message box
 * would show each as its own line. A blank line and a list item (`- `, `* `, `1. `, nested or not) still start a new line; an indented row that is no list item is a wrapped row and is joined.
 */
export function unwrap(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1]
    const startsLine = line.trim() === '' || /^\s*([-*\u2022]|\d+[.)])\s/.test(line)
    if (prev === undefined || prev.trim() === '' || startsLine) out.push(line)
    else out[out.length - 1] = `${prev} ${line.trim()}`
  }
  return out.join('\n')
}

/** The text inside a fenced block when the reply is one. */
function unfence(text: string): string {
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(text)
  return fence ? fence[1]!.trim() : text
}

/** The text without one pair of quotes around all of it. */
function unquote(text: string): string {
  return text.length > 1 && /^["'`]/.test(text) && text[text.length - 1] === text[0] ? text.slice(1, -1).trim() : text
}

/** Trailing spaces gone, runs of blank lines folded to one, the ends trimmed. */
function collapse(text: string): string {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
