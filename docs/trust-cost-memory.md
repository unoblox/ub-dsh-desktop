# Receipts, cost, project memory and starters

Four features built on what the app already has: the Harness session log, the unoblox gateway's per-response charge, the context graph (docs/context-graph.md), and the composer.

## Proof of work: receipts (`packages/dsh-desktop-receipts`)

Under each finished turn, a receipt lists what the agent actually did, read from the turn's own session events:

- the shell commands it ran, with their outcome: exit code, timeout, stopped, or could not run;
- which of those are checks (test, build, type check, lint);
- the files it changed with `write`, `edit` or `str_replace_editor`. Refused writes do not count.

The receipt then checks the claims in the final reply ("tests pass", "the build succeeds", "no type errors", "lint is clean", in English and Chinese) against those checks:

| State | Meaning |
| --- | --- |
| verified | a check of that kind passed after the last file change |
| contradicted | the last such check after the change failed |
| not re-run | the check only ran before the last change |
| not verified | no such check ran |

**How it reads the events**
- Exit codes come from the text the bash tool records (`[exit code: N]`; no marker means 0), the same way the stock shell view reads them.
- Results that compaction rewrites later are ignored, so the receipt keeps the original outcome.

**Display and actions**
- The receipt opens by itself when a check failed or a claim is not verified. It does not appear for turns that ran no check, changed nothing and claimed nothing.
- **Re-check** sends one message asking the agent to re-run those checks and report the exact results. The receipt itself runs nothing.

## Cost: spend meter and task budget (`packages/dsh-desktop-unoblox-info`)

- **Spend pill:** a pill under the composer shows what the current task (one message and everything the agent does for it) has spent, as unoblox charged it (`charged_inr` in each response's `x-unoblox-freemium` header). Its tooltip adds the conversation's total and the average cost of recent steps. It refreshes every 3 s while the agent works.
- **Budget:** clicking the pill sets a per-task budget for the conversation. It is kept in `<DSH_HOME>/desktop-unoblox/budgets.json`.
- **How the stop works:**
  - Before each of the agent's own model calls (not compaction or titles), the plugin checks the budget. A task that has spent its budget is stopped, and so is one whose next step would go over it at the recent average step cost. Only the first step of a task always runs.
  - The stop is a `UNOBLOX_BUDGET` failure that is never retried, even under an "always retry" policy.
- **After a stop:** the failed turn offers **Continue** and **Raise to ₹N and continue**. Each message is a new task with its own budget, so going on is always the user's click.
- **Estimates:** unoblox does not publish a cost estimate before a request. The app's estimate is the average of the recent steps in the conversation, shown as such.

## Project memory (`packages/dsh-desktop-context-graph/project.js`)

- **Scan:** when a workspace is first used in a run, the graph records how the project is built and tested, from its own files: package.json scripts and package manager, Python, Rust, Go, Makefile targets, AGENTS.md/CLAUDE.md, README title and summary, and top-level folders.
  - Nothing is run and no model is called.
  - The scanned facts have stable ids and file fingerprints, so a re-scan updates them in place, and an edited package.json flags them until the next scan.
  - A scanned fact the user edited or removed stays that way.
- **Copy decision log:** in the Context panel. Copies the workspace's rules, decisions, goals, open tasks, error fixes and facts as Markdown, for a PR description or onboarding.
- **Share with team:** in the Context panel. Writes the workspace-shared items (not goals, tasks or scanned facts) to `.unoblox/context.json` in the workspace, only on that click.
  - Teammates who open the folder import it automatically when it changes; nothing goes through a server, only the project's own version control.
  - An item someone edited locally after the file's version of it is kept.
  - File paths outside the workspace and malformed entries are dropped.

## Starters (`packages/dsh-desktop-starters`)

Above the composer of a new, empty conversation, "Start from an example" offers eight plain-language starting points for people who do not write code:

- a report from a spreadsheet
- a slide deck
- notes into a document
- a calculator
- cleaning up a spreadsheet
- summarising documents
- drafting an email
- fixing a problem in code

A click puts the example into the composer, with [brackets] marking the parts to fill in. Nothing is sent by itself. The strip disappears once the user types or the conversation starts. The text is in English and Chinese.

## Tests

- `test/receipts-starters.test.mjs`: check and claim detection, exit status parsing, the verified/contradicted/stale/unverified rules on a real event sequence, the card and Re-check, and the starters.
- `test/unoblox-budget.test.mjs`: the spend tracker, the budget file, stopping before going over, compaction calls passing, no retry of the stop, the route's same-origin JSON rule, the spend pill and budget dialog, and the budget row.
- `test/context-graph-project.test.mjs`: the scan, re-scans, the user's edits and removals, the decision log, and the team file round trip between two machines, including a hostile file.
- Integration: the real Harness with a scripted model that makes real tool calls.
  - It ran `npm test` (exit 1), had a write refused, then claimed "All tests pass". The receipt showed "Tests pass: contradicted: npm test failed".
  - A ₹0.03 budget stopped the next task with ₹0.02 spent before a ₹0.02 step.
  - The scan recorded the project's scripts.
  - The starters filled the composer.
