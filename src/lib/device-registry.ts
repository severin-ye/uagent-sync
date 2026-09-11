import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const DEVICE_SCHEMA_VERSION = 1 as const;

export interface DeviceProfile {
  schemaVersion: 1;
  deviceId: string;
  displayName: string;
  platform: string;
  paths: {
    userHome: string;
    codexHome: string;
  };
  workspaces: Record<string, { root: string }>;
}

export interface DeviceConnection {
  schemaVersion: 1;
  deviceId: string;
  registryRemote: string;
  registryCheckout: string;
}

export interface RegisterDeviceOptions {
  registryCheckout?: string;
  registry?: string;
  registryRemote?: string;
  remote?: string;
  connectionFile?: string;
  displayName?: string;
  name?: string;
  platform?: string;
  userHome?: string;
  codexHome?: string;
  paths?: Partial<DeviceProfile["paths"]>;
  workspaces?: Record<string, { root: string }>;
  workspaceId?: string;
  workspaceRoot?: string;
}

export interface RenameDeviceOptions {
  connectionFile?: string;
  registryCheckout?: string;
  registry?: string;
  deviceId?: string;
  displayName?: string;
  name?: string;
}

export interface ReconnectDeviceOptions {
  connectionFile?: string;
  registryCheckout: string;
  registryRemote?: string;
  remote?: string;
}

export interface RegisteredDevice {
  profile: DeviceProfile;
  connection: DeviceConnection;
}

const DEFAULT_CONNECTION_NAME = path.join(".codex", "uagent-device.json");

function error(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    error(`Invalid ${field}`);
  }
  return value;
}

function displayName(value: unknown): string {
  const name = requiredString(value, "displayName").trim();
  if (!name) error("Invalid displayName");
  return name;
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function absolutePath(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!isAbsolutePath(text)) error(`${field} must be an absolute path`);
  return path.resolve(text);
}

function safeDeviceId(value: unknown): string {
  const id = requiredString(value, "deviceId");
  if (id === "." || id === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    error("Invalid deviceId: path traversal is not allowed");
  }
  return id;
}

function safeWorkspaceId(value: unknown): string {
  const id = requiredString(value, "workspace id");
  if (id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
    error("Invalid workspace id");
  }
  return id;
}

function platformName(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function defaultConnectionFile(): string {
  return path.join(os.homedir(), DEFAULT_CONNECTION_NAME);
}

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(normalizeForComparison(parent), normalizeForComparison(child));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function lstatIfExists(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

/** Check existing path components without ever resolving or following a link. */
function assertNoSymlinkComponents(target: string): void {
  let cursor = path.resolve(target);
  const missing: string[] = [];
  while (!lstatIfExists(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  while (true) {
    const stat = lstatIfExists(cursor);
    if (stat?.isSymbolicLink()) error(`Symbolic links are not allowed in path: ${target}`);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  void missing;
}

function assertDirectory(directory: string, field: string): string {
  const resolved = absolutePath(directory, field);
  const stat = lstatIfExists(resolved);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) error(`${field} must be an existing directory`);
  assertNoSymlinkComponents(resolved);
  return resolved;
}

function assertConnectionLocation(connectionFile: string, registryCheckout: string): string {
  const resolved = absolutePath(connectionFile, "connectionFile");
  if (isWithin(resolved, registryCheckout)) {
    error("connectionFile must be outside registryCheckout");
  }
  assertNoSymlinkComponents(resolved);
  return resolved;
}

function ensureDirectory(directory: string): void {
  assertNoSymlinkComponents(directory);
  fs.mkdirSync(directory, { recursive: true });
  const stat = lstatIfExists(directory);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) error(`Expected directory: ${directory}`);
  assertNoSymlinkComponents(directory);
}

function devicesDirectory(registryCheckout: string, create: boolean): string {
  const registry = assertDirectory(registryCheckout, "registryCheckout");
  const sync = path.join(registry, "sync");
  const devices = path.join(sync, "devices");
  if (create) {
    ensureDirectory(sync);
    ensureDirectory(devices);
  } else {
    const stat = lstatIfExists(devices);
    if (!stat) return devices;
    if (!stat.isDirectory() || stat.isSymbolicLink()) error(`Invalid registry devices directory: ${devices}`);
    assertNoSymlinkComponents(devices);
  }
  if (!isWithin(devices, registry)) error("Registry devices path escapes registryCheckout");
  return devices;
}

function deviceFile(registryCheckout: string, deviceId: string, createDirectory = false): string {
  const id = safeDeviceId(deviceId);
  const directory = devicesDirectory(registryCheckout, createDirectory);
  const target = path.join(directory, `${id}.json`);
  if (!isWithin(target, registryCheckout)) error("Device path escapes registryCheckout");
  const stat = lstatIfExists(target);
  if (stat?.isSymbolicLink()) error(`Symbolic links are not allowed for device file: ${target}`);
  if (stat && !stat.isFile()) error(`Device file is not regular: ${target}`);
  return target;
}

function readJson(file: string): unknown {
  const resolved = path.resolve(file);
  const stat = lstatIfExists(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) error(`Invalid JSON file: ${file}`);
  assertNoSymlinkComponents(resolved);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  } catch (cause) {
    error(`Invalid JSON in ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function parseConnection(value: unknown, source: string): DeviceConnection {
  if (!isRecord(value) || value.schemaVersion !== DEVICE_SCHEMA_VERSION) {
    error(`Unsupported schemaVersion in ${source}`);
  }
  const deviceId = safeDeviceId(value.deviceId);
  if (typeof value.registryRemote !== "string" || value.registryRemote.includes("\0")) error("Invalid registryRemote");
  const registryRemote = value.registryRemote;
  const registryCheckout = absolutePath(value.registryCheckout, "registryCheckout");
  return { schemaVersion: DEVICE_SCHEMA_VERSION, deviceId, registryRemote, registryCheckout };
}

function parseProfile(value: unknown, source: string): DeviceProfile {
  if (!isRecord(value) || value.schemaVersion !== DEVICE_SCHEMA_VERSION) {
    error(`Unsupported schemaVersion in ${source}`);
  }
  const paths = value.paths;
  if (!isRecord(paths)) error(`Invalid paths in ${source}`);
  const workspaces = value.workspaces;
  if (!isRecord(workspaces)) error(`Invalid workspaces in ${source}`);
  const normalizedWorkspaces: Record<string, { root: string }> = {};
  for (const [id, workspace] of Object.entries(workspaces)) {
    const workspaceId = safeWorkspaceId(id);
    if (!isRecord(workspace)) error(`Invalid workspace ${id} in ${source}`);
    normalizedWorkspaces[workspaceId] = { root: absolutePath(workspace.root, `workspace ${id} root`) };
  }
  return {
    schemaVersion: DEVICE_SCHEMA_VERSION,
    deviceId: safeDeviceId(value.deviceId),
    displayName: displayName(value.displayName),
    platform: requiredString(value.platform, "platform"),
    paths: {
      userHome: absolutePath(paths.userHome, "userHome"),
      codexHome: absolutePath(paths.codexHome, "codexHome"),
    },
    workspaces: normalizedWorkspaces,
  };
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWriteJson(file: string, value: unknown): void {
  const target = path.resolve(file);
  const parent = path.dirname(target);
  ensureDirectory(parent);
  const existing = lstatIfExists(target);
  if (existing?.isSymbolicLink()) error(`Refusing to overwrite symbolic link: ${target}`);
  if (existing && !existing.isFile()) error(`Refusing to overwrite non-file: ${target}`);
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, jsonText(value), "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (lstatIfExists(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function readExistingConnection(file: string): DeviceConnection | undefined {
  const stat = lstatIfExists(file);
  if (!stat) return undefined;
  return parseConnection(readJson(file), file);
}

function normalizeWorkspaces(options: RegisterDeviceOptions): Record<string, { root: string }> {
  const result: Record<string, { root: string }> = {};
  if (options.workspaces !== undefined) {
    if (!isRecord(options.workspaces)) error("Invalid workspaces");
    for (const [id, workspace] of Object.entries(options.workspaces)) {
      if (!isRecord(workspace)) error(`Invalid workspace ${id}`);
      result[safeWorkspaceId(id)] = { root: absolutePath(workspace.root, `workspace ${id} root`) };
    }
  }
  if (options.workspaceId !== undefined || options.workspaceRoot !== undefined) {
    if (options.workspaceId === undefined || options.workspaceRoot === undefined) error("workspaceId and workspaceRoot must be provided together");
    result[safeWorkspaceId(options.workspaceId)] = { root: absolutePath(options.workspaceRoot, "workspaceRoot") };
  }
  return result;
}

function makeProfile(options: RegisterDeviceOptions, deviceId: string, existing?: DeviceProfile): DeviceProfile {
  const userHome = absolutePath(options.userHome ?? options.paths?.userHome ?? existing?.paths.userHome ?? os.homedir(), "userHome");
  const codexHome = absolutePath(options.codexHome ?? options.paths?.codexHome ?? existing?.paths.codexHome ?? path.join(userHome, ".codex"), "codexHome");
  const hasWorkspaceOptions = options.workspaces !== undefined || options.workspaceId !== undefined || options.workspaceRoot !== undefined;
  return {
    schemaVersion: DEVICE_SCHEMA_VERSION,
    deviceId: safeDeviceId(deviceId),
    displayName: displayName((options.displayName ?? options.name ?? existing?.displayName ?? os.hostname()) || "this-device"),
    platform: requiredString(options.platform ?? existing?.platform ?? platformName(), "platform"),
    paths: { userHome, codexHome },
    workspaces: hasWorkspaceOptions ? normalizeWorkspaces(options) : existing?.workspaces ?? {},
  };
}

export function readDeviceConnection(connectionFile: string): DeviceConnection {
  const resolved = absolutePath(connectionFile, "connectionFile");
  const connection = parseConnection(readJson(resolved), connectionFile);
  if (isWithin(resolved, connection.registryCheckout)) error("connectionFile must be outside registryCheckout");
  assertNoSymlinkComponents(resolved);
  return connection;
}

export function loadDeviceProfiles(registryCheckout: string): DeviceProfile[] {
  const directory = devicesDirectory(registryCheckout, false);
  const stat = lstatIfExists(directory);
  if (!stat) return [];
  const profiles: DeviceProfile[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const entryStat = lstatIfExists(entryPath);
    if (entryStat?.isSymbolicLink()) error(`Symbolic links are not allowed in registry: ${entry.name}`);
    if (!entryStat?.isFile() || !entry.name.endsWith(".json")) continue;
    const profile = parseProfile(readJson(entryPath), entryPath);
    const expectedId = entry.name.slice(0, -5);
    if (profile.deviceId !== expectedId) error(`Device file identity conflict: ${entry.name}`);
    profiles.push(profile);
  }
  profiles.sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  return profiles;
}

export function resolveDevice(profiles: DeviceProfile[], idOrAlias: string): DeviceProfile {
  const exact = profiles.filter((profile) => profile.deviceId === idOrAlias);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) error(`Duplicate device id: ${idOrAlias}`);
  const aliases = profiles.filter((profile) => profile.displayName === idOrAlias);
  if (aliases.length === 1) return aliases[0]!;
  if (aliases.length > 1) error(`Ambiguous device alias: ${idOrAlias}`);
  error(`Unknown device: ${idOrAlias}`);
}

export function registerDevice(options: RegisterDeviceOptions): RegisteredDevice {
  const connectionFile = path.resolve(options.connectionFile ?? defaultConnectionFile());
  const existingConnection = readExistingConnection(connectionFile);
  const requestedRegistry = options.registryCheckout ?? options.registry;
  const configuredRegistry = requestedRegistry ?? existingConnection?.registryCheckout;
  if (!configuredRegistry) error("registryCheckout is required");
  const registryCheckout = assertDirectory(configuredRegistry, "registryCheckout");
  if (existingConnection && normalizeForComparison(existingConnection.registryCheckout) !== normalizeForComparison(registryCheckout)) {
    error("Existing device connection points to another registry; use reconnectDevice");
  }
  const providedRemote = options.registryRemote ?? options.remote;
  if (existingConnection && providedRemote !== undefined && providedRemote !== existingConnection.registryRemote) {
    error("Changing registryRemote requires reconnectDevice");
  }
  const connectionPath = assertConnectionLocation(connectionFile, registryCheckout);
  const deviceId = existingConnection?.deviceId ?? randomUUID();
  const target = deviceFile(registryCheckout, deviceId, true);
  const existingProfile = lstatIfExists(target) ? parseProfile(readJson(target), target) : undefined;
  if (existingProfile && existingProfile.deviceId !== deviceId) {
    error(`Device identity conflict for ${deviceId}`);
  }
  const profile = makeProfile(options, deviceId, existingProfile);
  const connection: DeviceConnection = {
    schemaVersion: DEVICE_SCHEMA_VERSION,
    deviceId,
    registryRemote: providedRemote ?? existingConnection?.registryRemote ?? "",
    registryCheckout,
  };
  atomicWriteJson(target, profile);
  atomicWriteJson(connectionPath, connection);
  return { profile, connection };
}

export function renameDevice(options: RenameDeviceOptions): DeviceProfile {
  const connectionFile = options.connectionFile ? path.resolve(options.connectionFile) : undefined;
  const connection = connectionFile ? readDeviceConnection(connectionFile) : undefined;
  const configuredDeviceId = options.deviceId ?? connection?.deviceId;
  if (!configuredDeviceId) error("deviceId or connectionFile is required");
  const deviceId = safeDeviceId(configuredDeviceId);
  if (connection && options.deviceId && safeDeviceId(options.deviceId) !== connection.deviceId) error("deviceId does not match local connection");
  const configuredRegistry = options.registryCheckout ?? options.registry ?? connection?.registryCheckout;
  if (!configuredRegistry) error("registryCheckout is required");
  const registryCheckout = assertDirectory(configuredRegistry, "registryCheckout");
  if (connectionFile) assertConnectionLocation(connectionFile, registryCheckout);
  const target = deviceFile(registryCheckout, deviceId);
  const profile = parseProfile(readJson(target), target);
  if (profile.deviceId !== deviceId) error(`Device identity conflict for ${deviceId}`);
  const renamed: DeviceProfile = { ...profile, displayName: displayName(options.displayName ?? options.name) };
  atomicWriteJson(target, renamed);
  return renamed;
}

export function reconnectDevice(options: ReconnectDeviceOptions): DeviceConnection {
  const connectionFile = path.resolve(options.connectionFile ?? defaultConnectionFile());
  const current = readDeviceConnection(connectionFile);
  const registryCheckout = assertDirectory(options.registryCheckout, "registryCheckout");
  const connectionPath = assertConnectionLocation(connectionFile, registryCheckout);
  const target = deviceFile(registryCheckout, current.deviceId);
  const profile = parseProfile(readJson(target), target);
  if (profile.deviceId !== current.deviceId) error("New registry contains a different device identity");
  const providedRemote = options.registryRemote ?? options.remote;
  const updated: DeviceConnection = {
    schemaVersion: DEVICE_SCHEMA_VERSION,
    deviceId: current.deviceId,
    registryRemote: providedRemote ?? current.registryRemote,
    registryCheckout,
  };
  atomicWriteJson(connectionPath, updated);
  return updated;
}
