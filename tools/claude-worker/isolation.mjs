/**
 * Proof that a test browser really is isolated and Incognito, not a label.
 *
 * Every browser Journey opens is Google Chrome when it is installed (otherwise the Chromium that came with the tools, and the report says so),
 * started with --incognito and a throw-away profile folder in the temp directory. It never touches your own Chrome profile, cookies,
 * history or extensions. Because Chrome refuses to hand over its own command line to a test driver, the check reads the command line of
 * the browser process itself from the operating system and looks at the flags it was REALLY started with.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const run = promisify(execFile);

/** The browser processes this program started: their ids and command lines. */
export async function browserChildren() {
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object { $_.CommandLine -match 'remote-debugging' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`], { timeout: 20_000, windowsHide: true });
      const j = stdout.trim() ? JSON.parse(stdout) : [];
      return (Array.isArray(j) ? j : [j]).map((p) => ({ pid: Number(p.ProcessId), cmd: String(p.CommandLine ?? "") }));
    }
    const { stdout } = await run("ps", ["-o", "pid=,args=", "--ppid", String(process.pid)], { timeout: 10_000 });
    return stdout.split("\n").map((l) => l.trim()).filter((l) => /remote-debugging/.test(l)).map((l) => { const m = l.match(/^(\d+)\s+(.*)$/); return { pid: Number(m?.[1]), cmd: m?.[2] ?? "" }; });
  } catch { return []; }
}

const flag = (cmd, name) => { const m = cmd.match(new RegExp(`--${name}(?:=("[^"]*"|\\S+))?`)); return m ? (m[1] ?? true) : null; };

/** Pure: what a command line says about isolation. `tmp` is the folder temporary profiles must live in. */
export function judge(cmd, { tmp = os.tmpdir() } = {}) {
  const dirRaw = flag(cmd, "user-data-dir");
  const dir = typeof dirRaw === "string" ? dirRaw.replace(/^"|"$/g, "") : null;
  const norm = (p) => path.resolve(p).toLowerCase().replace(/\\/g, "/");
  const inTmp = Boolean(dir) && norm(dir).startsWith(norm(tmp) + "/");
  const normalProfile = Boolean(dir) && /(google[\\/]+chrome|chromium)[\\/]+user data/i.test(dir);
  const incognito = flag(cmd, "incognito") === true;
  return { incognito, temporaryProfile: inTmp, usesNormalProfile: normalProfile, profileDir: dir, verified: incognito && inTmp && !normalProfile };
}

/** Find the browser this program just started (the one that was not there before) and judge its command line. */
export async function verifyLaunch(before, { engine, version }, opts = {}) {
  const known = new Set(before.map((p) => p.pid));
  let mine = null;
  for (let i = 0; i < 12 && !mine; i++) {
    const now = await browserChildren();
    mine = now.find((p) => !known.has(p.pid) && /user-data-dir/.test(p.cmd)) ?? null;
    if (!mine) await new Promise((r) => setTimeout(r, 250));
  }
  if (!mine) return { engine, version, incognito: false, temporaryProfile: false, usesNormalProfile: false, profileDir: null, verified: false, detail: "Could not read the browser's own start-up flags, so isolation is NOT confirmed." };
  const j = judge(mine.cmd, opts);
  return { engine, version, ...j, pid: mine.pid, detail: j.verified ? "Confirmed from the browser process: Incognito, with a temporary profile that is not yours." : "The browser was not started the way Journey requires." };
}

/** After the browser closed: the temporary profile folder is gone. */
export async function profileRemoved(dir, waitMs = 5000) {
  if (!dir) return true;
  const end = Date.now() + waitMs;
  while (Date.now() < end) { if (!fs.existsSync(dir)) return true; await new Promise((r) => setTimeout(r, 200)); }
  return !fs.existsSync(dir);
}
