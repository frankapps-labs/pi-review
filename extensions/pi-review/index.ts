import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { saveReviewRecord } from "./review-records";

type ReviewMode = "diff" | "staged" | "branch" | "codebase";

let reviewModel: string | undefined;

function dispatch(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string) {
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
		return;
	}
	pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	ctx.ui.notify("Review queued as follow-up", "info");
}

function currentModelPattern(ctx: ExtensionCommandContext): string | undefined {
	const model = ctx.model as { provider?: string; id?: string } | undefined;
	if (!model?.id) return undefined;
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function reviewPrompt(mode: ReviewMode, args: string): string {
	const scope = args.trim();
	const target = scope || defaultTarget(mode);
	return `Review ${target}.

Focus:
- correctness bugs
- data loss / security risks
- race conditions / transaction boundaries
- public API or backwards-compatibility breaks
- missing tests only when tied to a concrete risk

Output findings only, one line each:
\`path:L<line>: <severity>: <problem>. <fix>.\`

Severity:
- 🔴 bug: wrong behavior, crash, security hole, data loss
- 🟡 risk: fragile edge case, race, missing guard, perf cliff
- 🔵 nit: only if it changes maintainability materially
- ❓ q: author intent needed

Rules:
- exact file:line refs
- concrete fixes
- no praise
- no generic suggestions
- no nits unless requested
- if no findings, output exactly: \`No issues.\``;
}

function freshReviewPrompt(mode: ReviewMode, args: string): string {
	return `${reviewPrompt(mode, args)}

You are a fresh independent reviewer. Read the diff/code yourself using tools. Do not rely on prior conversation. Bash is read-only only: git diff/status/log/show, rg, find, ls, test discovery. Do not edit files or run mutating commands.`;
}

function deepReviewPrompt(mode: ReviewMode, args: string): string {
	const scope = args.trim();
	const target = scope || defaultTarget(mode);
	return `Review ${target} as a fresh independent senior reviewer.

Read the diff/code yourself using tools. Do not rely on prior conversation. Bash is read-only only: git diff/status/log/show, rg, find, ls, test discovery. Do not edit files or run mutating commands.

Focus on issues a terse file:line review might miss:
- migration/data compatibility
- public API breaks and docs contract drift
- cross-file consistency
- test harness reliability
- release/slice scope violations
- hidden operational risks

Output a numbered report:
1. Finding title — severity
   Evidence: path:L<line> plus short explanation.
   Why it matters:
   Recommended fix:

If no findings, output exactly: No issues.`;
}

function synthesizeReviewPrompt(target: string, terse: string, deep: string): string {
	return `Synthesize these two independent code reviews into one final report for ${target}.

Inputs:

## Review A — terse file:line
${terse || "No output."}

## Review B — detailed cross-file
${deep || "No output."}

Rules:
- Deduplicate overlapping findings.
- Preserve findings that appear in only one review if they are plausible and actionable.
- Flag contradictions explicitly.
- Number findings.
- For each finding include severity, evidence, why it matters, and recommended fix.
- Keep it concise but not one-line terse.
- End with: "Recommended next step".
- If both reviews found nothing, output exactly: No issues.`;
}

function defaultTarget(mode: ReviewMode): string {
	switch (mode) {
		case "diff":
			return "current git diff (unstaged + staged)";
		case "staged":
			return "staged git diff only";
		case "branch":
			return "current branch against upstream/main merge-base";
		case "codebase":
			return "the relevant codebase area requested by the user";
	}
}

type ReviewProgress = {
	events: number;
	stdoutBytes: number;
	stderrBytes: number;
};

function formatKb(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)}KB`;
}

async function runPiReview(ctx: ExtensionCommandContext, model: string, prompt: string, progress?: ReviewProgress): Promise<{ code: number; output: string; stderr: string }> {
	const piArgs = [
		"--mode", "json",
		"-p",
		"--no-session",
		"--model", model,
		"--tools", "read,bash,grep,find,ls",
		prompt,
	];

	return await new Promise<{ code: number; output: string; stderr: string }>((resolve) => {
		const proc = spawn("pi", piArgs, { cwd: ctx.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let final = "";
		let buffer = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			stdout += line + "\n";
			if (progress) {
				progress.events++;
				progress.stdoutBytes += Buffer.byteLength(`${line}\n`);
			}
			try {
				const event = JSON.parse(line);
				if (event.type === "message_end" && event.message?.role === "assistant") {
					for (const part of event.message.content ?? []) {
						if (part.type === "text") final = part.text;
					}
				}
			} catch {
				// ignore non-json noise
			}
		};

		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});
		proc.stderr.on("data", (data) => {
			const text = data.toString();
			stderr += text;
			if (progress) progress.stderrBytes += Buffer.byteLength(text);
		});
		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			resolve({ code: code ?? 0, output: final || stdout.trim(), stderr });
		});
		proc.on("error", (err) => resolve({ code: 1, output: "", stderr: String(err) }));
	});
}

async function runFreshReview(pi: ExtensionAPI, ctx: ExtensionCommandContext, mode: ReviewMode, args: string): Promise<void> {
	const model = reviewModel ?? currentModelPattern(ctx);
	if (!model) {
		ctx.ui.notify("No active model found. Use /review-model <model> or switch model first.", "warning");
		return;
	}

	ctx.ui.notify(`Fresh review starting: ${model}`, "info");
	const startedAt = Date.now();
	const progress: ReviewProgress = { events: 0, stdoutBytes: 0, stderrBytes: 0 };
	const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let spin = 0;
	const updateProgress = () => {
		const elapsed = Math.round((Date.now() - startedAt) / 1000);
		const mark = spinner[spin++ % spinner.length];
		ctx.ui.setStatus("review-fresh", `${mark} ${elapsed}s ↓${formatKb(progress.stdoutBytes)} err ${formatKb(progress.stderrBytes)}`);
		ctx.ui.setWidget("review-fresh", [
			`${mark} Fresh review running… ${elapsed}s`,
			`model: ${model}`,
			`scope: ${args.trim() || defaultTarget(mode)}`,
			`events: ${progress.events}`,
			`stdout: ${formatKb(progress.stdoutBytes)}  stderr: ${formatKb(progress.stderrBytes)}`,
		]);
	};
	updateProgress();
	const progressTimer = setInterval(updateProgress, 500);
	const result = await runPiReview(ctx, model, freshReviewPrompt(mode, args), progress);

	clearInterval(progressTimer);
	const elapsed = Math.round((Date.now() - startedAt) / 1000);
	ctx.ui.setStatus("review-fresh", undefined);
	ctx.ui.setWidget("review-fresh", undefined);

	if (result.code !== 0) {
		ctx.ui.notify(`Fresh review failed (${result.code}) after ${elapsed}s`, "error");
		piSendAsMessage(pi, `Fresh review failed (${result.code}) after ${elapsed}s\n\n${result.stderr || result.output}`);
		return;
	}

	ctx.ui.notify(`Fresh review done in ${elapsed}s`, "info");
	piSendAsMessage(pi, `Fresh review (${model}, ${elapsed}s)\n\n${result.output || "No output."}`);
}

async function runFreshDuoReview(pi: ExtensionAPI, ctx: ExtensionCommandContext, mode: ReviewMode, args: string): Promise<void> {
	const model = reviewModel ?? currentModelPattern(ctx);
	if (!model) {
		ctx.ui.notify("No active model found. Use /review-model <model> or switch model first.", "warning");
		return;
	}

	const target = args.trim() || defaultTarget(mode);
	ctx.ui.notify(`Duo review starting: ${model}`, "info");
	const startedAt = Date.now();
	const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let spin = 0;
	let phase = "A+B running";
	const aProgress: ReviewProgress = { events: 0, stdoutBytes: 0, stderrBytes: 0 };
	const bProgress: ReviewProgress = { events: 0, stdoutBytes: 0, stderrBytes: 0 };
	const sProgress: ReviewProgress = { events: 0, stdoutBytes: 0, stderrBytes: 0 };
	const updateProgress = () => {
		const elapsed = Math.round((Date.now() - startedAt) / 1000);
		const mark = spinner[spin++ % spinner.length];
		const out = aProgress.stdoutBytes + bProgress.stdoutBytes + sProgress.stdoutBytes;
		const err = aProgress.stderrBytes + bProgress.stderrBytes + sProgress.stderrBytes;
		ctx.ui.setStatus("review-duo", `${mark} ${elapsed}s ${phase} ↓${formatKb(out)} err ${formatKb(err)}`);
		ctx.ui.setWidget("review-duo", [
			`${mark} Duo review ${phase}… ${elapsed}s`,
			`model: ${model}`,
			`scope: ${target}`,
			`A terse: ${aProgress.events} ev ${formatKb(aProgress.stdoutBytes)}`,
			`B deep:  ${bProgress.events} ev ${formatKb(bProgress.stdoutBytes)}`,
			`S synth: ${sProgress.events} ev ${formatKb(sProgress.stdoutBytes)}`,
		]);
	};
	updateProgress();
	const progressTimer = setInterval(updateProgress, 500);

	const [terse, deep] = await Promise.all([
		runPiReview(ctx, model, freshReviewPrompt(mode, args), aProgress),
		runPiReview(ctx, model, deepReviewPrompt(mode, args), bProgress),
	]);

	if (terse.code !== 0 || deep.code !== 0) {
		clearInterval(progressTimer);
		const elapsed = Math.round((Date.now() - startedAt) / 1000);
		ctx.ui.setStatus("review-duo", undefined);
		ctx.ui.setWidget("review-duo", undefined);
		ctx.ui.notify(`Duo review failed after ${elapsed}s`, "error");
		piSendAsMessage(pi, `Duo review failed after ${elapsed}s\n\nA(${terse.code}): ${terse.stderr || terse.output}\n\nB(${deep.code}): ${deep.stderr || deep.output}`);
		return;
	}

	phase = "synthesizing";
	updateProgress();
	const synthesis = await runPiReview(ctx, model, synthesizeReviewPrompt(target, terse.output, deep.output), sProgress);
	clearInterval(progressTimer);
	const elapsed = Math.round((Date.now() - startedAt) / 1000);
	ctx.ui.setStatus("review-duo", undefined);
	ctx.ui.setWidget("review-duo", undefined);

	if (synthesis.code !== 0) {
		ctx.ui.notify(`Duo synthesis failed (${synthesis.code}) after ${elapsed}s`, "error");
		piSendAsMessage(pi, `Duo synthesis failed (${synthesis.code}) after ${elapsed}s\n\n${synthesis.stderr || synthesis.output}\n\nRaw A:\n${terse.output}\n\nRaw B:\n${deep.output}`);
		return;
	}

	const savedPath = saveDuoReviewRecord(ctx, {
		model,
		target,
		args,
		elapsedSeconds: elapsed,
		terse: terse.output,
		deep: deep.output,
		synthesis: synthesis.output || "No output.",
	});
	ctx.ui.notify(`Duo review done in ${elapsed}s; saved review record`, "info");
	piSendAsMessage(pi, `Duo review (${model}, ${elapsed}s)\nSaved review record: ${savedPath}\n\n${synthesis.output || "No output."}`);
}

function saveDuoReviewRecord(ctx: ExtensionCommandContext, data: {
	model: string;
	target: string;
	args: string;
	elapsedSeconds: number;
	terse: string;
	deep: string;
	synthesis: string;
}): string {
	return saveReviewRecord(ctx, {
		kind: "duo_review",
		schema: "pi_review.duo_review_record.v1",
		slugParts: [data.target],
		payload: {
			model: data.model,
			target: data.target,
			args: data.args,
			elapsed_seconds: data.elapsedSeconds,
			review_command: `/review-fresh-duo ${data.args}`.trim(),
			reviews: {
				terse: data.terse,
				deep: data.deep,
				synthesis: data.synthesis,
			},
			human_verdict: "pending",
			accepted_findings: [],
			rejected_findings: [],
			fix_summary: "pending",
			validation: [],
		},
	});
}

function piSendAsMessage(pi: ExtensionAPI, content: string) {
	pi.sendMessage({
		customType: "review-result",
		content,
		display: true,
	});
}

export default function reviewRecent(pi: ExtensionAPI) {
	pi.registerCommand("review-recent", {
		description: "Review recent changes with terse file:line findings",
		handler: async (args, ctx) => dispatch(pi, ctx, reviewPrompt("diff", args)),
	});

	pi.registerCommand("review-staged", {
		description: "Review staged changes only",
		handler: async (args, ctx) => dispatch(pi, ctx, reviewPrompt("staged", args)),
	});

	pi.registerCommand("review-branch", {
		description: "Review current branch against upstream/main",
		handler: async (args, ctx) => dispatch(pi, ctx, reviewPrompt("branch", args)),
	});

	pi.registerCommand("review-focus", {
		description: "Review with a specific focus, e.g. concurrency or API breaks",
		handler: async (args, ctx) => {
			const focus = args.trim();
			if (!focus) {
				ctx.ui.notify("Usage: /review-focus <focus/scope>", "warning");
				return;
			}
			dispatch(pi, ctx, reviewPrompt("diff", `current git diff, focus only on ${focus}`));
		},
	});

	pi.registerCommand("review-fresh", {
		description: "Fresh-context review in a separate pi process",
		handler: async (args, ctx) => runFreshReview(pi, ctx, "diff", args),
	});

	pi.registerCommand("review-fresh-staged", {
		description: "Fresh-context review of staged changes",
		handler: async (args, ctx) => runFreshReview(pi, ctx, "staged", args),
	});

	pi.registerCommand("review-fresh-branch", {
		description: "Fresh-context review of branch against upstream/main",
		handler: async (args, ctx) => runFreshReview(pi, ctx, "branch", args),
	});

	pi.registerCommand("review-fresh-duo", {
		description: "Run terse + detailed fresh reviews, then synthesize",
		handler: async (args, ctx) => runFreshDuoReview(pi, ctx, "diff", args),
	});

	pi.registerCommand("review-fresh-duo-staged", {
		description: "Duo review of staged changes",
		handler: async (args, ctx) => runFreshDuoReview(pi, ctx, "staged", args),
	});

	pi.registerCommand("review-fresh-duo-branch", {
		description: "Duo review of branch against upstream/main",
		handler: async (args, ctx) => runFreshDuoReview(pi, ctx, "branch", args),
	});

	pi.registerCommand("review-model-current", {
		description: "Set fresh-review model to the currently selected model",
		handler: async (_args, ctx) => {
			reviewModel = currentModelPattern(ctx);
			ctx.ui.notify(reviewModel ? `Fresh-review model: ${reviewModel}` : "No active model found", reviewModel ? "info" : "warning");
		},
	});

	pi.registerCommand("review-model", {
		description: "Set or show fresh-review model pattern",
		handler: async (args, ctx) => {
			const model = args.trim();
			if (!model) {
				ctx.ui.notify(`Fresh-review model: ${reviewModel ?? currentModelPattern(ctx) ?? "unset"}`, "info");
				return;
			}
			reviewModel = model;
			ctx.ui.notify(`Fresh-review model: ${reviewModel}`, "info");
		},
	});

	pi.registerCommand("review-model-clear", {
		description: "Use current session model for fresh reviews",
		handler: async (_args, ctx) => {
			reviewModel = undefined;
			ctx.ui.notify("Fresh-review model cleared; using current session model", "info");
		},
	});

	pi.registerCommand("review-help", {
		description: "List review helper commands",
		handler: async (_args, ctx) => {
			ctx.ui.notify([
				"/review-recent [scope] — inline review current diff",
				"/review-staged [scope] — inline review staged diff",
				"/review-branch [scope] — inline review branch vs upstream/main",
				"/review-focus <focus> — inline review diff for one risk class",
				"/review-fresh [scope] — fresh-context review current diff",
				"/review-fresh-staged [scope] — fresh-context review staged diff",
				"/review-fresh-branch [scope] — fresh-context review branch",
				"/review-fresh-duo [scope] — terse + detailed fresh reviews, synthesized",
				"/review-fresh-duo-staged [scope] — duo review staged diff",
				"/review-fresh-duo-branch [scope] — duo review branch",
				"/review-model-current — pin fresh reviews to current model",
				"/review-model [provider/model] — set/show fresh-review model",
				"/review-model-clear — use current session model",
			].join("\n"), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("review", "🔎 review");
	});
}
