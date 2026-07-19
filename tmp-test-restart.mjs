import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { queryWindowsRuntimeSnapshot } from "./src/windows-runtime.mjs";
import {
  probeWindowsNativeProcessFromSnapshot,
  spawnWindowsRestartIntoCdp,
} from "./src/cli.mjs";

const install = join(process.env.USERPROFILE, ".codex", "heige-codex-skin-studio");
const common = join(install, "scripts", "windows", "lib", "common.ps1");
const psPath = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function ps(script) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 10e6,
    windowsHide: true,
    env: process.env,
  });
  return { status: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

async function cdpOpen() {
  try {
    return (await fetch("http://127.0.0.1:9341/json/version", { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

if (!process.env.HEIGE_WINDOWS_APP_IDENTITY) {
  const r = ps(`. '${common.replace(/'/g, "''")}'; ConvertTo-HeiGeCodexAppIdentityToken -App (Resolve-CodexApp)`);
  if (r.status !== 0) throw new Error(r.err || r.out);
  process.env.HEIGE_WINDOWS_APP_IDENTITY = r.out.split(/\r?\n/).filter(Boolean).at(-1);
}

const snap = await queryWindowsRuntimeSnapshot({
  port: 9341,
  env: process.env,
  powershellPath: psPath,
  commonScriptPath: common,
});
console.log("before", { procs: snap.processes.length, listeners: snap.listeners.length, cdp: await cdpOpen() });
const native = probeWindowsNativeProcessFromSnapshot(snap, { port: 9341 });
console.log("native", native);
if (!native) {
  console.log("NO_NATIVE");
  process.exit(2);
}

console.log("spawning restart-into-cdp...");
const t0 = Date.now();
try {
  const result = await spawnWindowsRestartIntoCdp({
    port: 9341,
    nativeProcess: native,
    powershellPath: psPath,
    scriptPath: join(install, "scripts", "windows", "lib", "restart-into-cdp.ps1"),
    env: process.env,
  });
  console.log("spawned", result, "ms", Date.now() - t0);
} catch (e) {
  console.log("SPAWN_FAIL", e.message);
  process.exit(3);
}

let ok = false;
for (let i = 0; i < 60; i += 1) {
  const open = await cdpOpen();
  console.log(`poll ${i}`, { open, procs: ps("@(Get-Process ChatGPT,Codex -EA SilentlyContinue).Count").out });
  if (open) {
    ok = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(ok ? "RESTART_CDP_PASS" : "RESTART_CDP_FAIL");
process.exit(ok ? 0 : 4);
