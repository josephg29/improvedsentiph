import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const GLOBAL_SENTIPH_DIR = join(homedir(), ".sentiph");
export const PROJECTS_FILE = join(GLOBAL_SENTIPH_DIR, "projects.json");
export const PROJECT_CONFIG_RELATIVE_PATH = join(".sentiph", "project.json");

type ProjectConfigDocument = {
  version: 1;
  projectId: string;
  displayName: string;
  createdAt: string;
};

export type ProjectRegistryEntry = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt?: string;
};

type LegacyProjectRegistryEntry = {
  name?: unknown;
  path?: unknown;
  createdAt?: unknown;
};

export type ProjectsRegistry = { projects: ProjectRegistryEntry[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toProjectRegistryEntry = (
  value: unknown,
  workspaceCwd?: string,
): ProjectRegistryEntry | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.path === "string" &&
    value.path.trim().length > 0 &&
    typeof value.createdAt === "string" &&
    value.createdAt.trim().length > 0
  ) {
    return {
      id: value.id,
      name: value.name,
      path: value.path,
      createdAt: value.createdAt,
      ...(typeof value.lastOpenedAt === "string" && value.lastOpenedAt.trim().length > 0
        ? { lastOpenedAt: value.lastOpenedAt }
        : {}),
    };
  }

  if (
    workspaceCwd &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.path === "string" &&
    value.path === workspaceCwd
  ) {
    return {
      id: `legacy-${randomUUID()}`,
      name: value.name,
      path: value.path,
      createdAt:
        typeof value.createdAt === "string" && value.createdAt.trim().length > 0
          ? value.createdAt
          : new Date().toISOString(),
    };
  }

  return null;
};

const toProjectConfigDocument = (value: unknown): ProjectConfigDocument | null => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.projectId !== "string" ||
    value.projectId.trim().length === 0 ||
    typeof value.displayName !== "string" ||
    value.displayName.trim().length === 0 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.trim().length === 0
  ) {
    return null;
  }

  return {
    version: 1,
    projectId: value.projectId,
    displayName: value.displayName,
    createdAt: value.createdAt,
  };
};

const readJsonFile = (filePath: string): unknown | null => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
};

export const ensureGlobalSentiphDir = () => {
  if (!existsSync(GLOBAL_SENTIPH_DIR)) {
    mkdirSync(GLOBAL_SENTIPH_DIR, { recursive: true });
  }
};

export const loadProjectsRegistry = (): ProjectsRegistry => {
  ensureGlobalSentiphDir();

  if (!existsSync(PROJECTS_FILE)) {
    return { projects: [] };
  }

  const parsed = readJsonFile(PROJECTS_FILE);
  if (!isRecord(parsed) || !Array.isArray(parsed.projects)) {
    return { projects: [] };
  }

  return {
    projects: parsed.projects
      .map((entry) => toProjectRegistryEntry(entry))
      .filter((entry): entry is ProjectRegistryEntry => entry !== null),
  };
};

export const saveProjectsRegistry = (registry: ProjectsRegistry) => {
  ensureGlobalSentiphDir();
  writeFileSync(PROJECTS_FILE, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
};

export const resolveProjectConfigPath = (workspaceCwd: string) =>
  join(workspaceCwd, PROJECT_CONFIG_RELATIVE_PATH);

export const deriveProjectIdFromWorkspace = (workspaceCwd: string) =>
  `workspace-${createHash("sha1").update(workspaceCwd).digest("hex").slice(0, 16)}`;

const inferLegacyProjectName = (workspaceCwd: string): string | null => {
  const parsed = readJsonFile(PROJECTS_FILE);
  if (!isRecord(parsed) || !Array.isArray(parsed.projects)) {
    return null;
  }

  for (const legacyEntry of parsed.projects as LegacyProjectRegistryEntry[]) {
    if (legacyEntry.path === workspaceCwd && typeof legacyEntry.name === "string") {
      return legacyEntry.name;
    }
  }

  return null;
};

export const loadProjectConfig = (workspaceCwd: string): ProjectConfigDocument | null => {
  const configPath = resolveProjectConfigPath(workspaceCwd);
  if (!existsSync(configPath)) {
    return null;
  }

  return toProjectConfigDocument(readJsonFile(configPath));
};

export const ensureProjectConfig = (
  workspaceCwd: string,
  preferredName?: string,
  preferredProjectId?: string,
): ProjectConfigDocument => {
  const existing = loadProjectConfig(workspaceCwd);
  if (existing) {
    return existing;
  }

  const displayName =
    preferredName?.trim() ||
    inferLegacyProjectName(workspaceCwd) ||
    basename(workspaceCwd) ||
    "sentiph-project";
  const config: ProjectConfigDocument = {
    version: 1,
    projectId: preferredProjectId?.trim() || randomUUID(),
    displayName,
    createdAt: new Date().toISOString(),
  };

  const configPath = resolveProjectConfigPath(workspaceCwd);
  mkdirSync(join(workspaceCwd, ".sentiph"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
};

export const registerProject = (
  workspaceCwd: string,
  preferredName?: string,
): ProjectRegistryEntry => {
  const projectConfig = ensureProjectConfig(workspaceCwd, preferredName);
  const registry = loadProjectsRegistry();
  const lastOpenedAt = new Date().toISOString();
  const existing = registry.projects.find((entry) => entry.id === projectConfig.projectId);

  if (existing) {
    existing.name = projectConfig.displayName;
    existing.path = workspaceCwd;
    existing.lastOpenedAt = lastOpenedAt;
    saveProjectsRegistry(registry);
    return existing;
  }

  const nextEntry: ProjectRegistryEntry = {
    id: projectConfig.projectId,
    name: projectConfig.displayName,
    path: workspaceCwd,
    createdAt: projectConfig.createdAt,
    lastOpenedAt,
  };

  const filteredProjects = registry.projects.filter(
    (entry) => entry.path !== workspaceCwd && entry.id !== projectConfig.projectId,
  );
  filteredProjects.push(nextEntry);
  saveProjectsRegistry({ projects: filteredProjects });
  return nextEntry;
};

export const resolveGlobalProjectDir = (projectId: string) =>
  join(GLOBAL_SENTIPH_DIR, "projects", projectId);

export const resolveEphemeralProjectStateDir = (workspaceCwd: string) =>
  resolveGlobalProjectDir(deriveProjectIdFromWorkspace(workspaceCwd));

export const resolveProjectStateDir = (workspaceCwd: string, preferredName?: string): string => {
  const entry = registerProject(workspaceCwd, preferredName);
  const projectDir = resolveGlobalProjectDir(entry.id);
  mkdirSync(join(projectDir, "state"), { recursive: true });
  return projectDir;
};

export const ensureProjectScaffold = (
  workspaceCwd: string,
  preferredName?: string,
  preferredProjectId?: string,
) => {
  const sentiphDir = join(workspaceCwd, ".sentiph");
  for (const subdirectory of ["agents", "worktrees"]) {
    mkdirSync(join(sentiphDir, subdirectory), { recursive: true });
  }

  return ensureProjectConfig(workspaceCwd, preferredName, preferredProjectId);
};

export const hasSentiphGitignoreEntry = (workspaceCwd: string) => {
  const gitignorePath = join(workspaceCwd, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return false;
  }

  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .includes(".sentiph");
};

export const ensureSentiphGitignoreEntry = (workspaceCwd: string) => {
  const gitignorePath = join(workspaceCwd, ".gitignore");
  const entry = ".sentiph";

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (
      content
        .split("\n")
        .map((line) => line.trim())
        .includes(entry)
    ) {
      return { changed: false };
    }

    appendFileSync(gitignorePath, `\n${entry}\n`, "utf-8");
    return { changed: true };
  }

  writeFileSync(gitignorePath, `${entry}\n`, "utf-8");
  return { changed: true };
};

export const migrateStateToGlobal = (workspaceCwd: string, projectStateDir: string) => {
  const fallbackProjectDir = join(workspaceCwd, ".sentiph");
  if (projectStateDir === fallbackProjectDir) {
    return;
  }

  const currentConfig = loadProjectConfig(workspaceCwd);
  const legacyProjectName = inferLegacyProjectName(workspaceCwd);
  const legacyGlobalProjectDir =
    legacyProjectName && currentConfig
      ? join(GLOBAL_SENTIPH_DIR, "projects", legacyProjectName)
      : null;
  const oldStateDir = join(fallbackProjectDir, "state");
  const newStateDir = join(projectStateDir, "state");

  mkdirSync(newStateDir, { recursive: true });

  const stateFiles = [
    "agents.json",
    "claude-usage-snapshot.json",
    "runtime.json",
  ];

  let migrated = 0;
  for (const file of stateFiles) {
    const destination = join(newStateDir, file);
    if (existsSync(destination)) {
      continue;
    }

    const localSource = join(oldStateDir, file);
    if (existsSync(localSource)) {
      copyFileSync(localSource, destination);
      migrated += 1;
      continue;
    }

    if (!legacyGlobalProjectDir) {
      continue;
    }

    const legacySource = join(legacyGlobalProjectDir, "state", file);
    if (existsSync(legacySource)) {
      copyFileSync(legacySource, destination);
      migrated += 1;
    }
  }

  const transcriptDestination = join(newStateDir, "transcripts");
  if (!existsSync(transcriptDestination)) {
    const localTranscriptSource = join(oldStateDir, "transcripts");
    if (existsSync(localTranscriptSource)) {
      cpSync(localTranscriptSource, transcriptDestination, { recursive: true });
      migrated += 1;
    } else if (legacyGlobalProjectDir) {
      const legacyTranscriptSource = join(legacyGlobalProjectDir, "state", "transcripts");
      if (existsSync(legacyTranscriptSource)) {
        cpSync(legacyTranscriptSource, transcriptDestination, { recursive: true });
        migrated += 1;
      }
    }
  }

  if (migrated > 0) {
    console.log(`  Migrated state to ${projectStateDir}`);
  }
};
