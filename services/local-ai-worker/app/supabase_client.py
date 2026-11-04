"""Minimal Supabase client for the worker.

Signs in as the dedicated worker user (never the service-role key) and talks to
PostgREST RPC functions and Storage. All traffic is outbound HTTPS.
"""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import quote

import httpx

from .errors import ProviderUnavailable


class SupabaseError(Exception):
    pass


class SupabaseClient:
    def __init__(self, url: str, publishable_key: str, email: str, password: str, *, transport: httpx.BaseTransport | None = None) -> None:
        self.url = url.rstrip("/")
        self.key = publishable_key
        self.email = email
        self.password = password
        self._http = httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), transport=transport)
        self._access: str | None = None
        self._refresh: str | None = None
        self._expires_at = 0.0
        self.user_id: str | None = None

    # ------------------------------------------------------------------ auth
    def sign_in(self) -> None:
        r = self._http.post(
            f"{self.url}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": self.key},
            json={"email": self.email, "password": self.password},
        )
        if r.status_code >= 400:
            raise SupabaseError(f"Worker sign-in failed ({r.status_code}). Check WORKER_EMAIL / WORKER_PASSWORD. {r.text[:200]}")
        self._store(r.json())

    def _store(self, data: dict[str, Any]) -> None:
        self._access = data["access_token"]
        self._refresh = data.get("refresh_token")
        self._expires_at = time.time() + float(data.get("expires_in", 3600))
        self.user_id = (data.get("user") or {}).get("id", self.user_id)

    def _ensure_token(self) -> str:
        if self._access is None:
            self.sign_in()
        elif time.time() > self._expires_at - 120:
            r = self._http.post(
                f"{self.url}/auth/v1/token",
                params={"grant_type": "refresh_token"},
                headers={"apikey": self.key},
                json={"refresh_token": self._refresh},
            )
            if r.status_code >= 400:
                self.sign_in()
            else:
                self._store(r.json())
        assert self._access is not None
        return self._access

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self._ensure_token()}"}
        if extra:
            h.update(extra)
        return h

    # ------------------------------------------------------------------ rpc
    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        try:
            r = self._http.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self._headers(), json=params or {})
        except httpx.HTTPError as e:
            raise SupabaseError(f"Could not reach Supabase: {e}") from e
        if r.status_code == 401:
            self._access = None
            r = self._http.post(f"{self.url}/rest/v1/rpc/{fn}", headers=self._headers(), json=params or {})
        if r.status_code >= 400:
            raise SupabaseError(f"{fn} failed ({r.status_code}): {r.text[:500]}")
        if not r.content:
            return None
        return r.json()

    # ------------------------------------------------------------------ storage
    def download(self, bucket: str, path: str) -> bytes:
        r = self._http.get(f"{self.url}/storage/v1/object/authenticated/{bucket}/{quote(path)}", headers=self._headers())
        if r.status_code >= 400:
            raise SupabaseError(f"Download of {bucket}/{path} failed ({r.status_code}): {r.text[:200]}")
        return r.content

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        r = self._http.post(
            f"{self.url}/storage/v1/object/{bucket}/{quote(path)}",
            headers=self._headers({"Content-Type": content_type, "x-upsert": "false"}),
            content=data,
        )
        if r.status_code >= 400:
            raise SupabaseError(f"Upload to {bucket}/{path} failed ({r.status_code}): {r.text[:200]}")

    def close(self) -> None:
        self._http.close()


def wrap_network(fn_name: str, e: Exception) -> ProviderUnavailable:
    return ProviderUnavailable(f"{fn_name}: {e}")
