"""Запуск: python -m verification_bot (из папки bots/verification-bot)."""
from __future__ import annotations

import logging
import logging.handlers
import signal
import sys
import threading
import traceback
from typing import Any, Iterable, Optional

from . import __version__
from .config import Config, ConfigError, load_config
from .loops import QueueLoop, Sleep, UpdatesLoop
from .telegram_api import TelegramClient, TelegramError
from .tenderhub_api import TenderHubClient

log = logging.getLogger("verification_bot")

EXIT_CONFIG = 2


class SecretsFilter(logging.Filter):
    """Страховка: заменяет токен бота и ключ TenderHUB на *** в любой строке лога, включая traceback."""

    def __init__(self, secrets: Iterable[str]) -> None:
        super().__init__()
        self._secrets = [value for value in secrets if value]

    def mask(self, text: str) -> str:
        for secret in self._secrets:
            text = text.replace(secret, "***")
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.mask(record.getMessage())
        record.args = None
        if record.exc_info:
            record.exc_text = self.mask("".join(traceback.format_exception(*record.exc_info)).rstrip("\n"))
            record.exc_info = None
        elif record.exc_text:
            record.exc_text = self.mask(record.exc_text)
        return True


def setup_logging(config: Config) -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(errors="replace")
            except Exception:  # noqa: BLE001
                pass
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    secrets_filter = SecretsFilter([config.telegram_token, config.api_key])
    handlers = [
        logging.handlers.RotatingFileHandler(config.log_file, maxBytes=1024 * 1024, backupCount=3, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
    root = logging.getLogger("verification_bot")
    root.setLevel(logging.INFO)
    for handler in handlers:
        handler.setFormatter(formatter)
        handler.addFilter(secrets_filter)
        root.addHandler(handler)
    root.propagate = False


def fetch_bot_username(telegram: TelegramClient, stop: threading.Event, sleep: Optional[Sleep] = None) -> Optional[str]:
    """getMe с повтором при сетевых сбоях. None — токен неверный или запрошена остановка."""
    wait: Sleep = sleep or stop.wait
    delay = 5
    while not stop.is_set():
        try:
            me = telegram.get_me()
        except TelegramError as exc:
            if exc.error_code in (401, 404):
                log.error("Неверный TELEGRAM_BOT_TOKEN: Telegram отклонил токен (%s)", exc)
                return None
            log.warning("Не удалось связаться с Telegram (%s), повтор через %d с", exc, delay)
            wait(delay)
            delay = min(delay * 2, 60)
            continue
        username = me.get("username")
        if isinstance(username, str) and username:
            return username
        log.error("getMe не вернул username бота")
        return None
    return None


def main() -> int:
    try:
        config = load_config()
    except ConfigError as exc:
        print("Ошибка настроек: " + str(exc), file=sys.stderr)
        return EXIT_CONFIG

    setup_logging(config)
    stop = threading.Event()
    telegram = TelegramClient(config.telegram_token, config.telegram_base_url)
    hub = TenderHubClient(config.api_url, config.api_key)

    def request_stop(_signum: int, _frame: Any) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)

    log.info("Бот рассылки замечаний TenderHUB %s запускается", __version__)
    username = fetch_bot_username(telegram, stop)
    if username is None:
        return 0 if stop.is_set() else EXIT_CONFIG
    log.info("Бот @%s запущен, API TenderHUB: %s", username, config.api_url)

    threads = [
        threading.Thread(target=UpdatesLoop(telegram, hub, stop).run, name="updates", daemon=True),
        threading.Thread(
            target=QueueLoop(telegram, hub, username, config.claim_interval, stop).run, name="queue", daemon=True
        ),
    ]
    for thread in threads:
        thread.start()
    try:
        while not stop.wait(1.0):
            pass
    except KeyboardInterrupt:
        stop.set()
    log.info("Останавливаюсь…")
    for thread in threads:
        thread.join(timeout=10)
    log.info("Бот остановлен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
