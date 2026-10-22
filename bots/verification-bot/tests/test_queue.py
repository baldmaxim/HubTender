from __future__ import annotations

import threading
import unittest

from helpers import NETWORK_DOWN, FakeSleep, FakeTransport, hub_ok, make_clients, tg_err, tg_ok
from verification_bot.loops import QueueLoop


def make_loop(transport: FakeTransport):
    stop = threading.Event()
    tg, hub = make_clients(transport)
    sleep = FakeSleep(stop)
    return QueueLoop(tg, hub, "my_bot", 30, stop, sleep), sleep, stop


def msg(n: int):
    return {"id": "id-%d" % n, "chat_id": 100 + n, "message": {"text": "m%d" % n, "parse_mode": "HTML"}}


class QueueTest(unittest.TestCase):
    def test_claim_send_report_ok(self) -> None:
        t = FakeTransport()
        t.route("claim", hub_ok({"messages": [msg(1)]}))
        t.route("sendMessage", tg_ok({"message_id": 456}))
        t.route("result", hub_ok({"status": "sent"}))
        loop, _, _ = make_loop(t)
        self.assertEqual(loop.run_once(), 1)
        self.assertEqual(t.bodies("claim"), [{"bot_username": "my_bot", "limit": 20}])
        self.assertEqual(t.bodies("sendMessage"), [{"chat_id": 101, "text": "m1", "parse_mode": "HTML"}])
        self.assertEqual(t.bodies("result"), [{"ok": True, "message_id": 456}])
        url = [c for c in t.calls if c["key"] == "result"][0]["url"]
        self.assertTrue(url.endswith("/verification-bot/notifications/id-1/result"))

    def test_telegram_403_reported(self) -> None:
        t = FakeTransport()
        t.route("claim", hub_ok({"messages": [msg(1)]}))
        t.route("sendMessage", tg_err(403, "Forbidden: bot was blocked by the user"))
        t.route("result", hub_ok({"status": "failed"}))
        loop, _, _ = make_loop(t)
        loop.run_once()
        self.assertEqual(
            t.bodies("result"),
            [{"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user", "retry_after": 0}],
        )

    def test_network_error_to_telegram_reported_as_code_0(self) -> None:
        t = FakeTransport()
        t.route("claim", hub_ok({"messages": [msg(1)]}))
        t.route("sendMessage", NETWORK_DOWN)
        t.route("result", hub_ok({"status": "retry"}))
        loop, _, _ = make_loop(t)
        loop.run_once()
        self.assertEqual(t.bodies("result")[0]["error_code"], 0)
        self.assertFalse(t.bodies("result")[0]["ok"])

    def test_429_stops_batch_and_reports_rest(self) -> None:
        t = FakeTransport()
        t.route("claim", hub_ok({"messages": [msg(1), msg(2), msg(3)]}))
        t.route("sendMessage", tg_ok({"message_id": 7}), tg_err(429, "Too Many Requests: retry after 17", 17))
        t.route("result", hub_ok({"status": "x"}))
        loop, sleep, _ = make_loop(t)
        loop.run_once()
        self.assertEqual(len(t.bodies("sendMessage")), 2)
        results = t.bodies("result")
        self.assertEqual(results[0], {"ok": True, "message_id": 7})
        for res in results[1:]:
            self.assertEqual(res["error_code"], 429)
            self.assertEqual(res["retry_after"], 17)
            self.assertFalse(res["ok"])
        self.assertEqual(len(results), 3)
        self.assertEqual(sleep.calls[-1], 17)
        urls = [c["url"] for c in t.calls if c["key"] == "result"]
        self.assertTrue(urls[2].endswith("/id-3/result"))

    def test_result_retried_three_times_then_dropped(self) -> None:
        t = FakeTransport()
        t.route("claim", hub_ok({"messages": [msg(1)]}))
        t.route("sendMessage", tg_ok({"message_id": 1}))
        t.route("result", (503, b"down"))
        loop, sleep, _ = make_loop(t)
        with self.assertLogs("verification_bot", level="WARNING"):
            loop.run_once()
        self.assertEqual(len(t.bodies("result")), 3)
        self.assertEqual(sleep.calls, [2.0, 2.0])

    def test_run_loops_immediately_on_full_batch(self) -> None:
        t = FakeTransport()
        full = [msg(i) for i in range(20)]
        t.route("claim", hub_ok({"messages": full}), hub_ok({"messages": []}))
        t.route("sendMessage", tg_ok({"message_id": 1}))
        t.route("result", hub_ok({"status": "sent"}))
        stop = threading.Event()
        tg, hub = make_clients(t)
        sleep = FakeSleep(stop)
        loop = QueueLoop(tg, hub, "my_bot", 30, stop, sleep)
        # Первый claim — полная пачка (без паузы 30 с), второй — пустой, затем пауза и остановка.
        original = sleep.__call__

        def sleeping(seconds: float) -> bool:
            if seconds == 30:
                stop.set()
            return original(seconds)

        loop._sleep = sleeping
        loop.run()
        self.assertEqual(len(t.bodies("claim")), 2)
        self.assertEqual(len(t.bodies("sendMessage")), 20)
        self.assertEqual(sleep.calls.count(30), 1)

    def test_claim_error_does_not_kill_loop(self) -> None:
        t = FakeTransport()
        t.route("claim", NETWORK_DOWN)
        loop, sleep, stop = make_loop(t)
        stop_after = FakeSleep(stop, max_calls=2)
        loop._sleep = stop_after
        with self.assertLogs("verification_bot", level="ERROR"):
            loop.run()
        self.assertEqual(stop_after.calls, [30, 30])


if __name__ == "__main__":
    unittest.main()
