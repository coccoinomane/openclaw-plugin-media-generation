import { resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_AGENT_TOOL_PROFILE = "minimal";
const DEFAULT_AGENT_TOOL_ALLOW = ["group:media", "exec", "process"];
const DEFAULT_AGENT_SKILLS = [];

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function versionAtLeast(version, minimum) {
  const actual = String(version ?? "").match(/(\d{4})\.(\d+)(?:\.(\d+))?/);
  const wanted = minimum.match(/(\d{4})\.(\d+)(?:\.(\d+))?/);
  if (!actual || !wanted) return false;
  const left = actual.slice(1).map((part) => Number(part ?? 0));
  const right = wanted.slice(1).map((part) => Number(part ?? 0));
  return left[0] > right[0] || (left[0] === right[0] && (left[1] > right[1] || (left[1] === right[1] && left[2] >= right[2])));
}

function schemaDeclaresEntries(schema) {
  if (typeof schema === "string") return schema.includes("agents.entries") || schema.includes("agents/entries");
  if (!isRecord(schema)) return false;
  const agents = schema.properties?.agents;
  if (isRecord(agents) && isRecord(agents.properties) && Object.hasOwn(agents.properties, "entries")) return true;
  return false;
}

/**
 * Select the roster representation without silently converting an existing
 * configuration. Canonical keyed entries win when both fields are present.
 */
export function detectRosterKind(config, { runtimeVersion, schema } = {}) {
  const agents = config?.agents;
  if (isRecord(agents) && Object.hasOwn(agents, "entries")) return "entries";
  if (isRecord(agents) && Object.hasOwn(agents, "list")) return "list";

  const schemaValue = schema ?? config?.$schema ?? "";
  if (schemaDeclaresEntries(schemaValue) || versionAtLeast(runtimeVersion, "2026.9")) return "entries";
  return "list";
}

export function readAgentRoster(config, options = {}) {
  const kind = detectRosterKind(config, options);
  const agents = isRecord(config?.agents) ? config.agents : {};
  if (kind === "entries") {
    return {
      kind,
      entries: isRecord(agents.entries) ? cloneJson(agents.entries) : {},
    };
  }
  return {
    kind,
    list: Array.isArray(agents.list) ? cloneJson(agents.list) : [],
  };
}

export function rosterAgentRecords(config, options = {}) {
  const roster = readAgentRoster(config, options);
  if (roster.kind === "entries") {
    return Object.entries(roster.entries).map(([id, agent]) => ({
      id,
      agent: isRecord(agent) ? agent : {},
    }));
  }
  return roster.list.map((agent) => ({
    id: isRecord(agent) && typeof agent.id === "string" ? agent.id : undefined,
    agent: isRecord(agent) ? agent : {},
  }));
}

export function canonicalMediaAgentTools() {
  return {
    profile: DEFAULT_AGENT_TOOL_PROFILE,
    alsoAllow: [...DEFAULT_AGENT_TOOL_ALLOW],
  };
}

function samePath(a, b) {
  const expand = (value) => {
    const text = String(value ?? "");
    return text === "~" ? homedir() : text.startsWith("~/") ? `${homedir()}/${text.slice(2)}` : text;
  };
  return resolve(expand(a)) === resolve(expand(b));
}

function mergeMediaAgentDefaults(existing, { agentId, workspace, force = false, keyed = false }) {
  const agent = existing && typeof existing === "object" ? cloneJson(existing) : {};
  const errors = [];
  let changed = false;

  if (!keyed && agent.id !== agentId) {
    agent.id = agentId;
    changed = true;
  }
  if (keyed && Object.hasOwn(agent, "id")) {
    delete agent.id;
    changed = true;
  }

  if (agent.workspace === undefined) {
    agent.workspace = workspace;
    changed = true;
  } else if (!samePath(agent.workspace, workspace)) {
    if (!force) errors.push(`Agent '${agentId}' already exists with workspace '${agent.workspace}'. Re-run with --force to update it to '${workspace}'.`);
    else {
      agent.workspace = workspace;
      changed = true;
    }
  }
  if (agent.skills === undefined) {
    agent.skills = [...DEFAULT_AGENT_SKILLS];
    changed = true;
  } else if (!Array.isArray(agent.skills)) {
    if (!force) errors.push(`Agent '${agentId}' has non-array skills config; update it manually or re-run with --force.`);
    else {
      agent.skills = [...DEFAULT_AGENT_SKILLS];
      changed = true;
    }
  }
  if (agent.tools === undefined) {
    agent.tools = canonicalMediaAgentTools();
    changed = true;
  } else if (!agent.tools || typeof agent.tools !== "object" || Array.isArray(agent.tools)) {
    if (!force) errors.push(`Agent '${agentId}' has non-object tools config; update it manually or re-run with --force.`);
    else {
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

function resolveAllowCallers(config, { agentId, allowCallers = [], allowExistingAgents = false, runtimeVersion } = {}) {
  const records = rosterAgentRecords(config, { runtimeVersion });
  const existing = allowExistingAgents ? records.map(({ id }) => id).filter((id) => typeof id === "string" && id !== agentId) : [];
  return uniqueStrings([...allowCallers, ...existing]);
}

export function computeAgentPatch(config, { agentId, workspace, allowCallers = [], allowExistingAgents = false, force = false, runtimeVersion } = {}) {
  const roster = readAgentRoster(config, { runtimeVersion });
  const errors = [];
  let changed = false;

  if (roster.kind === "entries") {
    const entries = roster.entries;
    const existing = isRecord(entries[agentId]) ? entries[agentId] : undefined;
    if (!existing) {
      entries[agentId] = { workspace, skills: [...DEFAULT_AGENT_SKILLS], tools: canonicalMediaAgentTools() };
      changed = true;
    } else {
      const merged = mergeMediaAgentDefaults(existing, { agentId, workspace, force, keyed: true });
      entries[agentId] = merged.agent;
      changed ||= merged.changed;
      errors.push(...merged.errors);
    }
    for (const callerId of resolveAllowCallers(config, { agentId, allowCallers, allowExistingAgents, runtimeVersion })) {
      const caller = isRecord(entries[callerId]) ? entries[callerId] : undefined;
      if (!caller) {
        errors.push(`Caller agent '${callerId}' was not found in agents.entries.`);
        continue;
      }
      const currentAllow = caller.subagents?.allowAgents;
      if (Array.isArray(currentAllow)) {
        if (!currentAllow.includes("*") && !currentAllow.includes(agentId)) {
          caller.subagents = { ...(caller.subagents ?? {}), allowAgents: [...currentAllow, agentId] };
          changed = true;
        }
      } else if (currentAllow === undefined) {
        caller.subagents = { ...(caller.subagents ?? {}), allowAgents: [agentId] };
        changed = true;
      } else errors.push(`Caller agent '${callerId}' has non-array subagents.allowAgents; update it manually.`);
    }
    return { changed, errors, kind: roster.kind, patch: { agents: { entries } } };
  }

  const agents = roster.list.map((agent) => (agent && typeof agent === "object" ? agent : {}));
  const existingIndex = agents.findIndex((agent) => agent.id === agentId);
  if (existingIndex === -1) {
    agents.push({ id: agentId, workspace, skills: [...DEFAULT_AGENT_SKILLS], tools: canonicalMediaAgentTools() });
    changed = true;
  } else {
    const merged = mergeMediaAgentDefaults(agents[existingIndex], { agentId, workspace, force, keyed: false });
    agents[existingIndex] = merged.agent;
    changed ||= merged.changed;
    errors.push(...merged.errors);
  }
  for (const callerId of resolveAllowCallers(config, { agentId, allowCallers, allowExistingAgents, runtimeVersion })) {
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
    } else errors.push(`Caller agent '${callerId}' has non-array subagents.allowAgents; update it manually.`);
  }
  return { changed, errors, kind: roster.kind, patch: { agents: { list: agents } } };
}

export function hasSpawnAllowance(config, agentId, options = {}) {
  const defaults = config?.agents?.defaults?.subagents?.allowAgents;
  const records = rosterAgentRecords(config, options);
  const defaultAllows = Array.isArray(defaults) && (defaults.includes("*") || defaults.includes(agentId));
  const callers = records.filter(({ agent }) => {
    const allow = agent?.subagents?.allowAgents;
    return Array.isArray(allow) && (allow.includes("*") || allow.includes(agentId));
  }).map(({ id }) => id).filter(Boolean);
  return { defaultAllows, callers };
}

export function findMediaToolDenials(config, agentId, options = {}) {
  const mediaNames = new Set(["group:media", "image", "image_generate", "music_generate", "video_generate", "tts", "*"]);
  const denied = (tools, source) => Array.isArray(tools?.deny)
    ? tools.deny.filter((name) => mediaNames.has(name)).map((name) => ({ source, name }))
    : [];
  const warnings = [];
  warnings.push(...denied(config?.tools, "tools.deny"));
  warnings.push(...denied(config?.agents?.defaults?.tools, "agents.defaults.tools.deny"));
  for (const { id, agent } of rosterAgentRecords(config, options)) {
    if (id === agentId) continue;
    warnings.push(...denied(agent?.tools, `agent '${id}' tools.deny`));
  }
  return warnings;
}

export function mediaAgentIssues(agent, workspace) {
  if (!agent) return ["agent missing"];
  const issues = [];
  if (!agent.workspace || !samePath(agent.workspace, workspace)) issues.push(`workspace is '${agent.workspace ?? "missing"}'`);
  if (!Array.isArray(agent.skills) || agent.skills.length !== 0) issues.push("skills is not []");
  const tools = agent.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) issues.push("tools config missing");
  else {
    if (tools.profile !== DEFAULT_AGENT_TOOL_PROFILE) issues.push(`tools.profile is '${tools.profile ?? "missing"}'`);
    const alsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : [];
    const missingTools = DEFAULT_AGENT_TOOL_ALLOW.filter((name) => !alsoAllow.includes(name));
    if (missingTools.length > 0) issues.push(`tools.alsoAllow missing ${missingTools.join(", ")}`);
  }
  return issues;
}

export { DEFAULT_AGENT_SKILLS, DEFAULT_AGENT_TOOL_ALLOW, DEFAULT_AGENT_TOOL_PROFILE };
