#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const YOUTUBE_CONFIG_DIR = path.join(os.homedir(), ".config", "chrome-openwith-mpv", "mpv-youtube");
const YOUTUBE_CONFIG_FILE = path.join(YOUTUBE_CONFIG_DIR, "mpv.conf");
const MPV_CONFIG_FILE = path.join(os.homedir(), ".config", "mpv", "mpv.conf");

function isHttpUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function isYoutubeUrl(url) {
  if (!isHttpUrl(url)) {
    return false;
  }

  const host = new URL(url).hostname || "";
  return host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com");
}

function ensureYoutubeProfile() {
  fs.mkdirSync(YOUTUBE_CONFIG_DIR, { recursive: true });

  if (fs.existsSync(YOUTUBE_CONFIG_FILE)) {
    return;
  }

  if (!fs.existsSync(MPV_CONFIG_FILE)) {
    fs.writeFileSync(YOUTUBE_CONFIG_FILE, "", "utf8");
    return;
  }

  const lines = fs.readFileSync(MPV_CONFIG_FILE, "utf8").split(/\r?\n/);
  const filtered = lines.filter((line) => !line.trimStart().startsWith("ytdl-raw-options="));
  fs.writeFileSync(YOUTUBE_CONFIG_FILE, `${filtered.join("\n")}${filtered.length ? "\n" : ""}`, "utf8");
}

function buildLaunchArgs(url, headers = null, start_time = null) {
  const mpv = process.env.MPV_BIN || "mpv";
  const args = [mpv];

  if (isYoutubeUrl(url)) {
    ensureYoutubeProfile();
    args.push(`--config-dir=${YOUTUBE_CONFIG_DIR}`);
  } else if (headers && Object.keys(headers).length > 0) {
    const headerFields = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join(", ");
    args.push(`--http-header-fields=${headerFields}`);
  }

  if (start_time !== null && start_time !== undefined) {
    args.push(`--start=${start_time}`);
  }

  args.push(url);
  return args;
}

function waitForMpvWindow(pid, timeoutSeconds = 15, runner = spawnSync) {
  if (!process.env.DISPLAY) {
    return true;
  }

  const result = runner(
    "xdotool",
    ["search", "--sync", "--onlyvisible", "--pid", String(pid), "--limit", "1"],
    { stdio: "ignore", timeout: timeoutSeconds * 1000 }
  );

  if (result?.error?.code === "ENOENT") {
    return true;
  }

  if (result?.error?.name === "TimeoutError") {
    return false;
  }

  return result?.status === 0;
}

function launchMpvWithProcessWait(url, headers = null, start_time = null, popen = spawn, window_waiter = waitForMpvWindow) {
  const args = buildLaunchArgs(url, headers, start_time);
  const child = popen(args[0], args.slice(1), {
    stdio: "ignore",
    detached: true,
  });

  window_waiter(child.pid, 15);
  return child;
}

function launchMpv(url, headers = null, start_time = null, popen = spawn, window_waiter = waitForMpvWindow) {
  return launchMpvWithProcessWait(url, headers, start_time, popen, window_waiter);
}

function handleMessage(message, launcher = launchMpv) {
  const url = message?.url || "";
  const headers = message?.headers || {};
  const start_time = message?.start_time;

  if (!isHttpUrl(url)) {
    return { ok: false, error: "unsupported_url" };
  }

  if (start_time === null || start_time === undefined) {
    launcher(url, headers);
  } else {
    launcher(url, headers, start_time);
  }

  return { ok: true };
}

function readMessage(source = 0) {
  const read = (length) => {
    if (typeof source === "number") {
      const buffer = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const bytesRead = fs.readSync(source, buffer, offset, length - offset, null);
        if (bytesRead === 0) {
          return offset === 0 ? null : buffer.subarray(0, offset);
        }
        offset += bytesRead;
      }
      return buffer;
    }

    if (typeof source.read === "function") {
      return source.read(length);
    }

    throw new Error("unsupported_input_source");
  };

  const rawLength = read(4);
  if (!rawLength) {
    return null;
  }

  if (rawLength.length !== 4) {
    throw new Error("incomplete_length");
  }

  const length = rawLength.readUInt32LE(0);
  const payload = read(length);
  if (!payload || payload.length !== length) {
    throw new Error("incomplete_payload");
  }

  return JSON.parse(payload.toString("utf8"));
}

function writeMessage(target, message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(payload.length, 0);

  if (typeof target === "number") {
    fs.writeSync(target, length);
    fs.writeSync(target, payload);
    return;
  }

  if (typeof target.write === "function") {
    target.write(length);
    target.write(payload);
    if (typeof target.flush === "function") {
      target.flush();
    }
    return;
  }

  throw new Error("unsupported_output_target");
}

function run(stdin = 0, stdout = 1, launcher = launchMpv) {
  try {
    const message = readMessage(stdin);
    if (message === null) {
      return 0;
    }

    const response = handleMessage(message, launcher);
    writeMessage(stdout, response);
  } catch (error) {
    writeMessage(stdout, { ok: false, error: String(error.message || error) });
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  buildLaunchArgs,
  ensureYoutubeProfile,
  handleMessage,
  isHttpUrl,
  isYoutubeUrl,
  launchMpv,
  launchMpvWithProcessWait,
  readMessage,
  run,
  waitForMpvWindow,
  writeMessage,
};
