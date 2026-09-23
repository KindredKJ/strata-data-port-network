"""Development signing and integrity primitives; production signers implement Signer."""

from __future__ import annotations

import hashlib
import hmac
import json
from abc import ABC, abstractmethod
from typing import Any, Mapping

from .models import Signature


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


class Signer(ABC):
    @abstractmethod
    def sign(self, value: Mapping[str, Any]) -> Signature: ...

    @abstractmethod
    def verify(self, value: Mapping[str, Any], signature: Signature) -> bool: ...


class DevelopmentHMACSigner(Signer):
    """Local-test signer. It is deliberately impossible to label it production proof."""

    def __init__(self, secret: bytes, key_id: str = "local-test-key") -> None:
        if not secret:
            raise ValueError("development signer secret must not be empty")
        self._secret = secret
        self._key_id = key_id

    def sign(self, value: Mapping[str, Any]) -> Signature:
        value_hash = hmac.new(self._secret, canonical_json(value), hashlib.sha256).hexdigest()
        return Signature(self._key_id, "HMAC-SHA256", value_hash)

    def verify(self, value: Mapping[str, Any], signature: Signature) -> bool:
        expected = self.sign(value)
        return signature.assurance == "development-only" and hmac.compare_digest(expected.value, signature.value)


class ManagedKeySigner(Signer):
    """Interface marker for managed KMS/HSM implementations; no credentials included."""

    def sign(self, value: Mapping[str, Any]) -> Signature:
        raise NotImplementedError("configure an authorized managed-key adapter")

    def verify(self, value: Mapping[str, Any], signature: Signature) -> bool:
        raise NotImplementedError("configure an authorized managed-key adapter")
