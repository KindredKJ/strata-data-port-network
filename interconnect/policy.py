"""INTERCONNECT local policy. Founder: Kindred Jermaine Cox / Kindred Labs."""
from urllib.parse import urlsplit
import ipaddress

def navigation_allowed(uri: str, network_enabled: bool = False) -> bool:
    try:
        if not isinstance(uri, str) or len(uri) > 8192 or any(ord(c) < 32 for c in uri):
            return False
        parsed = urlsplit(uri)
        if uri == "about:blank" or parsed.scheme == "interconnect" and parsed.netloc in {"home", "evidence"}:
            return True
        if not network_enabled or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return False
        if parsed.port not in (None, 443):
            return False
        host = parsed.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith((".local", ".localhost", ".internal")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return "." in host and all(part and not part.startswith("-") for part in host.split("."))
    except ValueError:
        return False
