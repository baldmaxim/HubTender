"""Клиент API TenderHUB (машинный ключ в X-API-Key). Редиректам не следует."""
from __future__ import annotations

import json
import urllib.parse
from typing import Any, Dict, List, Optional

from .telegram_api import Transport, TransportError, urllib_transport


class TenderHubError(Exception):
    """Ошибка обращения к TenderHUB. status=0 — сеть; код/деталь problem+json — в атрибутах."""

    def __init__(self, status: int, message: str, code: str = "", detail: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.detail = detail


class TenderHubClient:
    def __init__(self, base_url: str, api_key: str, transport: Transport = urllib_transport) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._transport = transport

    def _request(self, path: str, payload: Dict[str, Any], timeout: float = 30.0) -> Dict[str, Any]:
        headers = {
            "X-API-Key": self._api_key,
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            status, raw = self._transport("POST", self._base_url + path, headers, body, timeout)
        except TransportError as exc:
            raise TenderHubError(0, "TenderHUB недоступен: " + str(exc)) from None

        if 300 <= status < 400:
            raise TenderHubError(
                status,
                "HTTP " + str(status) + ": адрес перенаправляет — укажите https://…/api/v1 в TENDERHUB_API_URL",
            )

        parsed: Any = None
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else None
        except (ValueError, UnicodeDecodeError):
            parsed = None

        if 200 <= status < 300:
            if isinstance(parsed, dict) and "data" in parsed:
                data = parsed["data"]
                return data if isinstance(data, dict) else {}
            raise TenderHubError(
                status,
                "TenderHUB ответил не API, а страницей (HTML) — проверьте TENDERHUB_API_URL: https и /api/v1",
            )

        code = ""
        detail = ""
        if isinstance(parsed, dict):
            code = str(parsed.get("code") or "")
            detail = str(parsed.get("detail") or parsed.get("title") or "")
        extra = ", ".join(part for part in (code, detail) if part)
        if status in (401, 403):
            message = (
                "ключ TenderHUB отклонён (HTTP " + str(status) + "): "
                "проверьте TENDERHUB_API_KEY и область verification:telegram"
            )
        elif status in (404, 405) and code != "VERIFICATION_BOT_NOT_FOUND":
            # Маршрута нет: чужой сервер, адрес без /api/v1 или бэкенд без API бота.
            message = (
                "по адресу " + self._base_url + " нет API бота (HTTP " + str(status) + "): "
                "проверьте TENDERHUB_API_URL в bot.env — https://gp.su10.ru/api/v1"
            )
        else:
            message = "TenderHUB: HTTP " + str(status)
        if extra:
            message += " (" + extra + ")"
        raise TenderHubError(status, message, code, detail)

    def post_update(self, update: Dict[str, Any]) -> List[Dict[str, Any]]:
        data = self._request("/verification-bot/updates", {"update": update})
        actions = data.get("actions")
        return [item for item in actions if isinstance(item, dict)] if isinstance(actions, list) else []

    def claim(self, bot_username: str, limit: int = 20) -> List[Dict[str, Any]]:
        data = self._request("/verification-bot/claim", {"bot_username": bot_username, "limit": limit})
        messages = data.get("messages")
        return [item for item in messages if isinstance(item, dict)] if isinstance(messages, list) else []

    def report_result(
        self,
        notification_id: str,
        ok: bool,
        message_id: Optional[int] = None,
        error_code: int = 0,
        description: str = "",
        retry_after: int = 0,
    ) -> None:
        if ok:
            payload: Dict[str, Any] = {"ok": True, "message_id": message_id}
        else:
            payload = {
                "ok": False,
                "error_code": error_code,
                "description": description,
                "retry_after": retry_after,
            }
        path = "/verification-bot/notifications/" + urllib.parse.quote(str(notification_id), safe="") + "/result"
        self._request(path, payload)
