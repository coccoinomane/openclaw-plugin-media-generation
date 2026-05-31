import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const PLUGIN_ID = "media-generation";
const DEFAULT_AGENT_ID = "media";
const DEFAULT_WORKSPACE = "~/.openclaw/workspace-media";
const TEMPLATE_FILES = ["AGENTS.md", "TOOLS.md"];
const OPTIONAL_IDEOGRAM_FILES = [
  { name: "bin/ideogram", source: ["bin", "ideogram"], target: ["bin", "ideogram"], mode: 0o755 },
  { name: "config/mcporter.ideogram.json", source: ["config", "mcporter.ideogram.json"], target: ["config", "mcporter.ideogram.json"] },
];
const DEFAULT_AGENT_SKILLS = [];
const DEFAULT_AGENT_TOOL_PROFILE = "minimal";
const DEFAULT_AGENT_TOOL_ALLOW = ["group:media", "exec", "process"];
const LEGACY_AGENT_TOOL_POLICY_KEYS = ["allow", "elevated", "exec", "fs"];

function pluginRoot() {
  return dirname(fileURLToPath(import.meta.url));
}

function expandHome(path) {
  if (!path || path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function sameFileContent(source, target) {
  if (!existsSync(target)) return false;
  try {
    if (!statSync(target).isFile()) return false;
    return readFileSync(source, "utf8") === readFileSync(target, "utf8");
  } catch {
    return false;
  }
}

function repeatOption(value, previous) {
  previous.push(value);
  return previous;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalMediaAgentTools() {
  return {
    profile: DEFAULT_AGENT_TOOL_PROFILE,
    alsoAllow: [...DEFAULT_AGENT_TOOL_ALLOW],
  };
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function samePath(a, b) {
  return resolve(expandHome(a)) === resolve(expandHome(b));
}

function workspaceFileSet({ workspace, installIdeogramBin = false }) {
  const root = pluginRoot();
  const workspaceDir = resolve(expandHome(workspace));
  const templateSourceDir = join(root, "templates", "agents", "media");
  const files = TEMPLATE_FILES.map((name) => ({
    name,
    source: join(templateSourceDir, name),
    target: join(workspaceDir, name),
    kind: "template",
  }));

  if (installIdeogramBin) {
    for (const file of OPTIONAL_IDEOGRAM_FILES) {
      files.push({
        name: file.name,
        source: join(root, ...file.source),
        target: join(workspaceDir, ...file.target),
        kind: "ideogram",
        mode: file.mode,
      });
    }
  }

  return files;
}

function inspectTemplates({ workspace, installIdeogramBin = false }) {
  return workspaceFileSet({ workspace, installIdeogramBin }).map((file) => {
    const sourceExists = existsSync(file.source);
    const targetExists = existsSync(file.target);
    let modeOk = true;
    if (targetExists && file.mode !== undefined) {
      try {
        modeOk = (statSync(file.target).mode & 0o777) === file.mode;
      } catch {
        modeOk = false;
      }
    }
    const identical = sourceExists && targetExists && sameFileContent(file.source, file.target) && modeOk;
    return { ...file, sourceExists, targetExists, modeOk, identical };
  });
}

function mergeMediaAgentDefaults(existing, { agentId, workspace, force = false }) {
  const agent = existing && typeof existing === "object" ? cloneJson(existing) : { id: agentId };
  const errors = [];
  let changed = false;

  if (agent.id !== agentId) {
    agent.id = agentId;
    changed = true;
  }

  if (agent.workspace === undefined) {
    agent.workspace = workspace;
    changed = true;
  } else if (!samePath(agent.workspace, workspace)) {
    if (!force) {
      errors.push(`Agent '${agentId}' already exists with workspace '${agent.workspace}'. Re-run with --force to update it to '${workspace}'.`);
    } else {
      agent.workspace = workspace;
      changed = true;
    }
  }

  if (agent.skills === undefined) {
    agent.skills = [...DEFAULT_AGENT_SKILLS];
    changed = true;
  } else if (!Array.isArray(agent.skills)) {
    if (!force) {
      errors.push(`Agent '${agentId}' has non-array skills config; update it manually or re-run with --force.`);
    } else {
      agent.skills = [...DEFAULT_AGENT_SKILLS];
      changed = true;
    }
  }

  if (agent.tools === undefined) {
    agent.tools = canonicalMediaAgentTools();
    changed = true;
  } else if (!agent.tools || typeof agent.tools !== "object" || Array.isArray(agent.tools)) {
    if (!force) {
      errors.push(`Agent '${agentId}' has non-object tools config; update it manually or re-run with --force.`);
    } else {
      agent.tools = canonicalMediaAgentTools();
      changed = true;
    }
  } else if (force) {
    const canonicalTools = canonicalMediaAgentTools();
    if (!jsonEqual(agent.tools, canonicalTools)) {
      agent.tools = canonicalTools;
      changed = true;
    }
  } else {
    const tools = { ...agent.tools };
    if (tools.profile === undefined) {
      tools.profile = DEFAULT_AGENT_TOOL_PROFILE;
      changed = true;
    } else if (tools.profile !== DEFAULT_AGENT_TOOL_PROFILE) {
      errors.push(`Agent '${agentId}' tools.profile is '${tools.profile}', expected '${DEFAULT_AGENT_TOOL_PROFILE}'. Re-run with --force to update it.`);
    }

    if (tools.alsoAllow === undefined) {
      tools.alsoAllow = [...DEFAULT_AGENT_TOOL_ALLOW];
      changed = true;
    } else if (!Array.isArray(tools.alsoAllow)) {
      errors.push(`Agent '${agentId}' tools.alsoAllow is not an array; update it manually or re-run with --force.`);
    } else {
      const nextAllow = uniqueStrings([...tools.alsoAllow, ...DEFAULT_AGENT_TOOL_ALLOW]);
      if (nextAllow.length !== tools.alsoAllow.length) {
        tools.alsoAllow = nextAllow;
        changed = true;
      }
    }

    agent.tools = tools;
  }

  return { agent, changed, errors };
}

function resolveAllowCallers(config, { agentId, allowCallers = [], allowExistingAgents = false }) {
  const currentAgents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const existing = allowExistingAgents
    ? currentAgents.map((agent) => agent?.id).filter((id) => typeof id === "string" && id !== agentId)
    : [];
  return uniqueStrings([...allowCallers, ...existing]);
}

function computeAgentPatch(config, { agentId, workspace, allowCallers = [], allowExistingAgents = false, force = false }) {
  const currentAgents = Array.isArray(config?.agents?.list) ? cloneJson(config.agents.list) : [];
  const agents = currentAgents.map((agent) => (agent && typeof agent === "object" ? agent : {}));
  const errors = [];
  let changed = false;

  const existingIndex = agents.findIndex((agent) => agent.id === agentId);
  if (existingIndex === -1) {
    agents.push({
      id: agentId,
      workspace,
      skills: [...DEFAULT_AGENT_SKILLS],
      tools: canonicalMediaAgentTools(),
    });
    changed = true;
  } else {
    const merged = mergeMediaAgentDefaults(agents[existingIndex], { agentId, workspace, force });
    agents[existingIndex] = merged.agent;
    changed = changed || merged.changed;
    errors.push(...merged.errors);
  }

  for (const callerId of resolveAllowCallers(config, { agentId, allowCallers, allowExistingAgents })) {
    const callerIndex = agents.findIndex((agent) => agent.id === callerId);
    if (callerIndex === -1) {
      errors.push(`Caller agent '${callerId}' was not found in agents.list.`);
      continue;
    }
    const caller = agents[callerIndex];
    const currentAllow = caller.subagents?.allowAgents;
    if (Array.isArray(currentAllow)) {
      if (!currentAllow.includes("*") && !currentAllow.includes(agentId)) {
        caller.subagents = { ...(caller.subagents ?? {}), allowAgents: [...currentAllow, agentId] };
        changed = true;
      }
    } else if (currentAllow === undefined) {
      caller.subagents = { ...(caller.subagents ?? {}), allowAgents: [agentId] };
      changed = true;
    } else {
      errors.push(`Caller agent '${callerId}' has non-array subagents.allowAgents; update it manually.`);
    }
  }

  return {
    changed,
    errors,
    patch: { agents: { list: agents } },
  };
}

function copyTemplates({ workspace, dryRun = false, force = false, installIdeogramBin = false }) {
  const files = inspectTemplates({ workspace, installIdeogramBin });
  const missingSources = files.filter((file) => !file.sourceExists);
  if (missingSources.length > 0) {
    throw new Error(`Plugin setup source files are missing: ${missingSources.map((file) => file.source).join(", ")}`);
  }

  const conflicts = files.filter((file) => file.targetExists && !file.identical);
  if (conflicts.length > 0 && !force) {
    throw new Error(`Workspace already contains different file(s): ${conflicts.map((file) => file.target).join(", ")}. Re-run with --force to overwrite them.`);
  }

  if (!dryRun) {
    const workspaceDir = resolve(expandHome(workspace));
    mkdirSync(workspaceDir, { recursive: true });
    for (const file of files) {
      if (file.identical) continue;
      mkdirSync(dirname(file.target), { recursive: true });
      copyFileSync(file.source, file.target);
      if (file.mode !== undefined) chmodSync(file.target, file.mode);
    }
  }

  return files.map((file) => ({
    file: file.name,
    target: file.target,
    action: file.identical ? "unchanged" : file.targetExists ? "overwrite" : "create",
  }));
}

function hasSpawnAllowance(config, agentId) {
  const defaults = config?.agents?.defaults?.subagents?.allowAgents;
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const defaultAllows = Array.isArray(defaults) && (defaults.includes("*") || defaults.includes(agentId));
  const callers = agents
    .filter((agent) => {
      const allow = agent?.subagents?.allowAgents;
      return Array.isArray(allow) && (allow.includes("*") || allow.includes(agentId));
    })
    .map((agent) => agent.id)
    .filter(Boolean);
  return { defaultAllows, callers };
}

function mediaAgentIssues(agent, workspace) {
  if (!agent) return ["agent missing"];
  const issues = [];
  if (!agent.workspace || !samePath(agent.workspace, workspace)) issues.push(`workspace is '${agent.workspace ?? "missing"}'`);
  if (!Array.isArray(agent.skills) || agent.skills.length !== 0) issues.push("skills is not []");
  const tools = agent.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    issues.push("tools config missing");
  } else {
    if (tools.profile !== DEFAULT_AGENT_TOOL_PROFILE) issues.push(`tools.profile is '${tools.profile ?? "missing"}'`);
    const alsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : [];
    const missingTools = DEFAULT_AGENT_TOOL_ALLOW.filter((name) => !alsoAllow.includes(name));
    if (missingTools.length > 0) issues.push(`tools.alsoAllow missing ${missingTools.join(", ")}`);
    const legacyKeys = LEGACY_AGENT_TOOL_POLICY_KEYS.filter((key) => Object.hasOwn(tools, key));
    if (legacyKeys.length > 0) issues.push(`legacy tools fields present (${legacyKeys.join(", ")}); run setup-agent --force to canonicalize`);
  }
  return issues;
}

function setupCommandPreview(opts) {
  const parts = ["openclaw", "media-generation", "setup-agent", "--agent-id", opts.agentId, "--workspace", opts.workspace];
  if (opts.installIdeogramBin) parts.push("--install-ideogram-bin");
  return parts.join(" ");
}

function registerMediaGenerationCli({ program, config }, api) {
  const root = program
    .command("media-generation")
    .description("Set up and diagnose the OpenClaw media-generation agent template");

  root
    .command("doctor")
    .description("Check whether the media-generation agent workspace/config are present")
    .option("--agent-id <id>", "Media agent id", DEFAULT_AGENT_ID)
    .option("--workspace <path>", "Media agent workspace path", DEFAULT_WORKSPACE)
    .option("--install-ideogram-bin", "Also check the optional Ideogram MCP wrapper and config under the media workspace", false)
    .action((opts) => {
      const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
      const agent = agents.find((entry) => entry?.id === opts.agentId);
      const templates = inspectTemplates({ workspace: opts.workspace, installIdeogramBin: Boolean(opts.installIdeogramBin) });
      const allowance = hasSpawnAllowance(config, opts.agentId);

      console.log("Media Generation doctor");
      console.log(`- Agent '${opts.agentId}': ${agent ? "configured" : "missing"}`);
      if (agent?.workspace) console.log(`  workspace in config: ${agent.workspace}`);
      const issues = mediaAgentIssues(agent, opts.workspace);
      if (agent) {
        console.log(`- Agent config: ${issues.length === 0 ? "complete" : `incomplete (${issues.join("; ")})`}`);
      }
      console.log(`- Expected workspace: ${opts.workspace}`);
      for (const file of templates) {
        const sourceLabel = file.kind === "ideogram" ? "source missing from plugin" : "template missing from plugin";
        const status = !file.sourceExists ? sourceLabel : file.identical ? "present" : file.targetExists ? "different" : "missing";
        console.log(`- ${file.name}: ${status} (${file.target})`);
      }
      if (allowance.defaultAllows) {
        console.log(`- Subagent allowlist: agents.defaults allows '${opts.agentId}'`);
      } else if (allowance.callers.length > 0) {
        console.log(`- Subagent allowlist: caller agent(s) allowing '${opts.agentId}': ${allowance.callers.join(", ")}`);
      } else {
        console.log(`- Subagent allowlist: no caller allowlist for '${opts.agentId}' detected; add one if your OpenClaw restricts explicit agent targets.`);
      }

      if (!agent || issues.length > 0 || templates.some((file) => !file.identical)) {
        console.log("");
        console.log("Suggested setup:");
        console.log(`  ${setupCommandPreview(opts)}`);
        console.log("Then restart/reload the Gateway before testing new agent config.");
      }
    });

  root
    .command("setup-agent")
    .description("Create/update the media agent workspace and patch agents.list explicitly")
    .option("--agent-id <id>", "Media agent id", DEFAULT_AGENT_ID)
    .option("--workspace <path>", "Media agent workspace path", DEFAULT_WORKSPACE)
    .option("--allow-caller <id>", "Also allow this caller agent to spawn the media agent; repeatable", repeatOption, [])
    .option("--allow-existing-agents", "Allow all currently configured agents to spawn the media agent", false)
    .option("--install-ideogram-bin", "Also copy the optional Ideogram MCP wrapper and config under the media workspace", false)
    .option("--force", "Overwrite differing template/bin/config files and update an existing agent workspace", false)
    .option("--dry-run", "Validate and print planned changes without writing", false)
    .action(async (opts) => {
      const plan = computeAgentPatch(config, {
        agentId: opts.agentId,
        workspace: opts.workspace,
        allowCallers: opts.allowCaller,
        allowExistingAgents: Boolean(opts.allowExistingAgents),
        force: Boolean(opts.force),
      });
      if (plan.errors.length > 0) {
        for (const error of plan.errors) console.error(`Error: ${error}`);
        process.exitCode = 1;
        return;
      }

      const templateActions = copyTemplates({
        workspace: opts.workspace,
        dryRun: true,
        force: Boolean(opts.force),
        installIdeogramBin: Boolean(opts.installIdeogramBin),
      });
      console.log(opts.dryRun ? "Planned media agent setup:" : "Applying media agent setup:");
      for (const action of templateActions) console.log(`- ${action.action} ${action.target}`);
      console.log(plan.changed ? `- patch OpenClaw config agents.list for agent '${opts.agentId}' and media tool policy` : "- OpenClaw config already contains the requested media agent setup");
      if (opts.allowCaller.length > 0) console.log(`- requested caller allowlist update(s): ${opts.allowCaller.join(", ")}`);
      if (opts.allowExistingAgents) console.log("- requested caller allowlist update: all existing agents");

      if (opts.dryRun) {
        console.log("Dry run complete. Re-run without --dry-run to apply.");
        return;
      }

      copyTemplates({
        workspace: opts.workspace,
        dryRun: false,
        force: Boolean(opts.force),
        installIdeogramBin: Boolean(opts.installIdeogramBin),
      });
      if (plan.changed) {
        await api.runtime.config.mutateConfigFile({
          base: "runtime",
          afterWrite: { mode: "auto" },
          mutate(draft) {
            const livePlan = computeAgentPatch(draft, {
              agentId: opts.agentId,
              workspace: opts.workspace,
              allowCallers: opts.allowCaller,
              allowExistingAgents: Boolean(opts.allowExistingAgents),
              force: Boolean(opts.force),
            });
            if (livePlan.errors.length > 0) throw new Error(livePlan.errors.join("\n"));
            draft.agents ??= {};
            draft.agents.list = livePlan.patch.agents.list;
          },
        });
      }
      console.log("Media agent setup complete. Restart/reload the Gateway before testing new agent config.");
    });

  root.action(() => {
    root.outputHelp();
    process.exitCode = 0;
  });
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Media Generation",
  description: "Portable media generation workflow, media agent template, and optional Ideogram MCP wrapper.",
  register(api) {
    api.registerCli((ctx) => registerMediaGenerationCli(ctx, api), {
      descriptors: [
        {
          name: "media-generation",
          description: "Set up and diagnose the OpenClaw media-generation agent template",
          hasSubcommands: true,
        },
      ],
    });
  },
});
