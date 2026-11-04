"""SSRF protection for the browser worker.

The AI PC sits inside a home or office network, so the browser may only reach allow-listed public hosts.
Every request (including each redirect hop) is checked: the host must match the allow-list and every
address it resolves to must be public. Private, loopback, link-local, CGNAT, multicast, reserved and
cloud-metadata ranges are always refused.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from urllib.parse import urlparse

BLOCKED_NETS = [ipaddress.ip_network(n) for n in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
    "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
    "::/128", "::1/128", "::ffff:0:0/96", "64:ff9b::/96", "100::/64", "fc00::/7", "fe80::/10", "ff00::/8",
)]
METADATA_HOSTS = {"metadata.google.internal", "metadata", "instance-data", "metadata.azure.com"}

Resolver = Callable[[str], list[str]]


def default_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return sorted({str(i[4][0]) for i in infos})


def ip_is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%")[0])
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return not any(addr in n for n in BLOCKED_NETS) and addr.is_global


def host_allowed(host: str, allowed: Iterable[str]) -> bool:
    host = host.lower().rstrip(".")
    for pattern in allowed:
        p = pattern.lower().strip().rstrip(".")
        if not p:
            continue
        if p.startswith("*."):
            base = p[2:]
            if host == base or host.endswith("." + base):
                return True
        elif host == p:
            return True
    return False


class NetGuard:
    def __init__(self, allowed_domains: Iterable[str], resolver: Resolver = default_resolver) -> None:
        self.allowed = [d for d in allowed_domains if d]
        self.resolver = resolver
        self._cache: dict[str, bool] = {}
        self.blocked: list[str] = []

    def check(self, url: str) -> tuple[bool, str]:
        p = urlparse(url)
        if p.scheme in ("data", "blob", "about"):
            return True, ""
        if p.scheme not in ("http", "https"):
            return False, f"scheme {p.scheme} not allowed"
        host = (p.hostname or "").lower()
        if not host or host in METADATA_HOSTS:
            return False, "metadata or empty host"
        try:  # literal IPs are never on the allow-list
            ipaddress.ip_address(host)
            return False, "IP literals are not allowed"
        except ValueError:
            pass
        if not host_allowed(host, self.allowed):
            return False, f"{host} is not on the allow-list"
        if host not in self._cache:
            try:
                ips = self.resolver(host)
            except OSError:
                self._cache[host] = False
                return False, f"{host} does not resolve"
            self._cache[host] = bool(ips) and all(ip_is_public(ip) for ip in ips)
        if not self._cache[host]:
            return False, f"{host} resolves to a private or reserved address"
        return True, ""

    def resolver_rules(self) -> str:
        """Chromium --host-resolver-rules pinning exact allow-listed hosts to the IPs we validated (anti DNS-rebinding)."""
        rules = []
        for d in self.allowed:
            if d.startswith("*."):
                continue
            try:
                ips = self.resolver(d)
            except OSError:
                continue
            v4 = [ip for ip in ips if ":" not in ip and ip_is_public(ip)]
            if v4:
                rules.append(f"MAP {d} {v4[0]}")
        return ", ".join(rules)
