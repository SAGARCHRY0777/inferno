"""Auth and client identification — the code that decides who gets served.

Untested until now, despite being the module where two real bugs were already
found (a proxy-IP quota collapse and an 8-char key-prefix collision). The
spoofing test is the one that matters most: it is the difference between a
working per-client quota and a bypassable one.
"""

from __future__ import annotations

import pytest

from backend.core.config import get_settings
from backend.core.errors import UnauthorizedError
from backend.gateway.security import identify_client


class FakeClient:
    def __init__(self, host: str) -> None:
        self.host = host


class CaseInsensitiveHeaders(dict):
    """Starlette's headers are case-insensitive; a fake that isn't would pass
    tests the real request would fail (the code looks up `X-API-Key` verbatim)."""

    def get(self, key, default=None):  # noqa: D102
        return super().get(key.lower(), default)


class FakeRequest:
    """Duck-types the two attributes identify_client actually reads."""

    def __init__(
        self, headers: dict[str, str] | None = None, peer: str | None = "10.0.0.7"
    ) -> None:
        self.headers = CaseInsensitiveHeaders(
            {k.lower(): v for k, v in (headers or {}).items()}
        )
        self.client = FakeClient(peer) if peer else None


@pytest.fixture
def auth_off(monkeypatch):
    monkeypatch.delenv("INFERNO_AUTH__ENABLED", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("INFERNO_AUTH__ENABLED", "true")
    monkeypatch.setenv("INFERNO_AUTH__API_KEYS", '["key-alpha-1234567890", "key-alpha-9876543210"]')
    get_settings.cache_clear()
    yield
    monkeypatch.delenv("INFERNO_AUTH__ENABLED", raising=False)
    monkeypatch.delenv("INFERNO_AUTH__API_KEYS", raising=False)
    get_settings.cache_clear()


@pytest.fixture
def trust_proxy(monkeypatch):
    monkeypatch.setenv("INFERNO_RATELIMIT__TRUST_PROXY_HEADERS", "true")
    get_settings.cache_clear()
    yield
    monkeypatch.delenv("INFERNO_RATELIMIT__TRUST_PROXY_HEADERS", raising=False)
    get_settings.cache_clear()


# --- auth disabled ---------------------------------------------------------- #
def test_without_auth_the_client_id_is_the_peer_ip(auth_off) -> None:
    assert identify_client(FakeRequest(peer="203.0.113.9")) == "203.0.113.9"


def test_a_missing_peer_falls_back_to_anonymous(auth_off) -> None:
    assert identify_client(FakeRequest(peer=None)) == "anonymous"


def test_forwarded_headers_are_IGNORED_unless_trusted(auth_off) -> None:
    """The security-critical case.

    These headers are client-supplied. Honouring them by default would let any
    caller rotate `X-Forwarded-For` and mint a fresh quota bucket per request,
    making the rate limiter decorative.
    """

    req = FakeRequest({"X-Forwarded-For": "1.2.3.4", "X-Real-IP": "5.6.7.8"}, peer="10.0.0.7")
    assert identify_client(req) == "10.0.0.7"


def test_forwarded_for_is_used_when_trusted(auth_off, trust_proxy) -> None:
    req = FakeRequest({"X-Forwarded-For": "1.2.3.4"}, peer="10.0.0.7")
    assert identify_client(req) == "1.2.3.4"


def test_leftmost_forwarded_entry_wins(auth_off, trust_proxy) -> None:
    """`client, proxy1, proxy2` — the original caller is first."""

    req = FakeRequest({"X-Forwarded-For": "1.2.3.4, 10.0.0.1, 10.0.0.2"}, peer="10.0.0.7")
    assert identify_client(req) == "1.2.3.4"


def test_real_ip_is_the_fallback_when_forwarded_for_is_absent(auth_off, trust_proxy) -> None:
    req = FakeRequest({"X-Real-IP": "5.6.7.8"}, peer="10.0.0.7")
    assert identify_client(req) == "5.6.7.8"


def test_a_blank_forwarded_header_falls_through_to_the_peer(auth_off, trust_proxy) -> None:
    req = FakeRequest({"X-Forwarded-For": "   "}, peer="10.0.0.7")
    assert identify_client(req) == "10.0.0.7"


# --- auth enabled ----------------------------------------------------------- #
def test_a_missing_key_is_rejected(auth_on) -> None:
    with pytest.raises(UnauthorizedError):
        identify_client(FakeRequest())


def test_a_wrong_key_is_rejected(auth_on) -> None:
    with pytest.raises(UnauthorizedError):
        identify_client(FakeRequest({"X-API-Key": "not-a-real-key"}))


def test_a_valid_key_yields_a_stable_opaque_id(auth_on) -> None:
    req = FakeRequest({"X-API-Key": "key-alpha-1234567890"})
    first = identify_client(req)
    assert first == identify_client(req), "the id must be stable across requests"
    assert first.startswith("key:")
    assert "key-alpha-1234567890" not in first, "the raw secret must never leak into logs or keys"


def test_keys_sharing_a_long_prefix_get_different_buckets(auth_on) -> None:
    """Both configured keys share the first 10 characters.

    The previous `key[:8]` scheme mapped them to one quota bucket, so two
    tenants silently shared a limit — common with prefixed formats like
    `sk_live_...`.
    """

    a = identify_client(FakeRequest({"X-API-Key": "key-alpha-1234567890"}))
    b = identify_client(FakeRequest({"X-API-Key": "key-alpha-9876543210"}))
    assert a != b


def test_the_key_header_name_is_configurable(auth_on, monkeypatch) -> None:
    monkeypatch.setenv("INFERNO_AUTH__HEADER_NAME", "X-Tenant-Token")
    get_settings.cache_clear()
    try:
        assert identify_client(FakeRequest({"X-Tenant-Token": "key-alpha-1234567890"}))
        with pytest.raises(UnauthorizedError):
            identify_client(FakeRequest({"X-API-Key": "key-alpha-1234567890"}))
    finally:
        monkeypatch.delenv("INFERNO_AUTH__HEADER_NAME", raising=False)
        get_settings.cache_clear()
