#!/usr/bin/env python3
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
from urllib.parse import urlparse


YOUTUBE_CONFIG_DIR = Path.home() / ".config" / "chrome-openwith-mpv" / "mpv-youtube"
YOUTUBE_CONFIG_FILE = YOUTUBE_CONFIG_DIR / "mpv.conf"
MPV_CONFIG_FILE = Path.home() / ".config" / "mpv" / "mpv.conf"


def is_youtube_url(url):
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return False

    host = urlparse(url).hostname or ""
    return host == "youtu.be" or host.endswith("youtube.com") or host.endswith("youtube-nocookie.com")


def ensure_youtube_profile():
    YOUTUBE_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if YOUTUBE_CONFIG_FILE.exists():
        return

    if not MPV_CONFIG_FILE.exists():
        YOUTUBE_CONFIG_FILE.write_text("", encoding="utf-8")
        return

    lines = MPV_CONFIG_FILE.read_text(encoding="utf-8").splitlines()
    filtered = [line for line in lines if not line.lstrip().startswith("ytdl-raw-options=")]
    YOUTUBE_CONFIG_FILE.write_text("\n".join(filtered) + ("\n" if filtered else ""), encoding="utf-8")


def build_launch_args(url, headers=None, start_time=None):
    mpv = os.environ.get("MPV_BIN", "mpv")
    args = [mpv]

    if is_youtube_url(url):
        ensure_youtube_profile()
        args.append(f"--config-dir={YOUTUBE_CONFIG_DIR}")
    elif headers:
        header_fields = ", ".join(f"{name}: {value}" for name, value in headers.items())
        args.append(f"--http-header-fields={header_fields}")

    if start_time is not None:
        args.append(f"--start={start_time}")

    args.append(url)
    return args


def wait_for_mpv_window(pid, timeout_seconds=15, runner=None):
    if not os.environ.get("DISPLAY"):
        return True

    if runner is None:
        runner = subprocess.run

    command = [
        "xdotool",
        "search",
        "--sync",
        "--onlyvisible",
        "--pid",
        str(pid),
        "--limit",
        "1",
    ]

    try:
        result = runner(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            check=False,
        )
        return result.returncode == 0
    except FileNotFoundError:
        return True
    except subprocess.TimeoutExpired:
        return False


def handle_message(message, launcher=None):
    url = message.get("url", "")
    headers = message.get("headers") or {}
    start_time = message.get("start_time")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "unsupported_url"}

    if launcher is None:
        launcher = launch_mpv
    if start_time is None:
        launcher(url, headers=headers)
    else:
        launcher(url, headers=headers, start_time=start_time)
    return {"ok": True}


def launch_mpv(url, headers=None, start_time=None, popen=None, window_waiter=None):
    return launch_mpv_with_process_wait(
        url,
        headers=headers,
        start_time=start_time,
        popen=popen,
        window_waiter=window_waiter,
    )


def launch_mpv_with_process_wait(url, headers=None, start_time=None, popen=None, window_waiter=None):
    args = build_launch_args(url, headers=headers, start_time=start_time)
    if popen is None:
        popen = subprocess.Popen
    if window_waiter is None:
        window_waiter = wait_for_mpv_window

    process = popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    window_waiter(process.pid)
    return process


def read_message(stdin):
    raw_length = stdin.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise ValueError("incomplete_length")
    length = struct.unpack("<I", raw_length)[0]
    payload = stdin.read(length)
    if len(payload) != length:
        raise ValueError("incomplete_payload")
    return json.loads(payload.decode("utf-8"))


def write_message(stdout, message):
    payload = json.dumps(message).encode("utf-8")
    stdout.write(struct.pack("<I", len(payload)))
    stdout.write(payload)
    stdout.flush()


def run(stdin=None, stdout=None, launcher=None):
    stdin = stdin or sys.stdin.buffer
    stdout = stdout or sys.stdout.buffer
    try:
        message = read_message(stdin)
        if message is None:
            return 0
        response = handle_message(message, launcher=launcher)
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    write_message(stdout, response)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
