"""Два цикла бота: «обновления» (Telegram → TenderHUB → Telegram) и «очередь» (TenderHUB → Telegram)."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from .telegram_api import TelegramClient, TelegramError
from .tenderhub_api import TenderHubClient, TenderHubError

# Пауза, которая прерывается остановкой: возвращает True, если запрошена остановка.
Sleep = Callable[[float], bool]

RETRY_DELAYS = (5, 10, 20, 40, 60)
# 404 не пропускаем: у /updates его не бывает, значит адрес не тот — обновление
# держим до исправления настройки, а не теряем.
SKIP_STATUSES = (400, 413, 422)
MAX_SERVER_ERROR_ATTEMPTS = 5
LOG_THROTTLE_SECONDS = 60.0
CLAIM_LIMIT = 20
SEND_GAP_SECONDS = 0.05
RESULT_ATTEMPTS = 3
RESULT_RETRY_PAUSE = 2.0

log = logging.getLogger("verification_bot")


def _retry_delay(attempt: int) -> int:
    """Пауза 5→10→20→40→60 с, дальше — 60 с. attempt считается с нуля."""
    return RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]


class ThrottledLog:
    """Не пишет одну и ту же ошибку чаще раза в минуту."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._last: Dict[str, float] = {}

    def log(self, level: int, key: str, message: str) -> None:
        now = self._clock()
        last = self._last.get(key)
        if last is None or now - last >= LOG_THROTTLE_SECONDS:
            self._last[key] = now
            log.log(level, message)


class UpdatesLoop:
    """Опрашивает getUpdates и по порядку отдаёт каждое обновление серверу TenderHUB."""

    def __init__(
        self,
        telegram: TelegramClient,
        hub: TenderHubClient,
        stop: threading.Event,
        sleep: Optional[Sleep] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._tg = telegram
        self._hub = hub
        self._stop = stop
        self._sleep: Sleep = sleep or stop.wait
        self._throttle = ThrottledLog(clock)
        self.offset = 0
        self._poll_failures = 0

    # --- одно обновление ---------------------------------------------------

    def handle_update(self, update: Dict[str, Any]) -> bool:
        """True — обновление обработано или пропущено (offset можно двигать); False — остановка."""
        failures = 0
        server_errors = 0
        update_id = update.get("update_id")
        while not self._stop.is_set():
            try:
                actions = self._hub.post_update(update)
            except TenderHubError as exc:
                if exc.status in SKIP_STATUSES:
                    log.warning("Обновление %s пропущено: %s", update_id, exc)
                    return True
                if exc.status == 500:
                    server_errors += 1
                    if server_errors >= MAX_SERVER_ERROR_ATTEMPTS:
                        log.error("Обновление %s пропущено после %d попыток: %s", update_id, server_errors, exc)
                        return True
                self._throttle.log(
                    logging.WARNING, str(exc), "Не удалось передать обновление %s, повтор: %s" % (update_id, exc)
                )
                self._sleep(_retry_delay(failures))
                failures += 1
                continue
            self._run_actions(actions)
            return True
        return False

    def _run_actions(self, actions: List[Dict[str, Any]]) -> None:
        for action in actions:
            method = action.get("method")
            if method == "sendMessage":
                message = action.get("message")
                if "chat_id" not in action or not isinstance(message, dict):
                    log.warning("Действие sendMessage без chat_id/message — пропущено")
                    continue
                try:
                    self._tg.send_message(action["chat_id"], message)
                except TelegramError as exc:
                    log.warning("Не удалось отправить ответ в чат %s: %s", action["chat_id"], exc)
            elif method == "answerCallbackQuery":
                callback_id = action.get("callback_query_id")
                if not callback_id:
                    log.warning("Действие answerCallbackQuery без callback_query_id — пропущено")
                    continue
                try:
                    self._tg.answer_callback_query(str(callback_id), action.get("text"))
                except TelegramError as exc:
                    log.debug("answerCallbackQuery не выполнен (кнопка устарела?): %s", exc)
            else:
                log.warning("Неизвестное действие сервера %r — пропущено", method)

    # --- опрос Telegram ----------------------------------------------------

    def poll_once(self) -> None:
        try:
            updates = self._tg.get_updates(self.offset)
        except TelegramError as exc:
            self._on_poll_error(exc)
            return
        self._poll_failures = 0
        for update in updates:
            update_id = update.get("update_id")
            if not isinstance(update_id, int):
                log.warning("Обновление без update_id — пропущено")
                continue
            if not self.handle_update(update):
                return
            self.offset = update_id + 1

    def _on_poll_error(self, exc: TelegramError) -> None:
        if exc.error_code == 409:
            self._throttle.log(
                logging.ERROR,
                "409",
                "Бот уже запущен на другом компьютере (или у бота задан webhook). Повтор через 60 с.",
            )
            self._sleep(60)
        elif exc.error_code == 401:
            self._throttle.log(logging.ERROR, "401", "Неверный TELEGRAM_BOT_TOKEN: Telegram отклонил токен. Повтор через 5 мин.")
            self._sleep(300)
        else:
            delay = max(_retry_delay(self._poll_failures), exc.retry_after)
            self._poll_failures += 1
            self._throttle.log(
                logging.WARNING, "poll:" + str(exc), "Ошибка опроса Telegram, повтор через %d с: %s" % (delay, exc)
            )
            self._sleep(delay)

    def run(self) -> None:
        log.info("Цикл обновлений запущен")
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception:  # noqa: BLE001 - поток не должен умирать
                log.exception("Неожиданная ошибка цикла обновлений")
                self._sleep(5)
        log.info("Цикл обновлений остановлен")


class QueueLoop:
    """Забирает у TenderHUB очередь уведомлений, отправляет в Telegram и сообщает результат."""

    def __init__(
        self,
        telegram: TelegramClient,
        hub: TenderHubClient,
        bot_username: str,
        interval: float,
        stop: threading.Event,
        sleep: Optional[Sleep] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._tg = telegram
        self._hub = hub
        self._username = bot_username
        self._interval = interval
        self._stop = stop
        self._sleep: Sleep = sleep or stop.wait
        self._throttle = ThrottledLog(clock)

    def _report(self, notification_id: str, **result: Any) -> None:
        for attempt in range(RESULT_ATTEMPTS):
            try:
                self._hub.report_result(notification_id, **result)
                return
            except TenderHubError as exc:
                retryable = exc.status == 0 or exc.status == 429 or exc.status >= 500
                if not retryable or attempt == RESULT_ATTEMPTS - 1:
                    log.warning(
                        "Результат уведомления %s не передан (%s); сервер повторит отправку по истечении аренды",
                        notification_id,
                        exc,
                    )
                    return
                self._sleep(RESULT_RETRY_PAUSE)

    def process_batch(self, messages: List[Dict[str, Any]]) -> int:
        """Отправляет пачку. Возвращает число успешно отправленных."""
        sent = 0
        limited: Optional[TelegramError] = None
        for index, item in enumerate(messages):
            if self._stop.is_set():
                break
            notification_id = str(item.get("id") or "")
            if not notification_id:
                log.warning("Сообщение очереди без id — пропущено")
                continue
            if limited is not None:
                self._report(
                    notification_id,
                    ok=False,
                    error_code=429,
                    description=limited.description,
                    retry_after=limited.retry_after,
                )
                continue
            message = item.get("message")
            if "chat_id" not in item or not isinstance(message, dict):
                self._report(notification_id, ok=False, error_code=400, description="Bad Request: нет chat_id или message")
                continue
            try:
                result = self._tg.send_message(item["chat_id"], message)
            except TelegramError as exc:
                self._report(
                    notification_id,
                    ok=False,
                    error_code=exc.error_code,
                    description=exc.description,
                    retry_after=exc.retry_after,
                )
                if exc.error_code == 429:
                    limited = exc
                else:
                    self._throttle.log(
                        logging.WARNING, "send:" + str(exc), "Уведомление %s не отправлено: %s" % (notification_id, exc)
                    )
            else:
                sent += 1
                self._report(notification_id, ok=True, message_id=result.get("message_id"))
            if index < len(messages) - 1 and limited is None:
                self._sleep(SEND_GAP_SECONDS)
        if limited is not None:
            log.warning("Telegram просит подождать %d с (429)", limited.retry_after)
            self._sleep(limited.retry_after)
        return sent

    def run_once(self) -> int:
        """Один claim и обработка пачки. Возвращает размер полученной пачки."""
        messages = self._hub.claim(self._username, CLAIM_LIMIT)
        if messages:
            sent = self.process_batch(messages)
            log.info("Отправлено %d из %d", sent, len(messages))
        return len(messages)

    def run(self) -> None:
        log.info("Цикл очереди запущен")
        while not self._stop.is_set():
            try:
                count = self.run_once()
            except TenderHubError as exc:
                self._throttle.log(logging.ERROR, "claim:" + str(exc), "Очередь TenderHUB недоступна: %s" % exc)
                count = 0
            except Exception:  # noqa: BLE001 - поток не должен умирать
                log.exception("Неожиданная ошибка цикла очереди")
                count = 0
            if count >= CLAIM_LIMIT:
                continue
            self._sleep(self._interval)
        log.info("Цикл очереди остановлен")
