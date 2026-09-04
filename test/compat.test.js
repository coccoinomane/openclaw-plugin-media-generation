import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeAgentPatch, detectRosterKind, findMediaToolDenials } from "../lib/agent-config.js";
import { copyTemplates } from "../lib/workspace.js";

const pluginRoot = join(import.meta.dirname, "..");

test("legacy list roster is patched without changing its representation", () => {
  const config = { agents: { list: [{ id: "main", tools: { profile: "full" } }] } };
  const result = computeAgentPatch(config, { agentId: "media", workspace: "/tmp/media", allowCallers: ["main"] });
  assert.equal(result.kind, "list");
  assert.equal(result.errors.length, 0);
  assert.equal(result.patch.agents.entries, undefined);
  assert.deepEqual(result.patch.agents.list[0].subagents.allowAgents, ["media"]);
  assert.equal(result.patch.agents.list[1].id, "media");
});

test("canonical keyed entries are patched without injecting an id field", () => {
  const config = { agents: { entries: { main: { tools: { profile: "full" } } } } };
  const result = computeAgentPatch(config, { agentId: "media", workspace: "/tmp/media", allowCallers: ["main"] });
  assert.equal(result.kind, "entries");
  assert.equal(result.errors.length, 0);
  assert.equal(result.patch.agents.entries.media.id, undefined);
  assert.deepEqual(result.patch.agents.entries.main.subagents.allowAgents, ["media"]);
});

test("entries win when both roster fields are present", () => {
  const config = { agents: { list: [{ id: "legacy" }], entries: { main: {} } } };
  const result = computeAgentPatch(config, { agentId: "media", workspace: "/tmp/media" });
  assert.equal(result.kind, "entries");
  assert.equal(result.patch.agents.list, undefined);
  assert.deepEqual(config.agents.list, [{ id: "legacy" }]);
  assert.ok(result.patch.agents.entries.media);
});

test("new runtime inference selects entries only when no roster field exists", () => {
  assert.equal(detectRosterKind({}, { runtimeVersion: "2026.9.1" }), "entries");
  assert.equal(detectRosterKind({}, { runtimeVersion: "2026.7.1" }), "list");
  assert.equal(detectRosterKind({ $schema: "https://example/agents.entries.schema.json" }), "entries");
  assert.equal(detectRosterKind({}, { schema: { properties: { agents: { properties: { entries: {} } } } } }), "entries");
});

test("doctor policy inspection reports inherited and caller media denies", () => {
  const config = {
    tools: { deny: ["group:media"] },
    agents: { defaults: { tools: { deny: ["image_generate"] } }, entries: { main: { tools: { deny: ["video_generate"] } }, media: {} } },
  };
  const warnings = findMediaToolDenials(config, "media", { runtimeVersion: "2026.9.1" });
  assert.deepEqual(warnings.map((warning) => warning.name), ["group:media", "image_generate", "video_generate"]);
});

test("default setup preserves customized AGENTS.md; force backs it up, and dry-run does not write", () => {
  const workspace = mkdtempSync(join(tmpdir(), "media-generation-"));
  const agentsPath = join(workspace, "AGENTS.md");
  writeFileSync(agentsPath, "custom local instructions\n");
  const before = readdirSync(workspace);
  const preserved = copyTemplates({ workspace, pluginRoot });
  assert.equal(preserved[0].action, "preserved");
  assert.equal(readFileSync(agentsPath, "utf8"), "custom local instructions\n");
  const planned = copyTemplates({ workspace, pluginRoot, dryRun: true, force: true });
  assert.equal(planned[0].action, "overwrite");
  assert.deepEqual(readdirSync(workspace), before);
  const applied = copyTemplates({ workspace, pluginRoot, force: true });
  assert.equal(applied[0].backups.length, 1);
  assert.equal(readFileSync(agentsPath, "utf8").includes("## Tools"), true);
  assert.equal(readFileSync(applied[0].backups[0], "utf8"), "custom local instructions\n");
});

test("retired TOOLS.md is not shipped and new AGENTS contains its local notes", () => {
  assert.equal(existsSync(join(pluginRoot, "templates", "agents", "media", "TOOLS.md")), false);
  const agents = readFileSync(join(pluginRoot, "templates", "agents", "media", "AGENTS.md"), "utf8");
  assert.match(agents, /^## Tools$/m);
  assert.match(agents, /Ideogram MCP wrapper/);
});

test("manifest advertises the root CLI while retaining compatibility metadata", () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "openclaw.plugin.json"), "utf8"));
  assert.equal(manifest.version, "0.2.7");
  assert.deepEqual(manifest.cliCommands, [{ name: "media-generation", description: "Set up and diagnose the OpenClaw media-generation agent template", hasSubcommands: true }]);
  assert.deepEqual(manifest.commandAliases, [{ name: "media-generation" }]);
  assert.deepEqual(manifest.activation, { onStartup: false, onCommands: ["media-generation"] });
});
