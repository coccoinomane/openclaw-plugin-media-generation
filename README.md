# Media Generation OpenClaw plugin

Portable OpenClaw plugin for a dedicated media-generation workflow.

Ships:

- `skills/media-generation/SKILL.md` — caller-side routing and prompt-hygiene rules.
- `templates/agents/media/AGENTS.md` — bootstrap instructions for a dedicated `media` agent, including transparency/deviation logging.
- `templates/agents/media/TOOLS.md` — local CLI/provider notes for the media workspace.
- `openclaw media-generation doctor` — checks whether the dedicated media agent is configured.
- `openclaw media-generation setup-agent` — copies templates and patches `agents.list` explicitly.
- `bin/ideogram` — optional portable mcporter wrapper for the official Ideogram MCP.
- `config/mcporter.ideogram.json` — bundled public MCP server definition for that wrapper.

The plugin intentionally does **not** contain organization-specific references, so it can be reused in different OpenClaw installations and teams. It does not auto-create agents during install: creating an agent changes `openclaw.json`, so that step is explicit and discoverable through the plugin CLI.

## Why

Media prompts are easy to pollute: parent agents often mix creative prompt text with operational instructions such as provider choice, dimensions, delivery channel, or number of variants. This plugin centralizes the routing rule and keeps the media agent responsible for preserving the user's creative prompt.

The media agent is also expected to disclose notable deviations: provider fallbacks, quota/auth/timeouts, retries, prompt adaptations, partial batches, and material quality caveats. For non-trivial jobs it should write a small manifest beside the generated artifacts so successful outputs do not hide failed attempts.

## Install

From a local checkout of this repository:

```bash
git clone https://github.com/coccoinomane/openclaw-plugin-media-generation.git
openclaw plugins install ./openclaw-plugin-media-generation
```

For development on the same machine:

```bash
openclaw plugins install --link ./openclaw-plugin-media-generation
```

Enable the plugin if your installer did not do it automatically:

```json5
{
  plugins: {
    entries: {
      "media-generation": { enabled: true }
    }
  }
}
```

After install, check setup status:

```bash
openclaw media-generation doctor
```

## Use as a git submodule

In an OpenClaw configuration repository, you can track this plugin as a submodule:

```bash
git submodule add https://github.com/coccoinomane/openclaw-plugin-media-generation.git plugins-src/media-generation
git submodule update --init --recursive
openclaw plugins install --link ./plugins-src/media-generation
```

Release updates then become a normal submodule pointer update in the parent repository.

## Optional Ideogram CLI

The plugin bundles an optional Ideogram helper:

```bash
plugins/media-generation/bin/ideogram doctor
plugins/media-generation/bin/ideogram auth
plugins/media-generation/bin/ideogram call generate_image --args '{"prompt":"minimal GP monogram logo","aspect_ratio":"1x1"}'
```

It uses `mcporter` plus the bundled public config `config/mcporter.ideogram.json`, so it does not need an Ideogram entry in the user's global mcporter config. It does require `mcporter` on `PATH` and one OAuth login per machine/account (`ideogram auth`). Credentials are stored by mcporter outside the plugin and are never packaged.

If installed from the npm/tgz package, the plugin exposes the `ideogram` binary through package managers that link package bins. If installed by copying/linking the plugin into OpenClaw only, call `bin/ideogram` directly, use `setup-agent --install-ideogram-bin`, or symlink it into a trusted `PATH` directory. The wrapper resolves symlinks before locating its bundled config.

For convenience you can symlink it somewhere on `PATH`:

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/plugins/media-generation/bin/ideogram" ~/.local/bin/ideogram
```

## Configure the caller agent

If the caller agent uses an explicit skill allowlist, add `media-generation` to that list.

If subagent targets are restricted, allow the `media` agent. The setup helper can add explicit allowlists for existing agents:

```bash
openclaw media-generation setup-agent --allow-existing-agents
```

## Configure the media agent

Preferred path: run the setup helper.

```bash
openclaw media-generation setup-agent --dry-run
openclaw media-generation setup-agent
```

By default it copies templates to `~/.openclaw/workspace-media`, adds/updates the `media` entry in `agents.list`, and writes the config change through OpenClaw's runtime config mutation API.

Add `--install-ideogram-bin` if you also want a portable copy of the optional Ideogram wrapper and its bundled mcporter config in the media workspace:

```bash
openclaw media-generation setup-agent --install-ideogram-bin
```

Use custom values when needed:

```bash
openclaw media-generation setup-agent \
  --agent-id media \
  --workspace ~/.openclaw/workspace-media \
  --allow-caller main
```

If template or optional bin/config files already exist and differ, setup stops. Re-run with `--force` only when you intentionally want to overwrite those files, update an existing media-agent workspace path, or canonicalize an existing `media` agent's tool policy back to:

```json5
{ profile: "minimal", alsoAllow: ["group:media", "exec", "process"] }
```

Restart or reload the Gateway after setup before testing new agent config.

Manual equivalent: OpenClaw plugins expose skills, but they do not automatically create `agents.list[]` entries. Add/adapt a dedicated `media` agent in `openclaw.json` and copy/sync the template files into its workspace.

Minimal example:

```json5
{
  agents: {
    list: [
      {
        id: "media",
        workspace: "~/.openclaw/workspace-media",
        skills: [],
        tools: {
          profile: "minimal",
          alsoAllow: ["group:media", "exec", "process"]
        }
      }
    ]
  }
}
```

Then copy templates:

```bash
mkdir -p ~/.openclaw/workspace-media
cp plugins/media-generation/templates/agents/media/AGENTS.md ~/.openclaw/workspace-media/AGENTS.md
cp plugins/media-generation/templates/agents/media/TOOLS.md ~/.openclaw/workspace-media/TOOLS.md
```
