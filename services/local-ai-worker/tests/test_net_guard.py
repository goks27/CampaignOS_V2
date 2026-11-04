from app.net_guard import NetGuard, host_allowed, ip_is_public


def fake_resolver(table):
    def r(host):
        if host not in table:
            raise OSError("nxdomain")
        return table[host]
    return r


def test_private_and_metadata_addresses_are_blocked():
    for ip in ["127.0.0.1", "10.1.2.3", "192.168.1.10", "172.20.0.5", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1", "0.0.0.0"]:
        assert not ip_is_public(ip), ip
    assert ip_is_public("8.8.8.8")


def test_allow_list_matching():
    assert host_allowed("staging.example.com", ["staging.example.com"])
    assert host_allowed("a.b.example.com", ["*.example.com"])
    assert not host_allowed("example.com.evil.net", ["*.example.com"])
    assert not host_allowed("evil.com", ["staging.example.com"])


def test_guard_checks_dns_and_scheme():
    g = NetGuard(["staging.example.com", "rebind.example.com", "*.cdn.example.com"],
                 fake_resolver({"staging.example.com": ["93.184.216.34"], "rebind.example.com": ["192.168.0.10"], "img.cdn.example.com": ["93.184.216.35"]}))
    assert g.check("https://staging.example.com/register")[0]
    assert g.check("https://img.cdn.example.com/a.png")[0]
    assert not g.check("https://rebind.example.com/")[0], "allow-listed name resolving to a private IP is refused"
    assert not g.check("http://169.254.169.254/latest/meta-data")[0]
    assert not g.check("http://192.168.1.1/")[0]
    assert not g.check("file:///etc/passwd")[0]
    assert not g.check("https://google.com/")[0]
    assert g.check("data:image/png;base64,AAAA")[0]
    assert g.resolver_rules() == "MAP staging.example.com 93.184.216.34"
