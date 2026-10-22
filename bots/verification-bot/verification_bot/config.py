"""Настройки бота: файл bot.env рядом с программой + переменные окружения (они главнее)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Mapping, Optional

BOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE_NAME = "bot.env"

DEFAULT_API_URL = "https://gp.su10.ru/api/v1"
DEFAULT_TELEGRAM_BASE_URL = "https://api.telegram.org"
DEFAULT_CLAIM_INTERVAL = 30.0
DEFAULT_LOG_NAME = "bot.log"

REQUIRED_KEYS = ("TELEGRAM_BOT_TOKEN", "TENDERHUB_API_KEY")


class ConfigError(Exception):
    """Ошибка настроек. В тексте только имена ключей, значения (секреты) не попадают."""


@dataclass(frozen=True)
class Config:
    telegram_token: str
    api_key: str
    api_url: str
    claim_interval: float
    telegram_base_url: str
    log_file: str


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def parse_env_file(path: str) -> Dict[str, str]:
    """Читает KEY=VALUE; пропускает пустые строки и # комментарии. Нет файла — пустой словарь."""
    result: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            lines = handle.read().splitlines()
    except FileNotFoundError:
        return result
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key:
            result[key] = _unquote(value.strip())
    return result


def load_config(
    environ: Optional[Mapping[str, str]] = None,
    env_file: Optional[str] = None,
    base_dir: str = BOT_DIR,
) -> Config:
    """Собирает настройки. Окружение приоритетнее файла; пустое значение считается незаданным."""
    env = os.environ if environ is None else environ
    file_values = parse_env_file(env_file if env_file is not None else os.path.join(base_dir, ENV_FILE_NAME))

    def get(key: str) -> str:
        value = (env.get(key) or "").strip()
        if value:
            return value
        return (file_values.get(key) or "").strip()

    missing = [key for key in REQUIRED_KEYS if not get(key)]
    if missing:
        raise ConfigError(
            "Не заданы обязательные настройки: "
            + ", ".join(missing)
            + ". Заполните файл bot.env (образец — bot.env.example) или переменные окружения."
        )

    api_url = (get("TENDERHUB_API_URL") or DEFAULT_API_URL).rstrip("/")
    if not api_url.lower().startswith(("http://", "https://")):
        raise ConfigError("TENDERHUB_API_URL: адрес должен начинаться с https:// (например, " + DEFAULT_API_URL + ")")

    telegram_base_url = (get("TELEGRAM_API_BASE_URL") or DEFAULT_TELEGRAM_BASE_URL).rstrip("/")
    if not telegram_base_url.lower().startswith(("http://", "https://")):
        raise ConfigError("TELEGRAM_API_BASE_URL: адрес должен начинаться с https://")

    interval_raw = get("CLAIM_INTERVAL_SECONDS")
    interval = DEFAULT_CLAIM_INTERVAL
    if interval_raw:
        try:
            interval = float(interval_raw)
        except ValueError:
            raise ConfigError("CLAIM_INTERVAL_SECONDS: ожидается положительное число секунд") from None
        if interval <= 0:
            raise ConfigError("CLAIM_INTERVAL_SECONDS: ожидается положительное число секунд")

    log_file = get("LOG_FILE") or DEFAULT_LOG_NAME
    if not os.path.isabs(log_file):
        log_file = os.path.join(base_dir, log_file)

    return Config(
        telegram_token=get("TELEGRAM_BOT_TOKEN"),
        api_key=get("TENDERHUB_API_KEY"),
        api_url=api_url,
        claim_interval=interval,
        telegram_base_url=telegram_base_url,
        log_file=log_file,
    )
