import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const TEMPLATE_FILES = ["AGENTS.md"];
const OPTIONAL_IDEOGRAM_FILES = [
  { name: "bin/ideogram", source: ["bin", "ideogram"], target: ["bin", "ideogram"], mode: 0o755 },
  { name: "config/mcporter.ideogram.json", source: ["config", "mcporter.ideogram.json"], target: ["config", "mcporter.ideogram.json"] },
];

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

function workspaceFileSet({ workspace, pluginRoot, installIdeogramBin = false }) {
  const workspaceDir = resolve(expandHome(workspace));
  const templateSourceDir = join(pluginRoot, "templates", "agents", "media");
  const files = TEMPLATE_FILES.map((name) => ({ name, source: join(templateSourceDir, name), target: join(workspaceDir, name), kind: "template" }));
  if (installIdeogramBin) {
    for (const file of OPTIONAL_IDEOGRAM_FILES) files.push({ name: file.name, source: join(pluginRoot, ...file.source), target: join(workspaceDir, ...file.target), kind: "ideogram", mode: file.mode });
  }
  return files;
}

export function legacyWorkspaceFiles({ workspace }) {
  const workspaceDir = resolve(expandHome(workspace));
  return [{ name: "TOOLS.md", target: join(workspaceDir, "TOOLS.md"), kind: "legacy-template" }];
}

export function inspectTemplates({ workspace, pluginRoot, installIdeogramBin = false }) {
  return workspaceFileSet({ workspace, pluginRoot, installIdeogramBin }).map((file) => {
    const sourceExists = existsSync(file.source);
    const targetExists = existsSync(file.target);
    let modeOk = true;
    if (targetExists && file.mode !== undefined) {
      try { modeOk = (statSync(file.target).mode & 0o777) === file.mode; } catch { modeOk = false; }
    }
    const identical = sourceExists && targetExists && sameFileContent(file.source, file.target) && modeOk;
    return { ...file, sourceExists, targetExists, modeOk, identical };
  });
}

export function copyTemplates({ workspace, pluginRoot, dryRun = false, force = false, installIdeogramBin = false }) {
  const files = inspectTemplates({ workspace, pluginRoot, installIdeogramBin });
  const missingSources = files.filter((file) => !file.sourceExists);
  if (missingSources.length > 0) throw new Error(`Plugin setup source files are missing: ${missingSources.map((file) => file.source).join(", ")}`);
  const conflicts = files.filter((file) => file.targetExists && !file.identical && file.kind !== "template");
  if (conflicts.length > 0 && !force) throw new Error(`Workspace already contains different file(s): ${conflicts.map((file) => file.target).join(", ")}. Re-run with --force to overwrite them.`);

  const workspaceDir = resolve(expandHome(workspace));
  const backupStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = new Map();
  if (!dryRun) {
    mkdirSync(workspaceDir, { recursive: true });
    for (const file of files) {
      if (file.identical || (!force && file.targetExists)) continue;
      mkdirSync(dirname(file.target), { recursive: true });
      if (force && file.targetExists) {
        const backup = join(workspaceDir, ".openclaw-media-backups", backupStamp, file.name);
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(file.target, backup);
        backups.set(file.name, backup);
      }
      copyFileSync(file.source, file.target);
      if (file.mode !== undefined) chmodSync(file.target, file.mode);
    }
  } else {
    for (const file of files) if (!file.identical && force && file.targetExists) backups.set(file.name, join(workspaceDir, ".openclaw-media-backups", backupStamp, file.name));
  }
  return files.map((file) => ({ file: file.name, target: file.target, action: file.identical ? "unchanged" : !force && file.targetExists && file.kind === "template" ? "preserved" : file.targetExists ? "overwrite" : "create", backups: backups.has(file.name) ? [backups.get(file.name)] : [] }));
}
