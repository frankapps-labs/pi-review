# pi-review

Fresh-context code review commands for [pi](https://pi.dev).

`pi-review` adds `/review-*` commands that run independent nested pi reviewers over your current diff, staged changes, or branch. The duo command runs two reviewers with different review prompts, synthesizes the results, and can save a local JSON review record for later audit.

## Install

```bash
pi install git:github.com/frankapps-labs/pi-review@v0.1.2
```

Then restart pi, or run `/reload` in an already-open pi session.

Verify the package is installed:

```bash
pi list
```

You should see `git:github.com/frankapps-labs/pi-review@v0.1.2`. In pi, `/review-help` should list the review commands.

## Update

If you installed from the pinned git tag, move to a newer release by installing the newer tag:

```bash
pi install git:github.com/frankapps-labs/pi-review@v0.1.2
```

Then restart pi, or run `/reload` in an already-open pi session.

To reconcile the currently pinned checkout without changing tags:

```bash
pi update --extension git:github.com/frankapps-labs/pi-review@v0.1.2
```

To see what is installed:

```bash
pi list
```

`pi-review` also checks GitHub tags once per pi process when you run a `/review-*` command and warns if a newer release is available. Set `PI_OFFLINE=1` to skip the check.

If you want to try it for one run without installing it permanently:

```bash
pi -e git:github.com/frankapps-labs/pi-review@v0.1.2
```

For local development:

```bash
pi -e ./extensions/pi-review/index.ts
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

## Headless and automation usage

The package also installs a `pi-review` executable for scripts, coding-agent harnesses, and CI jobs that cannot type TUI slash commands. It runs the same extension command through pi print/JSON mode, keeps the nested reviewers read-only, prints only the final synthesized result, and preserves the normal review record.

```bash
pi-review duo-branch \
  --cwd /path/to/repo \
  --model codex-fa01/gpt-5.6-sol \
  --record-dir /path/to/private/reviews \
  "focus on auth, migrations, and release safety"
```

Supported subcommands:

```text
pi-review duo [scope]
pi-review duo-branch [scope]
pi-review duo-staged [scope]
pi-review verify /path/to/prior.review-record.json
```

Useful options are `--cwd`, `--model`, `--record-dir`, and `--pi-bin`. Review records must stay in an appropriate private location when the reviewed repository is public.

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

Fresh review records include token and cost usage when the nested pi provider reports it. Duo review records include a breakdown for the terse, deep, and synthesis subprocesses plus a total.

## Troubleshooting install

If `/review-help` is not available after install:

1. Restart pi, or run `/reload` in the current pi session.
2. Confirm the package is in settings with `pi list`.
3. Make sure your pi version supports packages: `pi update --self`, then reinstall.
4. Reconcile the pinned git checkout if needed:

   ```bash
   pi update --extension git:github.com/frankapps-labs/pi-review@v0.1.2
   ```

For machines where GitHub SSH is not configured, the shorthand above should still use a public GitHub clone. If your git config rewrites GitHub URLs to SSH, use the explicit HTTPS form instead:

```bash
pi install https://github.com/frankapps-labs/pi-review@v0.1.2
```

## Security

Pi extensions run with your full system permissions. This extension starts nested `pi` processes and instructs them to use read-only review commands, but you should review the source before installing any third-party pi package.

## License

MIT
