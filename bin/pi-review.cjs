#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

const COMMANDS = {
  duo: "review-fresh-duo",
  "duo-branch": "review-fresh-duo-branch",
  "duo-staged": "review-fresh-duo-staged",
  verify: "review-verify",
};

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(`usage: pi-review <duo|duo-branch|duo-staged|verify> [options] [scope]

Options:
  --cwd <path>         repository working directory (default: current directory)
  --model <pattern>    nested review model (default: codex-fa01/gpt-5.6-sol)
  --record-dir <path>  review-record output directory
  --pi-bin <path>      pi executable (default: pi; test/alternate installs)
  --help               show this help

Examples:
  pi-review duo-branch --cwd core/api "focus on auth, billing, and release safety"
  pi-review verify --cwd core/api /absolute/path/to/prior.review-record.json`);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const commandName = argv.shift();
  if (!commandName || commandName === "--help" || commandName === "-h") usage();
  const command = COMMANDS[commandName];
  if (!command) usage(`unknown command: ${commandName}`);

  const options = {
    command,
    cwd: process.cwd(),
    model: "codex-fa01/gpt-5.6-sol",
    recordDir: undefined,
    piBin: process.env.PI_REVIEW_PI_BIN || "pi",
    scopeParts: [],
  };
  while (argv.length > 0) {
    const value = argv.shift();
    if (value === "--help" || value === "-h") usage();
    if (value === "--cwd") options.cwd = argv.shift() || usage("--cwd requires a path");
    else if (value === "--model") options.model = argv.shift() || usage("--model requires a value");
    else if (value === "--record-dir") options.recordDir = argv.shift() || usage("--record-dir requires a path");
    else if (value === "--pi-bin") options.piBin = argv.shift() || usage("--pi-bin requires a path");
    else options.scopeParts.push(value);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const extension = resolve(__dirname, "../extensions/pi-review/index.ts");
  const commandText = `/${options.command}${
    options.scopeParts.length ? ` ${options.scopeParts.join(" ")}` : ""
  }`;
  const args = [
    "--mode", "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--model", options.model,
    "--extension", extension,
    commandText,
  ];
  const env = { ...process.env };
  if (options.recordDir) env.PI_REVIEW_RECORD_DIR = resolve(options.recordDir);

  const child = spawn(options.piBin, args, {
    cwd: resolve(options.cwd),
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderr = "";
  let result;
  const diagnosticEvents = [];
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        diagnosticEvents.push(line);
        if (diagnosticEvents.length > 20) diagnosticEvents.shift();
        if (
          event.type === "message_end" &&
          event.message?.role === "custom" &&
          event.message?.customType === "review-result"
        ) {
          result = event.message.content;
        }
      } catch {
        // Preserve non-JSON startup noise for diagnostics only.
        stderr += `${line}\n`;
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const code = await new Promise((resolveCode, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolveCode(status ?? 1));
  });
  if (stdoutBuffer.trim()) {
    try {
      const event = JSON.parse(stdoutBuffer);
      diagnosticEvents.push(stdoutBuffer);
      if (
        event.type === "message_end" &&
        event.message?.role === "custom" &&
        event.message?.customType === "review-result"
      ) {
        result = event.message.content;
      }
    } catch {
      stderr += `${stdoutBuffer}\n`;
    }
  }

  if (code !== 0) {
    if (stderr) process.stderr.write(stderr.endsWith("\n") ? "" : "\n");
    process.exit(code);
  }
  if (typeof result !== "string" || !result.trim()) {
    console.error("pi-review: command completed without a review-result message");
    if (stderr.trim()) console.error(stderr.trim());
    if (diagnosticEvents.length) {
      console.error("pi-review: final pi events:");
      console.error(diagnosticEvents.join("\n"));
    }
    process.exit(1);
  }
  process.stdout.write(result.endsWith("\n") ? result : `${result}\n`);
}

main().catch((error) => {
  console.error(`pi-review: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
