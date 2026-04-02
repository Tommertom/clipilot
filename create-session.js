#!/usr/bin/env node
/**
 * create-session.js
 *
 * Manually creates a Copilot CLI session in ~/.copilot/session-state/
 * replicating the exact structure produced by copilot-agent.
 *
 * Usage:
 *   node create-session.js [options]
 *
 * Options:
 *   --cwd <path>        Working directory for the session (default: current dir)
 *   --summary <text>    Session summary/title (default: "Manual Session")
 *   --producer <name>   Producer name (default: "copilot-agent")
 *   --version <ver>     Copilot version string (default: "1.0.15")
 *   --id <uuid>         Session ID to use (default: auto-generated UUID)
 *   --prompt <text>     Initial user message prompt (default: "")
 *   --mode <mode>       Agent mode: autopilot, agent, plan (default: "autopilot")
 *   --help              Show this help
 */

import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--help") {
    printHelp();
    process.exit(0);
  }
  if (args[i].startsWith("--") && i + 1 < args.length) {
    opts[args[i].slice(2)] = args[++i];
  }
}

function printHelp() {
  console.log(`
create-session.js — manually create a Copilot CLI session

Usage: node create-session.js [options]

Options:
  --cwd <path>        Working directory for the session (default: current dir)
  --summary <text>    Session summary/title (default: "Manual Session")
  --producer <name>   Producer identifier (default: "copilot-agent")
  --version <ver>     Copilot version string (default: "1.0.15")
  --id <uuid>         Session ID to use (default: auto-generated UUID)
  --prompt <text>     Initial user message prompt (default: "")
  --mode <mode>       Agent mode: autopilot, agent, plan (default: "autopilot")
  --help              Show this help

When invoked with no arguments, an interactive prompt collects each value.
Press Enter to accept the shown default.
  `);
}

// ---------------------------------------------------------------------------
// Interactive mode (no args supplied)
// ---------------------------------------------------------------------------
async function promptDefaults() {
  const autoId = randomUUID();
  const defaults = {
    cwd: process.cwd(),
    summary: "Manual Session",
    producer: "copilot-agent",
    version: "1.0.15",
    id: autoId,
    prompt: "",
    agentMode: "autopilot",
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((res) => rl.question(question, res));

  console.log(
    "\ncreate-session — interactive mode (press Enter to accept defaults)\n",
  );

  const answers = {};
  for (const [key, def] of Object.entries(defaults)) {
    if (key === "agentMode") {
      let raw;
      do {
        raw = await ask(`  agentMode [${def}] (autopilot/agent/plan): `);
        raw = raw.trim() || def;
      } while (!["autopilot", "agent", "plan"].includes(raw));
      answers[key] = raw;
    } else {
      const raw = await ask(`  ${key} [${def}]: `);
      answers[key] = raw.trim() || String(def);
    }
  }

  rl.close();
  console.log();
  return answers;
}

// ---------------------------------------------------------------------------
// Resolve options
// ---------------------------------------------------------------------------
const interactive = args.length === 0;
if (interactive) {
  Object.assign(opts, await promptDefaults());
}

const cwd = resolve(opts.cwd ?? process.cwd());
const summary = opts.summary ?? "Manual Session";
const producer = opts.producer ?? "copilot-agent";
const copilotVersion = opts.version ?? "1.0.15";
const sessionId = opts.id ?? randomUUID();
const prompt = opts.prompt ?? "";
const agentMode = opts.agentMode ?? opts.mode ?? "autopilot";

const startTime = new Date();
const ts = (offsetMs) => new Date(startTime.getTime() + offsetMs).toISOString();

// ---------------------------------------------------------------------------
// Detect git info from cwd
// ---------------------------------------------------------------------------
function gitInfo(dir) {
  const run = (cmd) => {
    try {
      return execSync(cmd, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return null;
    }
  };

  const gitRoot = run("git rev-parse --show-toplevel");
  const branch = run("git rev-parse --abbrev-ref HEAD");

  // Try to get <owner>/<repo> from remote URL
  let repository = null;
  const remoteUrl = run("git remote get-url origin");
  if (remoteUrl) {
    // Handles both https://github.com/owner/repo.git and git@github.com:owner/repo.git
    const m = remoteUrl.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) repository = m[1];
  }

  return { gitRoot, branch, repository };
}

const git = gitInfo(cwd);

// ---------------------------------------------------------------------------
// Build paths
// ---------------------------------------------------------------------------
const xdgHome = process.env.XDG_STATE_HOME;
const copilotHome = xdgHome
  ? join(xdgHome, ".copilot")
  : join(homedir(), ".copilot");
const sessionDir = join(copilotHome, "session-state", sessionId);
const checkpointsDir = join(sessionDir, "checkpoints");

if (existsSync(sessionDir)) {
  console.error(`Error: session directory already exists:\n  ${sessionDir}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create directories
// ---------------------------------------------------------------------------
mkdirSync(join(sessionDir, "files"), { recursive: true });
mkdirSync(join(sessionDir, "research"), { recursive: true });
mkdirSync(checkpointsDir, { recursive: true });

// ---------------------------------------------------------------------------
// workspace.yaml
// ---------------------------------------------------------------------------
const yamlLines = [`id: ${sessionId}`, `cwd: ${cwd}`];
if (git.gitRoot) yamlLines.push(`git_root: ${git.gitRoot}`);
if (git.repository) {
  yamlLines.push(`repository: ${git.repository}`);
  yamlLines.push(`host_type: github`);
}
if (git.branch) yamlLines.push(`branch: ${git.branch}`);
yamlLines.push(`summary: ${summary}`);
yamlLines.push(`summary_count: 0`);
yamlLines.push(`created_at: ${ts(0)}`);
yamlLines.push(`updated_at: ${ts(0)}`);

writeFileSync(join(sessionDir, "workspace.yaml"), yamlLines.join("\n") + "\n");

// ---------------------------------------------------------------------------
// events.jsonl — session.start, mode changes, and initial user.message
// ---------------------------------------------------------------------------
const context = { cwd };
if (git.gitRoot) context.gitRoot = git.gitRoot;
if (git.repository) context.repository = git.repository;

const sessionStartId = randomUUID();
const sessionStartEvent = {
  type: "session.start",
  data: {
    sessionId,
    version: 1,
    producer,
    copilotVersion,
    startTime: ts(0),
    context,
    alreadyInUse: false,
    remoteSteerable: false,
  },
  id: sessionStartId,
  timestamp: ts(9),
  parentId: null,
};

const modeChange1Id = randomUUID();
const modeChange1Event = {
  type: "session.mode_changed",
  data: { previousMode: "interactive", newMode: "plan" },
  id: modeChange1Id,
  timestamp: ts(4070),
  parentId: sessionStartId,
};

const modeChange2Id = randomUUID();
const modeChange2Event = {
  type: "session.mode_changed",
  data: { previousMode: "plan", newMode: agentMode },
  id: modeChange2Id,
  timestamp: ts(4264),
  parentId: modeChange1Id,
};

const userMessageId = randomUUID();
const interactionId = randomUUID();
const userMessageEvent = {
  type: "user.message",
  data: {
    content: prompt,
    transformedContent: prompt,
    attachments: [],
    agentMode,
    interactionId,
  },
  id: userMessageId,
  timestamp: ts(16119),
  parentId: modeChange2Id,
};

const events = [sessionStartEvent, modeChange1Event];
if (agentMode !== "plan") events.push(modeChange2Event);
if (prompt) events.push(userMessageEvent);

writeFileSync(
  join(sessionDir, "events.jsonl"),
  events.map((e) => JSON.stringify(e)).join("\n") + "\n",
);

// ---------------------------------------------------------------------------
// checkpoints/index.md
// ---------------------------------------------------------------------------
const checkpointsMd = [
  "# Checkpoint History",
  "",
  "Checkpoints are listed in chronological order. Checkpoint 1 is the oldest, higher numbers are more recent.",
  "",
  "| # | Title | File |",
  "|---|-------|------|",
  "",
].join("\n");

writeFileSync(join(checkpointsDir, "index.md"), checkpointsMd);

// ---------------------------------------------------------------------------
// vscode.metadata.json (empty, written by VS Code when it opens the session)
// ---------------------------------------------------------------------------
writeFileSync(join(sessionDir, "vscode.metadata.json"), "{}");

// ---------------------------------------------------------------------------
// Register session in VS Code globalStorage so it appears in the Chat panel
// Tries common VS Code config paths; silently skips if none are found.
// ---------------------------------------------------------------------------
const vscodePaths = [
  join(
    homedir(),
    ".config",
    "Code",
    "User",
    "globalStorage",
    "github.copilot-chat",
    "copilotcli",
  ),
  join(
    homedir(),
    ".config",
    "Code - Insiders",
    "User",
    "globalStorage",
    "github.copilot-chat",
    "copilotcli",
  ),
  join(
    homedir(),
    ".config",
    "VSCodium",
    "User",
    "globalStorage",
    "github.copilot-chat",
    "copilotcli",
  ),
  join(
    homedir(),
    "Library",
    "Application Support",
    "Code",
    "User",
    "globalStorage",
    "github.copilot-chat",
    "copilotcli",
  ),
  join(
    homedir(),
    "AppData",
    "Roaming",
    "Code",
    "User",
    "globalStorage",
    "github.copilot-chat",
    "copilotcli",
  ),
];

let registeredInVSCode = false;
for (const dir of vscodePaths) {
  const metaFile = join(dir, "copilotcli.session.metadata.json");
  if (!existsSync(dir)) continue;
  try {
    const existing = existsSync(metaFile)
      ? JSON.parse(readFileSync(metaFile, "utf8"))
      : {};
    existing[sessionId] = { writtenToDisc: true };
    writeFileSync(metaFile, JSON.stringify(existing, null, 2));
    registeredInVSCode = true;
    break;
  } catch {
    // ignore and try next path
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log(`✅ Session created: ${sessionId}`);
console.log(`   Directory : ${sessionDir}`);
console.log(`   CWD       : ${cwd}`);
if (git.gitRoot) console.log(`   Git root  : ${git.gitRoot}`);
if (git.repository) console.log(`   Repository: ${git.repository}`);
if (git.branch) console.log(`   Branch    : ${git.branch}`);
console.log(`   Summary   : ${summary}`);
if (registeredInVSCode) {
  console.log(`   VS Code   : registered in Chat Sessions panel ✓`);
} else {
  console.log(
    `   VS Code   : globalStorage not found — session may not appear in Chat panel`,
  );
}
console.log();
console.log(`To resume this session in Copilot CLI:`);
console.log(`  copilot --resume ${sessionId}`);
