from __future__ import annotations

import io
import logging
import threading
import unittest

from helpers import API_KEY, TOKEN, FakeSleep, FakeTransport, hub_ok, make_clients, tg_err
from verification_bot.__main__ import SecretsFilter
from verification_bot.loops import QueueLoop, UpdatesLoop
from verification_bot.telegram_api import TelegramError


class SecretsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.stream = io.StringIO()
        handler = logging.StreamHandler(self.stream)
        handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        handler.addFilter(SecretsFilter([TOKEN, API_KEY]))
        self.logger = logging.getLogger("verification_bot")
        self.old_level = self.logger.level
        self.logger.setLevel(logging.DEBUG)
        self.logger.addHandler(handler)
        self.addCleanup(self.logger.removeHandler, handler)
        self.addCleanup(self.logger.setLevel, self.old_level)

    def test_filter_masks_message_args_and_traceback(self) -> None:
        try:
            raise RuntimeError("url https://x/bot" + TOKEN + "/getMe key " + API_KEY)
        except RuntimeError:
            self.logger.exception("ошибка %s", TOKEN)
        out = self.stream.getvalue()
        self.assertNotIn(TOKEN, out)
        self.assertNotIn(API_KEY, out)
        self.assertIn("***", out)

    def test_no_secrets_after_telegram_and_hub_errors(self) -> None:
        t = FakeTransport()
        t.route("sendMessage", tg_err(403, "Forbidden"))
        t.route("claim", (401, {"code": "unauthorized"}))
        t.route("result", hub_ok({"status": "x"}))
        t.route("updates", (503, b"x"), hub_ok({"actions": [{"method": "sendMessage", "chat_id": 1, "message": {}}]}))
        tg, hub = make_clients(t)
        stop = threading.Event()
        UpdatesLoop(tg, hub, stop, FakeSleep(stop)).handle_update({"update_id": 1})
        queue = QueueLoop(tg, hub, "bot", 30, stop, FakeSleep(stop, max_calls=1))
        queue.process_batch([{"id": "n1", "chat_id": 1, "message": {"text": "x"}}])
        stop.clear()
        queue.run()
        out = self.stream.getvalue()
        self.assertNotEqual(out, "")
        self.assertNotIn(TOKEN, out)
        self.assertNotIn(API_KEY, out)

    def test_exceptions_do_not_contain_url(self) -> None:
        err = TelegramError(0, "сеть недоступна: ошибка сети")
        self.assertNotIn(TOKEN, str(err))
        t = FakeTransport()
        from helpers import NETWORK_DOWN

        t.route("getMe", NETWORK_DOWN)
        tg, _ = make_clients(t)
        with self.assertRaises(TelegramError) as ctx:
            tg.get_me()
        self.assertEqual(ctx.exception.error_code, 0)
        self.assertNotIn(TOKEN, str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
