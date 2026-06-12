# pi-review

Fresh-context code review commands for [pi](https://pi.dev).

`pi-review` adds `/review-*` commands that run independent nested pi reviewers over your current diff, staged changes, or branch. The duo command runs two reviewers with different review prompts, synthesizes the results, and can save a local JSON review record for later audit.

## Install

```bash
pi install git:github.com/frankapps-labs/pi-review@v0.1.0
```

For local development:

```bash
pi -e ./extensions/pi-review
```

## Quick examples

Review your current unstaged + staged diff inline in the current conversation:

```text
/review-recent
```

Run a fresh independent reviewer in a separate pi process:

```text
/review-fresh
```

Run two fresh reviewers, then synthesize their findings:

```text
/review-fresh-duo
```

Review only what is staged before committing:

```text
/review-fresh-duo-staged
```

Review your whole branch against `upstream/main` or `origin/main`:

```text
/review-fresh-duo-branch
```

Focus the review on one risk area:

```text
/review-focus migrations and backwards compatibility
```

Use a specific model for fresh reviews:

```text
/review-model anthropic/claude-sonnet-4-6
/review-fresh-duo
```

## What to use when

| Situation | Command |
| --- | --- |
| Quick sanity check while working | `/review-recent` |
| You want a reviewer that ignores the current conversation | `/review-fresh` |
| Pre-commit review | `/review-fresh-duo-staged` |
| Pre-PR or release-gate review | `/review-fresh-duo-branch` |
| High-risk change where one pass may miss cross-file issues | `/review-fresh-duo` |
| One specific concern, like auth, data loss, migrations, or API breaks | `/review-focus <concern>` |
| Compare behavior across models or pin review spend to a cheaper model | `/review-model <provider/model>` |

Rule of thumb: use `/review-recent` for speed, `/review-fresh*` for independence, and `/review-fresh-duo*` before commits/PRs where correctness matters.

## Commands

- `/review-recent [scope]` — inline review of current diff
- `/review-staged [scope]` — inline review of staged diff
- `/review-branch [scope]` — inline review of branch against upstream/main
- `/review-focus <focus>` — inline review of current diff for one risk class
- `/review-fresh [scope]` — fresh-context review in a separate pi process
- `/review-fresh-staged [scope]` — fresh-context review of staged changes
- `/review-fresh-branch [scope]` — fresh-context review of branch changes
- `/review-fresh-duo [scope]` — terse + detailed fresh reviews, synthesized
- `/review-fresh-duo-staged [scope]` — duo review of staged changes
- `/review-fresh-duo-branch [scope]` — duo review of branch changes
- `/review-model-current` — pin fresh reviews to the current session model
- `/review-model [provider/model]` — set/show fresh-review model
- `/review-model-clear` — use the current session model
- `/review-help` — list commands

## Local review records

`/review-fresh-duo*` saves a JSON review record by default under:

```text
.pi/reviews/
```

Override the output directory with:

```bash
PI_REVIEW_RECORD_DIR=reviews pi
```

Relative override paths are resolved from the git root when available, otherwise from the current working directory.

## Security

Pi extensions run with your full system permissions. This extension starts nested `pi` processes and instructs them to use read-only review commands, but you should review the source before installing any third-party pi package.

## License

MIT
