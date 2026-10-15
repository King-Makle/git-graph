import { FILE_ROWS } from './changes'
import { STASH_ROWS } from './stashes'

/** The most pressable elements a drawing may hold: 222 drew on the live desktop, 274 did not. */
export const CEILING = 222
/** The worst case of everything else: header (9, with the branch button and the Worktrees button), Changes row (4), Stage and Unstage all (2), a discard and a drop confirm (4), the card's close, copy and files toggle (3), the PR card's refresh, merge or merge and cancel, and close (4; the Summary card's copy, close and Create PR never draw beside it), eight actions plus delete and rename for two branches (12), the incoming band's Pull (1), the History view chip (1), the Teammates card's refresh, twelve rows and two actions (15), History's Show more (1). The reference panel's buttons are counted by `budget` while it is open. */
export const FIXED = 58
const MAX_COMMITS = 150
/** Commits History draws at first and each time Show more is pressed. */
export const HISTORY_STEP = 25
/** The most commits the pane loads: Show more ends here. */
export const HISTORY_LOADED = MAX_COMMITS
const MIN_COMMITS = 40
const MAX_TOGGLES = 60

/** The Branches card's rows at first and per Show More; fewer when the rest of the drawing leaves less room. */
export const BRANCH_ROWS = 12

/**
 * How many commit rows, card diff toggles and Branches card rows fit beside the file rows (both groups) and stash rows,
 * each of which costs three. `branches` is the number of Branches card rows asked for while it is open (absent when
 * shut): its rows cost two each (switch and delete, or rename), its close and Show More one each, and they shrink
 * before the commits fall under their floor. `worktrees` is the Worktrees card's row count while it is open: its close
 * and up to three buttons a row (open, copy path, remove); past what fits, `worktreeRows`, a row draws without them.
 * `help` is the reference panel's button count while it is open (a header per section and the auto-fetch switch). The
 * commits give way to it below their floor if they must: the panel is open only for a moment.
 */
export function budget(files: number, stashes: number, branches?: number, worktrees?: number, help = 0): { commits: number; toggles: number; branchRows: number; worktreeRows: number } {
  const f = Math.min(files, FILE_ROWS) * 3
  const st = Math.min(stashes, STASH_ROWS) * 3 + help
  const worktreeRows = worktrees === undefined ? 0 : Math.max(0, Math.min(worktrees, Math.floor((CEILING - FIXED - MIN_COMMITS - f - st - 1 - (branches === undefined ? 0 : 2)) / 3)))
  const s = st + (worktrees === undefined ? 0 : 1 + worktreeRows * 3)
  const room = CEILING - FIXED - MIN_COMMITS - f - s
  const branchRows = branches === undefined ? 0 : Math.max(0, Math.min(branches, Math.floor((room - 2) / 2)))
  const b = branches === undefined ? 0 : 2 + branchRows * 2
  const commits = Math.max(Math.min(MIN_COMMITS, CEILING - FIXED - f - s - b), Math.min(MAX_COMMITS, MAX_COMMITS - f - s - b))
  const toggles = Math.max(0, Math.min(MAX_TOGGLES, CEILING - FIXED - commits - f - s - b))
  return { commits, toggles, branchRows, worktreeRows }
}
