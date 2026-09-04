import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  computeAgentPatch,
  findMediaToolDenials,
  hasSpawnAllowance,
  mediaAgentIssues,
  readAgentRoster,
  rosterAgentRecords,
} from "./lib/agent-config.js";
import { copyTemplates, inspectTemplates, legacyWorkspaceFiles } from "./lib/workspace.js";

const PLUGIN_ID = "media-generation";
const DEFAULT_AGENT_ID = "media";
const DEFAULT_WORKSPACE = "~/.openclaw/workspace-media";

function pluginRoot() {
  return dirname(fileURLToPath(import.meta.url));
}

function repeatOption(value, previous) {
  previous.push(value);
  return previous;
}

function setupCommandPreview(opts) {
  const parts = ["openclaw", "media-generation", "setup-agent", "--agent-id", opts.agentId, "--workspace", opts.workspace];
  if (opts.installIdeogramBin) parts.push("--install-ideogram-bin");
  return parts.join(" ");
}

function registerMediaGenerationCli({ program, config }, api) {
  const rosterOptions = { runtimeVersion: api?.runtime?.version };
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
      const records = rosterAgentRecords(config, rosterOptions);
      const agent = records.find(({ id }) => id === opts.agentId)?.agent;
      const roster = readAgentRoster(config, rosterOptions);
      const templates = inspectTemplates({ pluginRoot: pluginRoot(), workspace: opts.workspace, installIdeogramBin: Boolean(opts.installIdeogramBin) });
      const legacyTools = legacyWorkspaceFiles({ workspace: opts.workspace }).filter((file) => existsSync(file.target));
      const allowance = hasSpawnAllowance(config, opts.agentId, rosterOptions);

      console.log("Media Generation doctor");
      console.log(`- Agent roster: ${roster.kind} (canonical agents.entries${roster.kind === "entries" ? "" : " compatibility"})`);
      console.log(`- Agent '${opts.agentId}': ${agent ? "configured" : "missing"}`);
      if (agent?.workspace) console.log(`  workspace in config: ${agent.workspace}`);
      const issues = mediaAgentIssues(agent, opts.workspace);
      if (agent) {
        console.log(`- Agent config: ${issues.length === 0 ? "complete" : `incomplete (${issues.join("; ")})`}`);
      }
      console.log(`- Expected workspace: ${opts.workspace}`);
      for (const file of templates) {
        const sourceLabel = file.kind === "ideogram" ? "source missing from plugin" : "template missing from plugin";
        const status = !file.sourceExists ? sourceLabel : file.identical ? "present" : file.targetExists && file.kind === "template" ? "customized (preserved)" : file.targetExists ? "different" : "missing";
        console.log(`- ${file.name}: ${status} (${file.target})`);
      }
      if (legacyTools.length > 0) {
        console.log(`- TOOLS.md: legacy file present (${legacyTools[0].target}); preserved. Its notes are available in the new AGENTS.md template; review manually if this workspace has not been migrated.`);
      }
      const mediaDenials = findMediaToolDenials(config, opts.agentId, rosterOptions);
      if (mediaDenials.length > 0) {
        console.log(`- Media tool policy: warning; caller/inherited deny blocks ${mediaDenials.map(({ source, name }) => `${source}=${name}`).join(", ")}. Review manually; setup will not widen permissions.`);
      }
      if (allowance.defaultAllows) {
        console.log(`- Subagent allowlist: agents.defaults allows '${opts.agentId}'`);
      } else if (allowance.callers.length > 0) {
        console.log(`- Subagent allowlist: caller agent(s) allowing '${opts.agentId}': ${allowance.callers.join(", ")}`);
      } else {
        console.log(`- Subagent allowlist: no caller allowlist for '${opts.agentId}' detected; add one if your OpenClaw restricts explicit agent targets.`);
      }

      if (!agent || issues.length > 0 || templates.some((file) => !file.targetExists || !file.sourceExists || (file.kind !== "template" && !file.identical))) {
        console.log("");
        console.log("Suggested setup:");
        console.log(`  ${setupCommandPreview(opts)}`);
        console.log("Then restart/reload the Gateway before testing new agent config.");
      }
    });

  root
    .command("setup-agent")
    .description("Create/update the media agent workspace and patch the configured agent roster explicitly")
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
        runtimeVersion: rosterOptions.runtimeVersion,
      });
      if (plan.errors.length > 0) {
        for (const error of plan.errors) console.error(`Error: ${error}`);
        process.exitCode = 1;
        return;
      }

      const templateActions = copyTemplates({
        pluginRoot: pluginRoot(),
        workspace: opts.workspace,
        dryRun: true,
        force: Boolean(opts.force),
        installIdeogramBin: Boolean(opts.installIdeogramBin),
      });
      console.log(opts.dryRun ? "Planned media agent setup:" : "Applying media agent setup:");
      for (const action of templateActions) console.log(`- ${action.action} ${action.target}`);
      console.log(plan.changed ? `- patch OpenClaw config agents.${plan.kind} for agent '${opts.agentId}' and media tool policy` : "- OpenClaw config already contains the requested media agent setup");
      if (opts.allowCaller.length > 0) console.log(`- requested caller allowlist update(s): ${opts.allowCaller.join(", ")}`);
      if (opts.allowExistingAgents) console.log("- requested caller allowlist update: all existing agents");

      if (opts.dryRun) {
        console.log("Dry run complete. Re-run without --dry-run to apply.");
        return;
      }

      copyTemplates({
        pluginRoot: pluginRoot(),
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
              runtimeVersion: rosterOptions.runtimeVersion,
            });
            if (livePlan.errors.length > 0) throw new Error(livePlan.errors.join("\n"));
            draft.agents ??= {};
            if (livePlan.kind === "entries") draft.agents.entries = livePlan.patch.agents.entries;
            else draft.agents.list = livePlan.patch.agents.list;
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
