/**
 * SSRF protection for the browser. Port of services/local-ai-worker/app/net_guard.py.
 *
 * This PC sits inside a home or office network, so the browser may only reach allow-listed PUBLIC hosts.
 * Every request (including each redirect hop) is checked: the host must match the allow-list and every address it
 * resolves to must be public. Private, loopback, link-local, CGNAT, multicast, reserved and cloud-metadata ranges are
 * always refused, and IP literals are never allowed.
 */
import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]) BLOCKED.addSubnet(addr, prefix, "ipv4");
BLOCKED.addAddress("255.255.255.255", "ipv4");
for (const [addr, prefix] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) BLOCKED.addSubnet(addr, prefix, "ipv6");

export const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data", "metadata.azure.com"]);

export async function defaultResolver(host) {
  const infos = await dns.lookup(host, { all: true });
  return [...new Set(infos.map((i) => i.address))].sort();
}

export function ipIsPublic(ip) {
  let addr = String(ip).split("%")[0];
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  if (mapped) addr = mapped[1];
  const v = net.isIP(addr);
  if (!v) return false;
  return !BLOCKED.check(addr, v === 4 ? "ipv4" : "ipv6");
}

export function hostAllowed(host, allowed) {
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const raw of allowed) {
    const p = String(raw).toLowerCase().trim().replace(/\.$/, "");
    if (!p) continue;
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      if (h === base || h.endsWith(`.${base}`)) return true;
    } else if (h === p) return true;
  }
  return false;
}

export class NetGuard {
  /** `unsafeAllowPrivateForTests` exists only for the offline tests that talk to a local server. The connector never sets it. */
  constructor(allowed, { resolver = defaultResolver, unsafeAllowPrivateForTests = false } = {}) {
    this.allowed = [...allowed].filter(Boolean);
    this.resolver = resolver;
    this.testMode = unsafeAllowPrivateForTests;
    this.cache = new Map();
    this.blocked = [];
  }

  async check(url) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, why: "not a valid URL" }; }
    const scheme = u.protocol.replace(":", "");
    if (["data", "blob", "about"].includes(scheme)) return { ok: true, why: "" };
    if (!["http", "https"].includes(scheme)) return { ok: false, why: `scheme ${scheme} not allowed` };
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || METADATA_HOSTS.has(host)) return { ok: false, why: "metadata or empty host" };
    if (!this.testMode && net.isIP(host)) return { ok: false, why: "IP literals are not allowed" };
    if (!hostAllowed(host, this.allowed)) return { ok: false, why: `${host} is not on the allow-list` };
    if (this.testMode) return { ok: true, why: "" };
    if (!this.cache.has(host)) {
      try {
        const ips = await this.resolver(host);
        if (!ips.length) throw new Error("no addresses");
        this.cache.set(host, ips.every(ipIsPublic));
      } catch {
        this.cache.set(host, false);
        return { ok: false, why: `${host} does not resolve` };
      }
    }
    return this.cache.get(host) ? { ok: true, why: "" } : { ok: false, why: `${host} resolves to a private or reserved address` };
  }

  /** Chromium --host-resolver-rules pinning exact allow-listed hosts to the IPs we validated (anti DNS-rebinding). */
  async resolverRules() {
    const rules = [];
    for (const d of this.allowed) {
      if (d.startsWith("*.")) continue;
      try {
        const v4 = (await this.resolver(d)).filter((ip) => net.isIPv4(ip) && ipIsPublic(ip));
        if (v4.length) rules.push(`MAP ${d} ${v4[0]}`);
      } catch { /* does not resolve: check() will refuse it */ }
    }
    return rules.join(", ");
  }
}
