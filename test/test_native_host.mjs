import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const HOST_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../native/chrome_openwith_mpv.js");

function loadHost() {
  delete require.cache[HOST_PATH];
  return require(HOST_PATH);
}

test("rejects non-http urls", () => {
  const host = loadHost();

  const result = host.handleMessage({ url: "file:///etc/passwd" }, () => {});

  assert.equal(result.ok, false);
  assert.equal(result.error, "unsupported_url");
});

test("launches http url", () => {
  const host = loadHost();
  const launched = [];

  const result = host.handleMessage(
    { url: "https://www.twitch.tv/ohnepixel" },
    (url, headers) => launched.push([url, headers])
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(launched, [["https://www.twitch.tv/ohnepixel", {}]]);
});

test("launches http url with headers", () => {
  const host = loadHost();
  const launched = [];

  const result = host.handleMessage(
    {
      url: "https://edgestreams.pro/hls/zeuryuegn48.m3u8?st=abc&e=123",
      headers: {
        Referer: "https://buff-streams.online/UFC250/c48.php",
        "User-Agent": "Mozilla/5.0",
      },
    },
    (url, headers) => launched.push([url, headers])
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(launched, [
    [
      "https://edgestreams.pro/hls/zeuryuegn48.m3u8?st=abc&e=123",
      {
        Referer: "https://buff-streams.online/UFC250/c48.php",
        "User-Agent": "Mozilla/5.0",
      },
    ],
  ]);
});

test("build launch args skips empty headers", () => {
  const host = loadHost();

  const args = host.buildLaunchArgs("https://www.twitch.tv/ohnepixel", {});

  assert.equal(args.some((arg) => arg.startsWith("--http-header-fields=")), false);
});

test("launches http url with start time", () => {
  const host = loadHost();
  const launched = [];

  const result = host.handleMessage(
    { url: "https://www.youtube.com/watch?v=rb3THmr4j2c", start_time: 42.25 },
    (url, headers, startTime) => launched.push([url, headers, startTime])
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(launched, [["https://www.youtube.com/watch?v=rb3THmr4j2c", {}, 42.25]]);
});

test("launch mpv waits for window", () => {
  const host = loadHost();
  const calls = [];

  class Proc {
    constructor() {
      this.pid = 4321;
    }
  }

  host.launchMpv(
    "https://cdn.example.com/live.m3u8",
    null,
    null,
    (command, args, options) => {
      calls.push(["popen", command, args, options]);
      return new Proc();
    },
    (pid, timeoutSeconds) => {
      calls.push(["wait", pid, timeoutSeconds]);
      return true;
    }
  );

  assert.equal(calls[0][0], "popen");
  assert.deepEqual(calls[1], ["wait", 4321, 15]);
});

test("uses youtube profile for youtube urls", () => {
  const host = loadHost();
  const fs = require("node:fs");
  const original = {
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
  };

  fs.existsSync = () => false;
  fs.mkdirSync = () => {};
  fs.readFileSync = () => "";
  fs.writeFileSync = () => {};

  try {
    const args = host.buildLaunchArgs("https://www.youtube.com/watch?v=rb3THmr4j2c");

    assert.ok(args.some((arg) => arg.startsWith("--config-dir=")));
    assert.equal(args.some((arg) => arg.startsWith("--http-header-fields=")), false);
  } finally {
    fs.existsSync = original.existsSync;
    fs.mkdirSync = original.mkdirSync;
    fs.readFileSync = original.readFileSync;
    fs.writeFileSync = original.writeFileSync;
  }
});

test("build launch args supports start time", () => {
  const host = loadHost();

  const args = host.buildLaunchArgs("https://cdn.example.com/live.m3u8", null, 123.456);

  assert.ok(args.includes("--start=123.456"));
});

test("reads and writes native messaging frames", () => {
  const host = loadHost();
  const payload = Buffer.from(JSON.stringify({ url: "https://example.com/watch" }), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(payload.length, 0);
  const framed = Buffer.concat([length, payload]);
  const writes = [];
  const stdin = {
    cursor: 0,
    read(size) {
      const chunk = framed.subarray(this.cursor, this.cursor + size);
      this.cursor += chunk.length;
      return chunk.length ? chunk : null;
    },
  };
  const stdout = {
    write(chunk) {
      writes.push(Buffer.from(chunk));
    },
  };

  const exitCode = host.run(stdin, stdout, (url, headers) => writes.push(Buffer.from(JSON.stringify([url, headers]))));

  assert.equal(exitCode, 0);
  assert.ok(writes.length > 0);
});
