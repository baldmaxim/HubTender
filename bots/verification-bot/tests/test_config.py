from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import helpers  # noqa: F401 - добавляет папку бота в sys.path
from verification_bot.config import ConfigError, load_config, normalize_api_url, parse_env_file


class ConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.env_file = os.path.join(self.dir.name, "bot.env")

    def write(self, text: str) -> None:
        with open(self.env_file, "w", encoding="utf-8") as handle:
            handle.write(text)

    def test_reads_file_with_comments_and_quotes(self) -> None:
        self.write(
            "# комментарий\n\nTELEGRAM_BOT_TOKEN=\"tok\"\nTENDERHUB_API_KEY='key'\n"
            "TENDERHUB_API_URL=https://example.org/api/v1/\nCLAIM_INTERVAL_SECONDS=10\n"
        )
        config = load_config(self.env_file, self.dir.name)
        self.assertEqual(config.telegram_token, "tok")
        self.assertEqual(config.api_key, "key")
        self.assertEqual(config.api_url, "https://example.org/api/v1")
        self.assertEqual(config.claim_interval, 10)
        self.assertEqual(config.telegram_base_url, "https://api.telegram.org")
        self.assertEqual(config.log_file, os.path.join(self.dir.name, "bot.log"))

    def test_defaults(self) -> None:
        self.write("TELEGRAM_BOT_TOKEN=t\nTENDERHUB_API_KEY=k\n")
        config = load_config(self.env_file, self.dir.name)
        self.assertEqual(config.api_url, "https://gp.su10.ru/api/v1")
        self.assertEqual(config.claim_interval, 30)

    def test_environment_ignored(self) -> None:
        # На ПК агентов заданы TENDERHUB_API_URL/KEY с другим смыслом — бот их не берёт.
        self.write("TELEGRAM_BOT_TOKEN=from_file\nTENDERHUB_API_KEY=file_key\n")
        foreign = {
            "TELEGRAM_BOT_TOKEN": "from_env",
            "TENDERHUB_API_KEY": "env_key",
            "TENDERHUB_API_URL": "https://tender.su10.ru",
        }
        with mock.patch.dict(os.environ, foreign):
            config = load_config(self.env_file, self.dir.name)
        self.assertEqual(config.telegram_token, "from_file")
        self.assertEqual(config.api_key, "file_key")
        self.assertEqual(config.api_url, "https://gp.su10.ru/api/v1")

    def test_api_url_gets_api_v1(self) -> None:
        self.assertEqual(normalize_api_url("https://gp.su10.ru"), "https://gp.su10.ru/api/v1")
        self.assertEqual(normalize_api_url(" https://gp.su10.ru/ "), "https://gp.su10.ru/api/v1")
        self.assertEqual(normalize_api_url("https://gp.su10.ru/api/v1/"), "https://gp.su10.ru/api/v1")
        self.write("TELEGRAM_BOT_TOKEN=t\nTENDERHUB_API_KEY=k\nTENDERHUB_API_URL=https://gp.su10.ru\n")
        self.assertEqual(load_config(self.env_file, self.dir.name).api_url, "https://gp.su10.ru/api/v1")

    def test_bom_file(self) -> None:
        with open(self.env_file, "w", encoding="utf-8-sig") as handle:
            handle.write("TELEGRAM_BOT_TOKEN=a\nTENDERHUB_API_KEY=b\n")
        self.assertEqual(parse_env_file(self.env_file)["TELEGRAM_BOT_TOKEN"], "a")

    def test_missing_required_names_keys_not_values(self) -> None:
        self.write("TENDERHUB_API_KEY=very-secret-value\nTELEGRAM_BOT_TOKEN=\n")
        with self.assertRaises(ConfigError) as ctx:
            load_config(self.env_file, self.dir.name)
        text = str(ctx.exception)
        self.assertIn("TELEGRAM_BOT_TOKEN", text)
        self.assertNotIn("TENDERHUB_API_KEY", text)
        self.assertNotIn("very-secret-value", text)

    def test_no_file(self) -> None:
        with self.assertRaises(ConfigError) as ctx:
            load_config(os.path.join(self.dir.name, "нет.env"), self.dir.name)
        self.assertIn("TELEGRAM_BOT_TOKEN, TENDERHUB_API_KEY", str(ctx.exception))

    def test_bad_interval(self) -> None:
        self.write("TELEGRAM_BOT_TOKEN=t\nTENDERHUB_API_KEY=k\nCLAIM_INTERVAL_SECONDS=abc\n")
        with self.assertRaises(ConfigError) as ctx:
            load_config(self.env_file, self.dir.name)
        self.assertIn("CLAIM_INTERVAL_SECONDS", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
