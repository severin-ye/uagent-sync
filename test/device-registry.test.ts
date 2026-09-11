import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadDeviceProfiles,
  readDeviceConnection,
  reconnectDevice,
  registerDevice,
  renameDevice,
  resolveDevice,
  type DeviceConnection,
  type DeviceProfile,
} from "../src/lib/device-registry.js";
import { runDeviceRegistryCli } from "../src/entrypoints/device-registry-cli.js";

let tempRoot: string;

function makeFixture() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-device-registry-"));
  const registry = path.join(tempRoot, "registry");
  const home = path.join(tempRoot, "home");
  const codexHome = path.join(home, ".codex");
  const workspace = path.join(tempRoot, "workspace");
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  return { registry, home, codexHome, workspace, connection: path.join(codexHome, "uagent-device.json") };
}

function options(fixture: ReturnType<typeof makeFixture>, name: string) {
  return {
    registryCheckout: fixture.registry,
    connectionFile: fixture.connection,
    displayName: name,
    platform: "windows",
    userHome: fixture.home,
    codexHome: fixture.codexHome,
    workspaceId: "main",
    workspaceRoot: fixture.workspace,
  };
}

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("device registry", () => {
  it("registers one local device with a stable random id on rerun", () => {
    const fixture = makeFixture();
    const first = registerDevice(options(fixture, "荣耀"));
    const second = registerDevice(options(fixture, "荣耀"));

    assert.match(first.profile.deviceId, /^[0-9a-f-]{36}$/);
    assert.equal(second.profile.deviceId, first.profile.deviceId);
    assert.equal(second.connection.deviceId, first.profile.deviceId);
    assert.deepEqual(loadDeviceProfiles(fixture.registry), [first.profile]);
    assert.equal(readDeviceConnection(fixture.connection).deviceId, first.profile.deviceId);
  });

  it("supports multiple devices and rejects an ambiguous alias", () => {
    const first = makeFixture();
    const second = makeFixture();
    const a = registerDevice(options(first, "办公室"));
    const b = registerDevice({ ...options(second, "办公室"), connectionFile: path.join(second.codexHome, "device.json") });
    const profiles = loadDeviceProfiles(first.registry);
    fs.mkdirSync(path.join(first.registry, "sync", "devices"), { recursive: true });
    fs.copyFileSync(path.join(second.registry, "sync", "devices", `${b.profile.deviceId}.json`), path.join(first.registry, "sync", "devices", `${b.profile.deviceId}.json`));

    assert.equal(resolveDevice(profiles.concat(b.profile), a.profile.deviceId).deviceId, a.profile.deviceId);
    assert.throws(() => resolveDevice(profiles.concat(b.profile), "办公室"), /ambiguous|多个|歧义/i);
  });

  it("renames a device without changing its id", () => {
    const fixture = makeFixture();
    const registered = registerDevice(options(fixture, "旧名称"));
    const renamed = renameDevice({ connectionFile: fixture.connection, displayName: "新名称" });

    assert.equal(renamed.deviceId, registered.profile.deviceId);
    assert.equal(renamed.displayName, "新名称");
    assert.equal(loadDeviceProfiles(fixture.registry)[0]?.displayName, "新名称");
  });

  it("reconnects to another checkout only when the same device id is present", () => {
    const fixture = makeFixture();
    const registered = registerDevice(options(fixture, "迁移设备"));
    const newRegistry = path.join(tempRoot, "new-registry");
    fs.mkdirSync(path.join(newRegistry, "sync", "devices"), { recursive: true });
    fs.copyFileSync(
      path.join(fixture.registry, "sync", "devices", `${registered.profile.deviceId}.json`),
      path.join(newRegistry, "sync", "devices", `${registered.profile.deviceId}.json`),
    );

    const reconnected = reconnectDevice({ connectionFile: fixture.connection, registryCheckout: newRegistry, registryRemote: "https://example.invalid/new.git" });
    assert.equal(reconnected.deviceId, registered.profile.deviceId);
    assert.equal(reconnected.registryCheckout, newRegistry);
    assert.equal(readDeviceConnection(fixture.connection).deviceId, registered.profile.deviceId);
    const missingRegistry = path.join(tempRoot, "missing-device-registry");
    fs.mkdirSync(path.join(missingRegistry, "sync", "devices"), { recursive: true });
    assert.throws(() => reconnectDevice({ connectionFile: fixture.connection, registryCheckout: missingRegistry }), /identity|same|device|设备/i);
  });

  it("rejects cross-schema and malformed records", () => {
    const fixture = makeFixture();
    fs.mkdirSync(path.dirname(fixture.connection), { recursive: true });
    fs.writeFileSync(fixture.connection, JSON.stringify({ schemaVersion: 2, deviceId: "device-a", registryRemote: "", registryCheckout: fixture.registry }));
    assert.throws(() => readDeviceConnection(fixture.connection), /schema/i);
    fs.mkdirSync(path.join(fixture.registry, "sync", "devices"), { recursive: true });
    fs.writeFileSync(path.join(fixture.registry, "sync", "devices", "device-a.json"), JSON.stringify({ schemaVersion: 2 }));
    assert.throws(() => loadDeviceProfiles(fixture.registry), /schema/i);
  });

  it("rejects path traversal, symlink escape, and a connection inside the registry", () => {
    const fixture = makeFixture();
    assert.throws(() => registerDevice({ ...options(fixture, "越界"), connectionFile: path.join(fixture.registry, "uagent-device.json") }), /connection|registry|连接/i);
    const insideConnection = path.join(fixture.registry, "uagent-device.json");
    fs.writeFileSync(insideConnection, JSON.stringify({ schemaVersion: 1, deviceId: "device-a", registryRemote: "", registryCheckout: fixture.registry }));
    assert.throws(() => readDeviceConnection(insideConnection), /outside|registry|连接/i);
    assert.throws(() => registerDevice({ ...options(fixture, "越界"), workspaceId: "../escape" }), /id|path|路径/i);

    const devices = path.join(fixture.registry, "sync", "devices");
    fs.mkdirSync(devices, { recursive: true });
    fs.writeFileSync(path.join(devices, "unsafe.json"), JSON.stringify({ schemaVersion: 1, deviceId: "../escape" }));
    assert.throws(() => loadDeviceProfiles(fixture.registry), /id|path|路径/i);
  });

  it("does not overwrite an existing file with a conflicting device identity", () => {
    const fixture = makeFixture();
    const connection: DeviceConnection = { schemaVersion: 1, deviceId: "device-a", registryRemote: "", registryCheckout: fixture.registry };
    fs.mkdirSync(path.dirname(fixture.connection), { recursive: true });
    fs.writeFileSync(fixture.connection, JSON.stringify(connection));
    fs.mkdirSync(path.join(fixture.registry, "sync", "devices"), { recursive: true });
    const target = path.join(fixture.registry, "sync", "devices", "device-a.json");
    const existing = { schemaVersion: 1, deviceId: "device-b", displayName: "保留", platform: "windows", paths: { userHome: fixture.home, codexHome: fixture.codexHome }, workspaces: {} } satisfies DeviceProfile;
    fs.writeFileSync(target, JSON.stringify(existing));

    assert.throws(() => registerDevice(options(fixture, "冲突")), /identity|conflict|身份|device/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), existing);
  });

  it("CLI emits JSON and does not expose URL credentials", async () => {
    const fixture = makeFixture();
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const code = await runDeviceRegistryCli([
        "register", "--registry", fixture.registry, "--connection", fixture.connection,
        "--remote", "https://user:secret@example.invalid/config.git", "--name", "CLI device",
        "--user-home", fixture.home, "--codex-home", fixture.codexHome,
        "--workspace-id", "main", "--workspace-root", fixture.workspace,
      ]);
      assert.equal(code, 0);
    } finally {
      console.log = originalLog;
    }
    assert.equal(output.length, 1);
    assert.match(output[0]!, /"deviceId"/);
    assert.doesNotMatch(output[0]!, /secret/);
  });
});
