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
 *   --prompt <text>     Initial user message prompt (default: "")
 *   --mode <mode>       Agent mode: autopilot, agent, plan (default: "autopilot")
 *   --fast              Only ask for summary and prompt; use defaults for everything else
 *   --help              Show this help
 */

import { randomUUID } from "crypto";
import { execSync } from "child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "fs";
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
  if (args[i] === "--fast") {
    opts.fast = true;
    continue;
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
  --prompt <text>     Initial user message prompt (default: "")
  --mode <mode>       Agent mode: autopilot, agent, plan (default: "autopilot")
  --agent <name>      Load agent by name from .github/agents/<name>.agent.md
  --fast              Only ask for summary and prompt; use defaults for everything else
  --help              Show this help

When invoked with no arguments, an interactive prompt collects each value.
Press Enter to accept the shown default.
  `);
}

// ---------------------------------------------------------------------------
// Interactive mode (no args supplied)
// ---------------------------------------------------------------------------
async function promptDefaults() {
  const defaults = {
    cwd: process.cwd(),
    summary: "Manual Session",
    prompt: "",
    agentMode: "autopilot",
  };

  // Only ask for values not already provided via CLI args
  const needed = Object.entries(defaults).filter(([key]) => {
    const cliKey = key === "agentMode" ? "mode" : key;
    return opts[key] === undefined && opts[cliKey] === undefined;
  });

  if (needed.length === 0) {
    console.log(
      "\ncreate-session — interactive mode (all values provided via CLI)\n",
    );
    return {};
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((res) => rl.question(question, res));

  console.log(
    "\ncreate-session — interactive mode (press Enter to accept defaults)\n",
  );

  const answers = {};
  for (const [key, def] of needed) {
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
// Fast interactive mode (--fast flag: only asks summary and prompt)
// ---------------------------------------------------------------------------
async function promptFast() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((res) => rl.question(question, res));

  console.log(
    "\ncreate-session — fast mode (press Enter to accept defaults)\n",
  );

  const answers = {};

  if (!opts.summary) {
    const raw = await ask(`  summary [Manual Session]: `);
    answers.summary = raw.trim() || "Manual Session";
  }

  if (!opts.prompt) {
    const raw = await ask(`  prompt []: `);
    answers.prompt = raw.trim();
  }

  rl.close();
  console.log();
  return answers;
}

// ---------------------------------------------------------------------------
// Agent selection — scans .github/agents/*.agent.md in the given dir
// ---------------------------------------------------------------------------
async function selectAgent(dir) {
  const agentsDir = join(dir, ".github", "agents");
  if (!existsSync(agentsDir)) return null;

  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".agent.md"));
  if (files.length === 0) return null;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log("Available agents:");
  console.log("  0. None");
  files.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.replace(".agent.md", "")}`);
  });

  let choice;
  do {
    const raw = await ask(`\n  Select agent [0]: `);
    choice = parseInt(raw.trim() || "0", 10);
  } while (isNaN(choice) || choice < 0 || choice > files.length);

  rl.close();
  console.log();

  if (choice === 0) return null;

  const selectedFile = files[choice - 1];
  return readFileSync(join(agentsDir, selectedFile), "utf8");
}

// ---------------------------------------------------------------------------
// Resolve options
// ---------------------------------------------------------------------------
const hasAllArgs =
  opts.cwd &&
  opts.summary &&
  opts.prompt !== undefined &&
  (opts.mode || opts.agentMode);
const interactive = args.length === 0 || (!opts.fast && !hasAllArgs);
if (interactive) {
  Object.assign(opts, await promptDefaults());
} else if (opts.fast) {
  Object.assign(opts, await promptFast());
}

const cwd = resolve(opts.cwd ?? process.cwd());
const summary = opts.summary ?? "Manual Session";
const producer = "copilot-agent";
const copilotVersion = "1.0.15";
const sessionId = randomUUID();
const prompt = opts.prompt ?? "";
const agentMode = opts.agentMode ?? opts.mode ?? "autopilot";

// ---------------------------------------------------------------------------
// Agent selection (interactive and fast modes, or --agent flag)
// ---------------------------------------------------------------------------
let agentContent = null;
if (opts.agent) {
  const agentsDir = join(cwd, ".github", "agents");
  const agentFile = join(agentsDir, `${opts.agent}.agent.md`);
  if (!existsSync(agentFile)) {
    const available = existsSync(agentsDir)
      ? readdirSync(agentsDir)
          .filter((f) => f.endsWith(".agent.md"))
          .map((f) => f.replace(".agent.md", ""))
      : [];
    console.error(`Error: agent "${opts.agent}" not found in ${agentsDir}`);
    if (available.length > 0) {
      console.error(`Available agents: ${available.join(", ")}`);
    } else {
      console.error(`No agents found in .github/agents/`);
    }
    process.exit(1);
  }
  agentContent = readFileSync(agentFile, "utf8");
} else if (interactive || opts.fast) {
  agentContent = await selectAgent(cwd);
}

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

let transformedContent = prompt;
if (agentContent) {
  const datetime = ts(16119);
  transformedContent =
    `<agent_instructions>\n\n${agentContent}\n\n</agent_instructions>` +
    `\n\n<current_datetime>${datetime}</current_datetime>` +
    `\n\n${prompt}` +
    `\n<userRequest>\n${prompt}\n</userRequest>` +
    `\n\n\n<reminder>\n<sql_tables>No tables currently exist. Default tables (todos, todo_deps) will be created automatically when you first use the SQL tool.</sql_tables>\n</reminder>`;
}

const userMessageEvent = {
  type: "user.message",
  data: {
    content: prompt,
    transformedContent,
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
