"""Общие заглушки для тестов: фейковый транспорт без сети, мгновенные паузы."""
from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from verification_bot.telegram_api import TelegramClient, TransportError
from verification_bot.tenderhub_api import TenderHubClient

TOKEN = "123456:SECRET-TOKEN-ABC"
API_KEY = "fot_SECRET_KEY_XYZ"
TG_BASE = "https://tg.example"
HUB_BASE = "https://hub.example/api/v1"

Reply = Union[Tuple[int, Any], Exception]


def tg_ok(result: Any) -> Tuple[int, Any]:
    return 200, {"ok": True, "result": result}


def tg_err(code: int, description: str, retry_after: int = 0) -> Tuple[int, Any]:
    body: Dict[str, Any] = {"ok": False, "error_code": code, "description": description}
    if retry_after:
        body["parameters"] = {"retry_after": retry_after}
    return code, body


def hub_ok(data: Any) -> Tuple[int, Any]:
    return 200, {"data": data}


class FakeTransport:
    """Маршрутизирует запросы по последнему сегменту URL (метод Telegram или эндпоинт TenderHUB).

    routes[ключ] — список ответов по очереди (последний повторяется) или функция(тело) -> ответ.
    """

    def __init__(self) -> None:
        self.routes: Dict[str, Union[List[Reply], Callable[[Any], Reply]]] = {}
        self.calls: List[Dict[str, Any]] = []

    def route(self, key: str, *replies: Reply) -> None:
        self.routes[key] = list(replies)

    def route_fn(self, key: str, fn: Callable[[Any], Reply]) -> None:
        self.routes[key] = fn

    def __call__(
        self, method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float
    ) -> Tuple[int, bytes]:
        payload = json.loads(body.decode("utf-8")) if body else None
        key = url.rsplit("/", 1)[-1]
        self.calls.append({"key": key, "url": url, "headers": headers, "body": payload, "timeout": timeout})
        handler = self.routes.get(key)
        if handler is None:
            raise AssertionError("нет маршрута для " + key)
        reply = handler(payload) if callable(handler) else (handler.pop(0) if len(handler) > 1 else handler[0])
        if isinstance(reply, Exception):
            raise reply
        status, data = reply
        raw = data if isinstance(data, bytes) else json.dumps(data).encode("utf-8")
        return status, raw

    def bodies(self, key: str) -> List[Any]:
        return [call["body"] for call in self.calls if call["key"] == key]


class FakeSleep:
    """Паузы без ожидания; после max_calls вызовов (если задано) выставляет stop."""

    def __init__(self, stop: Optional[threading.Event] = None, max_calls: int = 0) -> None:
        self.calls: List[float] = []
        self._stop = stop
        self._max = max_calls

    def __call__(self, seconds: float) -> bool:
        self.calls.append(seconds)
        if self._stop is not None and self._max and len(self.calls) >= self._max:
            self._stop.set()
        return self._stop.is_set() if self._stop is not None else False


def make_clients(transport: FakeTransport) -> Tuple[TelegramClient, TenderHubClient]:
    return TelegramClient(TOKEN, TG_BASE, transport), TenderHubClient(HUB_BASE, API_KEY, transport)


NETWORK_DOWN = TransportError("ошибка сети")
