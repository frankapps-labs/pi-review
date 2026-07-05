import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type ReviewRecordKind = "duo_review" | string;

export type ReviewRecordEnvelope<T extends Record<string, unknown>> = {
	schema: string;
	kind: ReviewRecordKind;
	generated_at: string;
	workspace_root: string;
	cwd: string;
	repo?: string;
	repo_name?: string;
	branch?: string;
	commit?: string;
	payload: T;
};

export function gitValue(cwd: string, args: string[]): string | undefined {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
	return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

export function findWorkspaceRoot(cwd: string): string {
	return gitValue(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd;
}

export function safeSlug(value: string, maxLength = 80): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, maxLength) || "review-record";
}

export function timestampSlug(date = new Date()): string {
	return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function workspaceRelative(root: string, path: string): string {
	const rel = relative(root, path);
	return rel || ".";
}

export function reviewRecordOutputDir(root: string): string {
	const configured = process.env.PI_REVIEW_RECORD_DIR?.trim();
	if (configured) return isAbsolute(configured) ? configured : join(root, configured);
	return join(root, ".pi", "reviews");
}

export function buildReviewRecord<T extends Record<string, unknown>>(
	ctx: ExtensionCommandContext,
	kind: ReviewRecordKind,
	schema: string,
	payload: T,
): ReviewRecordEnvelope<T> {
	const root = findWorkspaceRoot(ctx.cwd);
	const repoRoot = gitValue(ctx.cwd, ["rev-parse", "--show-toplevel"]);
	return {
		schema,
		kind,
		generated_at: new Date().toISOString(),
		workspace_root: root,
		cwd: ctx.cwd,
		repo: repoRoot ? workspaceRelative(root, repoRoot) : undefined,
		repo_name: repoRoot ? basename(repoRoot) : basename(ctx.cwd),
		branch: gitValue(ctx.cwd, ["branch", "--show-current"]),
		commit: gitValue(ctx.cwd, ["rev-parse", "HEAD"]),
		payload,
	};
}

export function saveReviewRecord<T extends Record<string, unknown>>(
	ctx: ExtensionCommandContext,
	options: {
		kind: ReviewRecordKind;
		schema: string;
		slugParts: string[];
		payload: T;
	},
): string {
	const root = findWorkspaceRoot(ctx.cwd);
	const outDir = reviewRecordOutputDir(root);
	mkdirSync(outDir, { recursive: true });
	const slug = options.slugParts.map((part) => safeSlug(part)).filter(Boolean).join("-") || safeSlug(options.kind);
	const filename = `${timestampSlug()}-${slug}.review-record.json`;
	const path = join(outDir, filename);
	const record = buildReviewRecord(ctx, options.kind, options.schema, options.payload);
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
	return path;
}

export function reviewRecordDirExists(ctx: ExtensionCommandContext): boolean {
	return existsSync(reviewRecordOutputDir(findWorkspaceRoot(ctx.cwd)));
}
