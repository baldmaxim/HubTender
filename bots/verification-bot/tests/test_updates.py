from __future__ import annotations

import threading
import unittest

from helpers import NETWORK_DOWN, FakeSleep, FakeTransport, hub_ok, make_clients, tg_err, tg_ok
from verification_bot.loops import UpdatesLoop


def make_loop(transport: FakeTransport):
    stop = threading.Event()
    tg, hub = make_clients(transport)
    sleep = FakeSleep(stop)
    return UpdatesLoop(tg, hub, stop, sleep), sleep, stop


UPDATE = {"update_id": 10, "message": {"text": "/start", "chat": {"id": 123}}}


class RelayTest(unittest.TestCase):
    def test_update_relayed_and_actions_executed(self) -> None:
        t = FakeTransport()
        t.route("getUpdates", tg_ok([UPDATE]))
        t.route("sendMessage", tg_ok({"message_id": 1}))
        t.route("answerCallbackQuery", tg_ok(True))
        t.route(
            "updates",
            hub_ok(
                {
                    "actions": [
                        {
                            "method": "sendMessage",
                            "chat_id": 123,
                            "message": {"text": "Привет", "parse_mode": "HTML", "reply_markup": {"inline_keyboard": []}},
                        },
                        {"method": "answerCallbackQuery", "callback_query_id": "cb1", "text": "Готово"},
                        {"method": "futureMethod", "x": 1},
                    ]
                }
            ),
        )
        loop, _, _ = make_loop(t)
        loop.poll_once()

        self.assertEqual(t.bodies("updates"), [{"update": UPDATE}])
        self.assertEqual(
            t.bodies("sendMessage"),
            [{"chat_id": 123, "text": "Привет", "parse_mode": "HTML", "reply_markup": {"inline_keyboard": []}}],
        )
        self.assertEqual(t.bodies("answerCallbackQuery"), [{"callback_query_id": "cb1", "text": "Готово"}])
        self.assertEqual(loop.offset, 11)
        poll = t.bodies("getUpdates")[0]
        self.assertEqual(poll["allowed_updates"], ["message", "callback_query"])
        self.assertEqual(poll["timeout"], 25)
        self.assertEqual(t.calls[0]["headers"].get("X-API-Key") is None, True)  # getUpdates — без ключа TenderHUB
        hub_call = [c for c in t.calls if c["key"] == "updates"][0]
        self.assertEqual(hub_call["headers"]["X-API-Key"], "fot_SECRET_KEY_XYZ")

    def test_unknown_method_logged_and_skipped(self) -> None:
        t = FakeTransport()
        t.route("updates", hub_ok({"actions": [{"method": "banChatMember", "chat_id": 1}]}))
        loop, _, _ = make_loop(t)
        with self.assertLogs("verification_bot", level="WARNING") as logs:
            self.assertTrue(loop.handle_update(UPDATE))
        self.assertIn("banChatMember", "\n".join(logs.output))
        self.assertEqual(t.bodies("sendMessage"), [])

    def test_reply_failures_do_not_block_offset(self) -> None:
        t = FakeTransport()
        t.route("getUpdates", tg_ok([UPDATE]))
        t.route("sendMessage", tg_err(403, "Forbidden: bot was blocked by the user"))
        t.route("answerCallbackQuery", tg_err(400, "query is too old"))
        t.route(
            "updates",
            hub_ok(
                {
                    "actions": [
                        {"method": "sendMessage", "chat_id": 1, "message": {"text": "a"}},
                        {"method": "answerCallbackQuery", "callback_query_id": "x"},
                    ]
                }
            ),
        )
        loop, _, _ = make_loop(t)
        loop.poll_once()
        self.assertEqual(loop.offset, 11)


class ErrorPolicyTest(unittest.TestCase):
    def test_400_skipped_offset_advances(self) -> None:
        t = FakeTransport()
        second = {"update_id": 11}
        t.route("getUpdates", tg_ok([UPDATE, second]))
        t.route("updates", (400, {"code": "bad", "detail": "плохой update"}), hub_ok({"actions": []}))
        loop, sleep, _ = make_loop(t)
        with self.assertLogs("verification_bot", level="WARNING"):
            loop.poll_once()
        self.assertEqual(loop.offset, 12)
        self.assertEqual(len(t.bodies("updates")), 2)
        self.assertEqual(sleep.calls, [])

    def test_404_wrong_address_retries_not_skips(self) -> None:
        # Неверный адрес API не должен съедать обновления (Start, кнопки).
        t = FakeTransport()
        t.route("updates", (404, b"not found"), (405, b"<html></html>"), hub_ok({"actions": []}))
        loop, sleep, _ = make_loop(t)
        with self.assertLogs("verification_bot", level="WARNING"):
            self.assertTrue(loop.handle_update(UPDATE))
        self.assertEqual(len(t.bodies("updates")), 3)
        self.assertEqual(sleep.calls, [5, 10])

    def test_503_retries_same_update_with_backoff(self) -> None:
        t = FakeTransport()
        t.route("updates", (503, b"x"), (503, b"x"), (503, b"x"), hub_ok({"actions": []}))
        loop, sleep, _ = make_loop(t)
        self.assertTrue(loop.handle_update(UPDATE))
        self.assertEqual(len(t.bodies("updates")), 4)
        self.assertEqual(sleep.calls, [5, 10, 20])
        self.assertTrue(all(b == {"update": UPDATE} for b in t.bodies("updates")))

    def test_backoff_caps_at_60(self) -> None:
        t = FakeTransport()
        t.route("updates", *([(401, {"code": "unauthorized"})] * 7), hub_ok({"actions": []}))
        loop, sleep, _ = make_loop(t)
        loop.handle_update(UPDATE)
        self.assertEqual(sleep.calls, [5, 10, 20, 40, 60, 60, 60])

    def test_network_error_retries(self) -> None:
        t = FakeTransport()
        t.route("updates", NETWORK_DOWN, hub_ok({"actions": []}))
        loop, sleep, _ = make_loop(t)
        self.assertTrue(loop.handle_update(UPDATE))
        self.assertEqual(sleep.calls, [5])

    def test_500_five_times_then_skip(self) -> None:
        t = FakeTransport()
        t.route("updates", (500, {"code": "internal"}))
        loop, _, _ = make_loop(t)
        with self.assertLogs("verification_bot", level="ERROR"):
            self.assertTrue(loop.handle_update(UPDATE))
        self.assertEqual(len(t.bodies("updates")), 5)

    def test_stop_during_retry_keeps_offset(self) -> None:
        t = FakeTransport()
        t.route("getUpdates", tg_ok([UPDATE]))
        t.route("updates", (503, b""))
        stop = threading.Event()
        tg, hub = make_clients(t)
        loop = UpdatesLoop(tg, hub, stop, FakeSleep(stop, max_calls=2))
        loop.poll_once()
        self.assertEqual(loop.offset, 0)

    def test_poll_errors(self) -> None:
        t = FakeTransport()
        t.route("getUpdates", tg_err(409, "Conflict"), tg_err(401, "Unauthorized"), NETWORK_DOWN, NETWORK_DOWN, tg_ok([]))
        loop, sleep, _ = make_loop(t)
        with self.assertLogs("verification_bot", level="ERROR") as logs:
            for _ in range(5):
                loop.poll_once()
        self.assertEqual(sleep.calls, [60, 300, 5, 10])
        self.assertIn("другом компьютере", "\n".join(logs.output))
        self.assertIn("Неверный TELEGRAM_BOT_TOKEN", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
