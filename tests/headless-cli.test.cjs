"use strict";

const assert = require("node:assert/strict");
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const CLI = resolve(__dirname, "../bin/pi-review.cjs");

function fakePi(temp) {
  const path = join(temp, "fake-pi.cjs");
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.PI_REVIEW_FAKE_CAPTURE, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  recordDir: process.env.PI_REVIEW_RECORD_DIR,
}));
console.log(JSON.stringify({type:"session", cwd:process.cwd()}));
console.log(JSON.stringify({type:"message_end", message:{role:"custom", customType:"review-result", content:"fake duo complete"}}));
`,
  );
  chmodSync(path, 0o755);
  return path;
}

test("headless duo branch forwards model, cwd, scope, extension, and record dir", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-review-headless-"));
  const repo = join(temp, "repo");
  const recordDir = join(temp, "records");
  require("node:fs").mkdirSync(repo);
  const capture = join(temp, "capture.json");
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      "duo-branch",
      "--cwd",
      repo,
      "--model",
      "codex-fa02/gpt-5.6-sol",
      "--record-dir",
      recordDir,
      "review only release safety",
      "and scopes",
      "--pi-bin",
      fakePi(temp),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PI_REVIEW_FAKE_CAPTURE: capture },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "fake duo complete\n");
  const invocation = JSON.parse(readFileSync(capture, "utf8"));
  assert.equal(realpathSync(invocation.cwd), realpathSync(repo));
  assert.equal(invocation.recordDir, recordDir);
  assert.deepEqual(invocation.argv.slice(0, 7), [
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--model",
    "codex-fa02/gpt-5.6-sol",
    "--extension",
  ]);
  assert.match(invocation.argv[7], /extensions\/pi-review\/index\.ts$/);
  assert.equal(
    invocation.argv[8],
    "/review-fresh-duo-branch review only release safety and scopes",
  );
});

test("headless verify forwards the explicit review record path", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-review-headless-"));
  const capture = join(temp, "capture.json");
  const record = join(temp, "prior.review-record.json");
  writeFileSync(record, "{}\n");
  const result = spawnSync(
    process.execPath,
    [CLI, "verify", "--cwd", temp, "--pi-bin", fakePi(temp), record],
    {
      encoding: "utf8",
      env: { ...process.env, PI_REVIEW_FAKE_CAPTURE: capture },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const invocation = JSON.parse(readFileSync(capture, "utf8"));
  assert.equal(invocation.argv.at(-1), `/review-verify ${record}`);
});
