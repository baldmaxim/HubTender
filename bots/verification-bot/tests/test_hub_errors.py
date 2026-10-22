from __future__ import annotations

import unittest

import helpers
from helpers import NETWORK_DOWN, FakeTransport, make_clients
from verification_bot.tenderhub_api import TenderHubError


class HubErrorsTest(unittest.TestCase):
    def call(self, *reply) -> TenderHubError:
        t = FakeTransport()
        t.route("claim", *reply)
        _, hub = make_clients(t)
        with self.assertRaises(TenderHubError) as ctx:
            hub.claim("bot")
        return ctx.exception

    def test_html_page(self) -> None:
        err = self.call((200, b"<!doctype html><html></html>"))
        self.assertIn("страницей (HTML)", str(err))
        self.assertIn("TENDERHUB_API_URL", str(err))

    def test_json_without_data(self) -> None:
        err = self.call((200, {"ok": True}))
        self.assertIn("страницей (HTML)", str(err))

    def test_redirect(self) -> None:
        err = self.call((301, b""))
        self.assertEqual(err.status, 301)
        self.assertIn("HTTP 301: адрес перенаправляет", str(err))
        self.assertIn("TENDERHUB_API_URL", str(err))

    def test_401_and_403(self) -> None:
        for status in (401, 403):
            err = self.call((status, {"code": "unauthorized", "detail": "bad key", "title": "Unauthorized"}))
            self.assertEqual(err.status, status)
            self.assertIn("ключ TenderHUB отклонён (HTTP %d)" % status, str(err))
            self.assertIn("verification:telegram", str(err))
            self.assertIn("unauthorized", str(err))
            self.assertIn("bad key", str(err))

    def test_wrong_address_404_405(self) -> None:
        # Чужой сервер или адрес без /api/v1: POST на статику — 405, нет маршрута — 404.
        for status in (404, 405):
            err = self.call((status, b"<html>405 Not Allowed</html>"))
            self.assertEqual(err.status, status)
            self.assertIn("нет API бота (HTTP %d)" % status, str(err))
            self.assertIn(helpers.HUB_BASE, str(err))
            self.assertIn("TENDERHUB_API_URL", str(err))

    def test_notification_not_found_is_not_address_error(self) -> None:
        err = self.call((404, {"code": "VERIFICATION_BOT_NOT_FOUND", "detail": "Сообщения нет в очереди."}))
        self.assertEqual(err.code, "VERIFICATION_BOT_NOT_FOUND")
        self.assertNotIn("нет API бота", str(err))

    def test_other_error_has_status_and_code(self) -> None:
        err = self.call((422, {"code": "bad_update", "detail": "нет поля"}))
        self.assertEqual(err.status, 422)
        self.assertEqual(err.code, "bad_update")
        self.assertIn("нет поля", str(err))

    def test_network(self) -> None:
        err = self.call(NETWORK_DOWN)
        self.assertEqual(err.status, 0)

    def test_valid_response(self) -> None:
        t = FakeTransport()
        t.route("claim", (200, {"data": {"messages": [{"id": "a"}, "мусор"]}}))
        _, hub = make_clients(t)
        self.assertEqual(hub.claim("bot"), [{"id": "a"}])


if __name__ == "__main__":
    unittest.main()
