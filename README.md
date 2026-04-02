# clipilot

> ⚠️ **Experimental project — use at your own risk.**

A small Node.js utility that manually bootstraps a [GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/about-assigning-tasks-to-copilot) session on disk, replicating the exact session-state structure that the Copilot agent normally produces.

## Why does this exist?

The GitHub Copilot CLI is a powerful agentic coding tool, but it is not always accessible:

- It may not be available in your environment (CI, remote servers, locked-down machines).
- You may want to **script** or **automate** session creation without launching an interactive VS Code window.
- You may want to pre-populate a session with a specific prompt, working directory, or custom agent instructions before handing it off.

`clipilot` fills that gap: it writes the session files (`workspace.yaml`, `events.jsonl`, checkpoint index, VS Code metadata) directly to `~/.copilot/session-state/`, so that when Copilot CLI is eventually available it can resume the session exactly as if it had created it itself.

## Features

- Interactive, fast (`--fast`), or fully CLI-driven session creation
- Selects agent mode: `autopilot`, `agent`, or `plan`
- Auto-detects git repository, branch, and remote from the working directory
- Loads custom agent instructions from `.github/agents/<name>.agent.md`
- Registers the new session in VS Code's global storage so it appears in the **Chat Sessions** panel automatically (supports Code, Code Insiders, VSCodium, macOS, and Windows paths)

## Requirements

- Node.js 18 or later (uses native ESM)
- A GitHub Copilot subscription with Copilot CLI access (for resuming the session)

## Installation

```bash
npm install -g clipilot
```

Or run without installing:

```bash
npx clipilot
```

## Usage

```bash
# Interactive — prompts for each value
clipilot

# Fast mode — only prompts for summary and prompt; uses defaults for the rest
clipilot --fast

# Fully scripted
clipilot \
  --cwd /path/to/project \
  --summary "Fix login bug" \
  --prompt "Investigate why JWT tokens expire too early" \
  --mode autopilot \
  --agent my-agent   # loads .github/agents/my-agent.agent.md
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--cwd <path>` | Working directory for the session | Current directory |
| `--summary <text>` | Session title shown in the Chat panel | `"Manual Session"` |
| `--prompt <text>` | Initial user message sent to the agent | _(empty)_ |
| `--mode <mode>` | Agent mode: `autopilot`, `agent`, or `plan` | `autopilot` |
| `--agent <name>` | Load agent instructions from `.github/agents/<name>.agent.md` | _(none)_ |
| `--fast` | Only prompt for summary and prompt; use defaults for everything else | — |
| `--help` | Show help | — |

### Resuming the session

After the script runs it prints the session ID. Resume it with:

```bash
copilot --resume <session-id>
```

Or open VS Code — the session will appear in the **Copilot Chat Sessions** panel ready to continue.

## How it works

The Copilot CLI stores its session state as a directory under `~/.copilot/session-state/<uuid>/`. Each session contains:

| File | Purpose |
|------|---------|
| `workspace.yaml` | Session metadata: id, cwd, git info, summary, timestamps |
| `events.jsonl` | Ordered event log: session start, mode changes, user messages |
| `checkpoints/index.md` | Checkpoint history (empty for new sessions) |
| `vscode.metadata.json` | Opaque metadata written by VS Code |

`create-session.js` constructs all of these files from scratch and also updates the VS Code global storage file (`copilotcli.session.metadata.json`) so that the Chat panel discovers the new session.

## Disclaimer

This project reverse-engineers the internal session-state format of the Copilot CLI. That format is **not a public API** and may change at any time. Treat this as a best-effort experiment — things may break on updates to GitHub Copilot.

**Use at your own risk.**

## License

This project is released into the public domain under the [Unlicense](LICENSE.md) — do whatever you want with it.

The `doc/` directory contains reference material from the VS Code Copilot Chat extension; see [doc/vscode-copilot-chat/LICENSE.txt](doc/vscode-copilot-chat/LICENSE.txt) for its licence.
