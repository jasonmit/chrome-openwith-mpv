import importlib.util
import io
import json
import struct
import unittest
from pathlib import Path


HOST_PATH = Path(__file__).resolve().parents[1] / "native" / "chrome_openwith_mpv.py"


def load_host():
    spec = importlib.util.spec_from_file_location("chrome_openwith_mpv", HOST_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeHostTests(unittest.TestCase):
    def test_rejects_non_http_urls(self):
        host = load_host()

        result = host.handle_message({"url": "file:///etc/passwd"}, launcher=lambda _url: None)

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "unsupported_url")

    def test_launches_http_url(self):
        host = load_host()
        launched = []

        result = host.handle_message(
            {"url": "https://www.twitch.tv/ohnepixel"},
            launcher=lambda url, headers=None: launched.append((url, headers)),
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(launched, [("https://www.twitch.tv/ohnepixel", {})])

    def test_launches_http_url_with_headers(self):
        host = load_host()
        launched = []

        result = host.handle_message(
            {
                "url": "https://edgestreams.pro/hls/zeuryuegn48.m3u8?st=abc&e=123",
                "headers": {
                    "Referer": "https://buff-streams.online/UFC250/c48.php",
                    "User-Agent": "Mozilla/5.0",
                },
            },
            launcher=lambda url, headers=None: launched.append((url, headers)),
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(
            launched,
            [
                (
                    "https://edgestreams.pro/hls/zeuryuegn48.m3u8?st=abc&e=123",
                    {
                        "Referer": "https://buff-streams.online/UFC250/c48.php",
                        "User-Agent": "Mozilla/5.0",
                    },
                )
            ],
        )

    def test_launches_http_url_with_start_time(self):
        host = load_host()
        launched = []

        result = host.handle_message(
            {"url": "https://www.youtube.com/watch?v=rb3THmr4j2c", "start_time": 42.25},
            launcher=lambda url, headers=None, start_time=None: launched.append((url, headers, start_time)),
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(launched, [("https://www.youtube.com/watch?v=rb3THmr4j2c", {}, 42.25)])

    def test_launch_mpv_waits_for_window(self):
        host = load_host()
        calls = []

        class Proc:
            pid = 4321

        def fake_popen(args, **kwargs):
            calls.append(("popen", args, kwargs))
            return Proc()

        def fake_wait(pid, timeout_seconds=15):
            calls.append(("wait", pid, timeout_seconds))
            return True

        host.launch_mpv(
            "https://cdn.example.com/live.m3u8",
            popen=fake_popen,
            window_waiter=fake_wait,
        )

        self.assertEqual(calls[0][0], "popen")
        self.assertEqual(calls[1], ("wait", 4321, 15))

    def test_uses_youtube_profile_for_youtube_urls(self):
        host = load_host()
        config_dir = Path.home() / ".config" / "chrome-openwith-mpv" / "mpv-youtube"

        args = host.build_launch_args("https://www.youtube.com/watch?v=rb3THmr4j2c")

        self.assertIn(f"--config-dir={config_dir}", args)
        self.assertNotIn("--http-header-fields=", " ".join(args))
        self.assertNotIn("cookies-from-browser=brave", " ".join(args))

    def test_build_launch_args_supports_start_time(self):
        host = load_host()

        args = host.build_launch_args(
            "https://cdn.example.com/live.m3u8",
            start_time=123.456,
        )

        self.assertIn("--start=123.456", args)

    def test_reads_and_writes_native_messaging_frames(self):
        host = load_host()
        payload = json.dumps({"url": "https://example.com/watch"}).encode("utf-8")
        stdin = io.BytesIO(struct.pack("<I", len(payload)) + payload)
        stdout = io.BytesIO()
        launched = []

        exit_code = host.run(
            stdin=stdin,
            stdout=stdout,
            launcher=lambda url, headers=None: launched.append((url, headers)),
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(launched, [("https://example.com/watch", {})])
        stdout.seek(0)
        size = struct.unpack("<I", stdout.read(4))[0]
        response = json.loads(stdout.read(size).decode("utf-8"))
        self.assertEqual(response, {"ok": True})


if __name__ == "__main__":
    unittest.main()
