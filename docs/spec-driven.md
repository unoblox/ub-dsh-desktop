# Spec-driven development

`packages/dsh-desktop-specs` takes a feature from requirement to tested code:

1. requirements;
2. design;
3. tasks;
4. code and tests.

The user approves each of the first three documents. The app keeps code, tests and the spec in step, and fixes drift as it appears.

## For the user

- **Start:** ask for it ("use a spec to build …"), or pick **Build a feature with a spec** among the starters of a new conversation. The agent asks about anything unclear, then writes the requirements.
- **Approve:** when a document is ready, a banner above the composer says so, with a short summary.
  - **Review** opens it in the Spec panel.
  - **Approve** approves exactly the text that was submitted and shown. If the agent changed it after submitting, Approve stays off until the panel shows the new text and the agent submits it again.
  - **Ask for changes** puts "Changes to requirements.md: " in the composer.
  - After an approval, the agent moves on to the next document by itself.
- **Code waits:** until the tasks are approved, the agent's file tools can't change files outside the spec, and neither can subagents it starts. Only the user can stop or switch the spec before then (from the panel).
  - This is a guard rail for an agent following the workflow, not a security boundary: shell commands are not gated, and `spec.json` is a plain file in the project.
- **Building:** the agent works task by task. Each test is named for the acceptance criterion it checks, and a task is ticked only when its tests pass. If the agent stops with tasks open or drift left, it is told to go on:
  - only in a turn where it changed code or tests or ran the tests, so a question or "pause" from the user is not overridden;
  - at most three times per turn, and only while it is making progress.
- **Several specs in one project:** their ids overlap (each starts at REQ-1), so each test file says which spec it belongs to with a `spec: <slug>` comment. With one spec, every test file counts.
- **The Spec pill** (under the composer) shows the phase, "Review" while a document waits, then tasks done and drift. It opens the panel, which has:
  - the three documents, with problems to fix before approval;
  - **Trace:** each criterion with its status, its tests and its tasks, the last test run, and the drift list;
  - **Changes:** every edit to an approved document, by whom, summarised by id.
- **Drift is fixed on whichever side is wrong:**
  - code that breaks a criterion is fixed;
  - a document that newer instructions or the facts have overtaken is updated, the change is logged, and the agent says why.
- **Stop using this spec** (in the panel) ends spec mode for the conversation. The files stay in the project. A project's existing specs can be picked again from the pill.

## Files

In the project, versioned with the code:

| File | What | Written by |
| --- | --- | --- |
| `specs/<slug>/requirements.md` | `### REQ-n: Title`, a user story, `- AC-n.m: WHEN … THE SYSTEM SHALL …` | the agent |
| `specs/<slug>/design.md` | architecture, data, interfaces, how each REQ-n is met | the agent |
| `specs/<slug>/tasks.md` | `- [ ] T-n: Title (REQ-n, AC-n.m)`, ticked `[x]` when done | the agent |
| `specs/<slug>/spec.json` | approvals (SHA-256 of the approved text), the document waiting for approval, the change log, the files changed for each task | the app only; the agent's file tools may not edit it |
| `specs/<slug>/trace.json` | criteria ↔ tests ↔ tasks ↔ files, counts, drift, last run (from `spec verify`) | the app |

In the app's data folder (`<DSH_HOME>/specs/`): `sessions.json` (which spec each conversation works on), and `texts/<sha256>.md` (approved texts, so later changes can be summarised by id). Nothing is sent anywhere.

## How it works (`index.js`)

| Seam | Use |
| --- | --- |
| `spec` tool | `start`, `open`, `list`, `status`, `submit` (validates; then the agent stops for approval), `verify` (writes trace.json), `close` |
| `tools/pre-execute` | until tasks.md is approved, `write` / `edit` / `str_replace_editor` may only touch `specs/<slug>/`; `spec.json` and `trace.json` (any case) are never theirs. A subagent is gated by the spec of the conversation that started it (`parentSession`). The shell is not gated. |
| `tools/post-execute` | after a file write: logs changes to approved documents (by id for requirements; ticking tasks is not a change); links files to the tasks ticked next; reports new drift once. After a shell command (`bash`, or `pwsh` on Windows): logs any edit it made to an approved document, as the agent's; after a test command (`npm test`, `pytest`, `go test`, …) records the run from its `[exit code]` and failing lines (pass lines excluded) and rescans the tests. A run still going, moved to the background or stopped has no outcome and is not recorded. The note reaches the agent as context on that tool result. |
| `agent/turn-stopping` | while building, with tasks open or drift left, in a turn that changed code or tests or ran them: `agent.steer` a short "not finished" message, at most `maxContinues` (3) times per turn, and never twice with nothing changed |
| `system-prompt/assemble` | the workflow, plus the active spec's phase, approvals, open tasks, criteria counts and drift, on every request (survives compaction) |
| `GET /api/desktop-specs?session=` | the panel's view (read only); `POST …/approve` (`{session, doc, sha256}`: only the submitted document, only as submitted and shown, else 409), `…/reopen`, `…/activate` (folder names only); JSON and same-origin only |

Criterion status (`trace.js`):
- **untested:** no test names it.
- **not-run:** no test run in this process.
- **failing:** the last run failed and named it, or failed without naming any.
- **stale:** passed, but code changed since.
- **passing.**

A test may use `AC-1.2` or `ac_1_2`. A test named only for the requirement (`REQ-1` or `REQ_1`) covers all its criteria. The scan skips dependency and build folders and stops after 40,000 directory entries or 4,000 test files.

Drift (`buildTrace`):
- a test names an unknown id;
- a task names an unknown id;
- a criterion no task plans;
- a task ticked done with untested or failing criteria;
- a failed run after tasks were ticked.

Edits to approved documents made outside the app are logged as such on the agent's next request. The panel only reads.

Safe Mode does not load the plugin.

## Tests

- `test/specs.test.mjs`:
  - parsing, validation and the requirement diff;
  - trace and drift;
  - state, with approval by hash and in order;
  - the plugin through a stand-in Harness: the gate, submit and approve, drift notes after writes and failing runs, task-file links, the change log (including outside edits), steering and its limit, `verify` and `trace.json`.
- `test/specs-client.test.mjs`:
  - the pill;
  - the banner: approve sends the agent on, ask for changes reopens, and approve is refused for stale or invalid documents;
  - the panel: Markdown as text only, the trace, the changes, picking a spec;
  - locale parity.

## Live run (2026-10-26)

This run used the real Harness, a scripted stand-in model, and Chromium clicking the real banner:
- The agent's first code write was refused in the requirements phase.
- Requirements, design and tasks were each approved from the banner, and each approval started the next turn.
- The agent shipped a bug and a test tagged `AC-9.9`; both were reported back to it. It fixed the code, retagged the test and reran the tests.
- It said "done" with both tasks unticked and was steered on once. It ticked them and ran `spec verify`: 3/3 criteria passing, no drift, and the tasks linked to `greet.js` and `test/greet.test.js`.
- It ran in light and dark mode with no page errors.

A code review then found 17 problems, all fixed with a test that fails without the fix:
- test runs on Windows (`pwsh`) were never recorded;
- a run still in progress counted as a pass;
- subagents bypassed the gate;
- the agent could lift the gate with `spec close`;
- a document changed after submitting could be approved;
- the specs of one project shared ids;
- every user turn was steered on;
- tests changed by the shell were missed;
- and smaller issues: id and failure-line parsing, case, tick logging, panel state, slug checks, duplicate polling.

The live run was repeated after these fixes and passed.

The same runs found and fixed two issues:
- The Harness lets the agent overwrite only files it has read, so the documents are no longer pre-filled with templates. The shape is in the tool's answer and the runtime context instead.
- The dock row under the composer overlapped: the info strip painted over the Context pill, and the spend pill still had the browser's button border.
