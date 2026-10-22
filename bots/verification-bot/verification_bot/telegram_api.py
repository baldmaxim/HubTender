"""Клиент Telegram Bot API. URL содержит токен бота — нигде не логируется и не попадает в ошибки."""
from __future__ import annotations

import errno
import http.client
import json
import socket
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

# transport(method, url, headers, body, timeout) -> (HTTP-статус, тело ответа).
# Сетевой сбой — TransportError. Любой HTTP-статус (в т.ч. 4xx/5xx/3xx) возвращается как есть.
Transport = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, bytes]]


class TransportError(Exception):
    """Сетевая ошибка транспорта. Текст не содержит URL."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _describe_network_error(exc: BaseException) -> str:
    reason: Any = getattr(exc, "reason", exc)
    if isinstance(reason, (socket.timeout, TimeoutError)):
        return "таймаут соединения"
    if isinstance(reason, socket.gaierror):
        return "не удалось найти сервер (DNS)"
    if isinstance(reason, ConnectionRefusedError):
        return "соединение отклонено"
    if isinstance(reason, OSError):
        code = errno.errorcode.get(reason.errno, "") if reason.errno else ""
        return "ошибка сети" + (" (" + code + ")" if code else "")
    if isinstance(reason, str):
        return "ошибка сети"
    return "ошибка сети (" + type(reason).__name__ + ")"


def urllib_transport(
    method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float
) -> Tuple[int, bytes]:
    """Транспорт по умолчанию: urllib без следования редиректам; прокси — из HTTPS_PROXY/HTTP_PROXY."""
    opener = urllib.request.build_opener(_NoRedirect())
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        try:
            data = exc.read()
        except Exception:  # noqa: BLE001 - тело ошибки не критично
            data = b""
        return exc.code, data
    except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
        raise TransportError(_describe_network_error(exc)) from None


class TelegramError(Exception):
    """Ошибка Telegram. error_code=0 — до Telegram не достучались (сеть)."""

    def __init__(self, error_code: int, description: str, retry_after: int = 0) -> None:
        super().__init__("Telegram " + str(error_code) + ": " + description)
        self.error_code = error_code
        self.description = description
        self.retry_after = retry_after


class TelegramClient:
    def __init__(self, token: str, base_url: str, transport: Transport = urllib_transport) -> None:
        self._url_prefix = base_url.rstrip("/") + "/bot" + token + "/"
        self._transport = transport

    def call(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Any:
        body = json.dumps(params or {}, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8", "Accept": "application/json"}
        try:
            status, raw = self._transport("POST", self._url_prefix + method, headers, body, timeout)
        except TransportError as exc:
            raise TelegramError(0, "сеть недоступна: " + str(exc)) from None
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
        except (ValueError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict) and payload.get("ok") is True:
            return payload.get("result")
        if isinstance(payload, dict):
            parameters = payload.get("parameters")
            retry_after = 0
            if isinstance(parameters, dict) and isinstance(parameters.get("retry_after"), (int, float)):
                retry_after = int(parameters["retry_after"])
            code = payload.get("error_code")
            raise TelegramError(
                code if isinstance(code, int) else status,
                str(payload.get("description") or "HTTP " + str(status)),
                retry_after,
            )
        raise TelegramError(status, "HTTP " + str(status) + ": ответ не в формате Bot API")

    def get_me(self) -> Dict[str, Any]:
        result = self.call("getMe", {}, timeout=20.0)
        return result if isinstance(result, dict) else {}

    def get_updates(self, offset: int, timeout: int = 25) -> List[Dict[str, Any]]:
        result = self.call(
            "getUpdates",
            {"offset": offset, "timeout": timeout, "allowed_updates": ["message", "callback_query"]},
            timeout=timeout + 10.0,
        )
        return result if isinstance(result, list) else []

    def send_message(self, chat_id: Any, message: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"chat_id": chat_id}
        payload.update(message)
        result = self.call("sendMessage", payload)
        return result if isinstance(result, dict) else {}

    def answer_callback_query(self, callback_query_id: str, text: Optional[str] = None) -> None:
        payload: Dict[str, Any] = {"callback_query_id": callback_query_id}
        if text is not None:
            payload["text"] = text
        self.call("answerCallbackQuery", payload, timeout=15.0)
