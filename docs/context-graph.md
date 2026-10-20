# Context graph

Long conversations are compacted: the Harness replaces older messages with a summary. Each new summary is written from the previous one plus the newer messages, so after many compactions early details get paraphrased or dropped. The user's exact instructions blur, and facts about files describe versions that no longer exist.

The context graph (`packages/dsh-desktop-context-graph`) keeps durable knowledge outside that chain. Items are edited one at a time by id and are never re-summarized. A size-capped slice goes back into the model's context on every request.

## What it keeps

| Kind | Scope | Example |
| --- | --- | --- |
| rule | workspace | the user's standing instruction, as their exact words |
| goal | conversation | what this conversation is trying to achieve |
| task | conversation | work still to do; done tasks are hidden |
| decision | workspace | a choice made, and why |
| fact | workspace | something verified about the code or environment |
| error | workspace | an error and its fix |

Items can name workspace files and symbols, and link to each other: `about`, `depends-on`, `fixes`, `relates-to`.

- An item that replaces another keeps the old one as history; `context_lookup` with its id shows it.
- Workspace-scoped items are shared by every conversation in the same folder. Goals and tasks stay with their own conversation.

## How it works

1. **Capture, with no extra model call.**
   - When the Harness compacts, the plugin appends an instruction to that same compaction call, through the `llm/stream` waterfall with `purpose: "compaction"`. The instruction lists the current items by id and asks for a `<context-graph-delta>` JSON block after the checkpoint.
   - The plugin holds the stream until it ends, applies the block, and cuts it out of the text. The stored summary is exactly the checkpoint.
   - A missing, broken or truncated block changes nothing, and the summary still goes through.
2. **Exact quotes.** A rule's quote is kept only when those words appear in a message the user typed in this conversation. The check runs against the conversation's full event log, so it works even after the message was summarized away. Otherwise the rule is shown as "(paraphrased)".
3. **No drift back.** Several guards stop items from degrading or reappearing:
   - An item restated in other words updates the existing item instead of adding a near-duplicate.
   - An item that repeats something already replaced is rejected. This is the stale-summary case. To make an old fact true again, the model updates the current item by id.
   - Items the user added or edited in the panel can be confirmed or marked done by the model, but not reworded or removed.
   - Pinned items cannot be removed by the model.
4. **Freshness.**
   - Each item records the size, modification time and SHA-256 of the files it names. Only files inside the workspace are fingerprinted; symlinks that lead outside it are not followed.
   - Before the slice is shown, the plugin checks each file. Changed files are marked "changed since recorded: re-read before relying on this"; deleted files are marked "no longer exists".
5. **Injection.**
   - The slice is the `desktop:context-graph` entry of the runtime context (order 130). It is filled in during `system-prompt/assemble`, so the file checks are current for every request.
   - Pinned items, rules and the goal always show, up to twice the budget. Open tasks, decisions, errors and facts, newest first, fill the rest of the budget (6,000 characters, about 1,500 tokens). A last line counts the items left out.
   - The text is deterministic for an unchanged graph and unchanged files, so the Harness does not re-send the runtime context each step.
   - Like every runtime-context entry, it is re-sent after a compaction replaces it. On the step that compacted, it can be one step late.
6. **Lookup.** The `context_lookup` tool searches every item:
   - by words (SQLite FTS5)
   - by file path
   - by id, which returns the item's history plus the items linked to it or about the same files and symbols
   Measured in this repository's CI container with 5,000 items: about 6 ms by words, 2 ms by file, and 9 ms to build the per-request slice. The slice loads only pinned items, rules, the goal and the newest 200 others, so its cost does not grow with the graph. `test/context-graph-long-run.test.mjs` asserts lookups stay under 20 ms.
7. **Panel.** The Context pill under the composer counts the items for this conversation and shows how many refer to changed files. It opens a panel that lists, searches, pins, edits, completes, removes and adds items.
   - It uses two routes behind the Harness session cookie: `GET /api/desktop-context-graph?session=…` and `POST /api/desktop-context-graph/item`.
   - The POST route accepts JSON only and refuses another origin.

## Project scan, decision log and team file

See docs/trust-cost-memory.md, "Project memory". In short:
- A scan records the project's build and test commands from its own files.
- **Copy decision log** exports Markdown.
- **Share with team** writes `.unoblox/context.json` for teammates to import.

## Storage

- **Location:** one SQLite database (Node's built-in `node:sqlite` with FTS5, so no native package to build per platform) at `$DSH_HOME/context-graph/graph.sqlite`, where `DSH_HOME` is `<userData>/harness` in the app.
- **Durability:** it runs in WAL mode, and each compaction's changes are written in one transaction.
- **Workspace key:** each workspace is keyed by the SHA-256 of its folder path. The path itself is kept so the panel can show it.
- **Safe Mode:** leaves the plugin out (`build/dsh-desktop-safe.patch.yml`).
- **Packaging:** the package is listed with the other desktop plugins in the `@deepseek-ai/dsh` package.json patch, so the installation can resolve it.

## Limits

- The graph is only as good as what the model records at each compaction. Quotes, file freshness, replacement and the user's edits are enforced by code. Whether a decision or fact is right is up to the model, which is why the panel can correct it.
- A conversation that is never compacted records nothing. The graph fills as long conversations get compacted, or the user adds items in the panel.
- A file over 8 MB is compared by size and modification time only.

## Tests

- `test/context-graph.test.mjs`: the store, capture, the quote check, freshness, the budget, the plugin wiring and the routes, including the refused cross-origin and non-JSON posts.
- `test/context-graph-long-run.test.mjs`: 300 compactions through the plugin's real capture and injection path, with a stand-in model that loses early facts in its summaries, paraphrases, restates replaced facts, returns broken blocks and tries to remove a pinned rule. At the end, both rules are still word for word, the current decision has replaced the old one, the changed file is flagged, there are no duplicates and the slice stays within budget.
- `test/context-graph-client.test.mjs`: the pill and panel with real React.
