import {
  loadDeviceProfiles,
  readDeviceConnection,
  reconnectDevice,
  registerDevice,
  renameDevice,
  resolveDevice,
  type DeviceProfile,
} from "../lib/device-registry.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string[]>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals >= 0 ? equals : undefined);
    if (!key) throw new Error("Invalid empty option");
    let value: string;
    if (equals >= 0) value = token.slice(equals + 1);
    else if (args[index + 1] !== undefined && !args[index + 1]!.startsWith("--")) value = args[++index]!;
    else value = "true";
    const values = flags.get(key) ?? [];
    values.push(value);
    flags.set(key, values);
  }
  const first = positionals.shift() ?? "";
  return { command: first === "device" ? positionals.shift() ?? "" : first, positionals, flags };
}

function one(parsed: ParsedArgs, name: string): string | undefined {
  const values = parsed.flags.get(name);
  return values && values.length > 0 ? values[values.length - 1] : undefined;
}

function required(parsed: ParsedArgs, name: string): string {
  const value = one(parsed, name);
  if (!value || value === "true") throw new Error(`Missing --${name}`);
  return value;
}

function redactRemote(value: string): string {
  return value.replace(/(https?:\/\/)([^/@\s]+)@/gi, "$1[REDACTED]@");
}

function sanitize<T>(value: T): T {
  if (typeof value === "string") return redactRemote(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitize(item)) as T;
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = sanitize(item);
    return result as T;
  }
  return value;
}

function connectionFile(parsed: ParsedArgs): string | undefined {
  return one(parsed, "connection");
}

function registryFromArgs(parsed: ParsedArgs, allowConnection = true): string | undefined {
  const registry = one(parsed, "registry");
  if (registry) return registry;
  if (allowConnection) {
    const file = connectionFile(parsed);
    if (file) return readDeviceConnection(file).registryCheckout;
  }
  return undefined;
}

function workspaces(parsed: ParsedArgs): Record<string, { root: string }> | undefined {
  const ids = parsed.flags.get("workspace-id") ?? [];
  const roots = parsed.flags.get("workspace-root") ?? [];
  if (ids.length === 0 && roots.length === 0) return undefined;
  if (ids.length !== roots.length) throw new Error("--workspace-id and --workspace-root must be supplied in pairs");
  return Object.fromEntries(ids.map((id, index) => [id, { root: roots[index]! }]));
}

function emit(value: unknown): void {
  console.log(JSON.stringify(sanitize(value), null, 2));
}

function profileResult(profile: DeviceProfile): { device: DeviceProfile } {
  return { device: profile };
}

export async function runDeviceRegistryCli(args: string[]): Promise<number> {
  try {
    const parsed = parseArgs(args);
    switch (parsed.command) {
      case "register": {
        const registryCheckout = registryFromArgs(parsed, true);
        if (!registryCheckout) throw new Error("Missing --registry or --connection");
        const result = registerDevice({
          registryCheckout,
          connectionFile: connectionFile(parsed),
          registryRemote: one(parsed, "remote"),
          displayName: one(parsed, "name"),
          userHome: one(parsed, "user-home"),
          codexHome: one(parsed, "codex-home"),
          platform: one(parsed, "platform"),
          workspaces: workspaces(parsed),
        });
        emit({ ok: true, device: result.profile, connection: result.connection });
        return 0;
      }
      case "list": {
        const registryCheckout = registryFromArgs(parsed, true);
        if (!registryCheckout) throw new Error("Missing --registry or --connection");
        emit({ ok: true, devices: loadDeviceProfiles(registryCheckout) });
        return 0;
      }
      case "show": {
        const registryCheckout = registryFromArgs(parsed, true);
        if (!registryCheckout) throw new Error("Missing --registry or --connection");
        const idOrAlias = parsed.positionals[0] ?? one(parsed, "device-id") ?? one(parsed, "id");
        if (!idOrAlias) throw new Error("Missing device id or alias");
        emit({ ok: true, ...profileResult(resolveDevice(loadDeviceProfiles(registryCheckout), idOrAlias)) });
        return 0;
      }
      case "rename": {
        const profile = renameDevice({
          connectionFile: connectionFile(parsed),
          registryCheckout: one(parsed, "registry"),
          deviceId: parsed.positionals[0] ?? one(parsed, "device-id"),
          displayName: one(parsed, "name"),
        });
        emit({ ok: true, ...profileResult(profile) });
        return 0;
      }
      case "reconnect": {
        const connection = reconnectDevice({
          connectionFile: connectionFile(parsed),
          registryCheckout: required(parsed, "registry"),
          registryRemote: one(parsed, "remote"),
        });
        emit({ ok: true, connection });
        return 0;
      }
      default:
        throw new Error("Usage: device register|list|show|rename|reconnect");
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(JSON.stringify({ ok: false, error: redactRemote(message) }));
    return 1;
  }
}
