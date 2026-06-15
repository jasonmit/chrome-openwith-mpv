import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackHeaders,
  normalizePlaybackUrl,
  pickBestCandidate,
  pickBestPlaybackState,
  isDirectMediaUrl,
  shouldIncludePlaybackStartTime,
  shouldEnableAction,
  shouldAttachPlaybackHeaders,
  shouldProbePage,
} from "../media_policy.js";

test("prefers the largest visible video over a smaller iframe", () => {
  const picked = pickBestCandidate(
    [
      { url: "https://example.com/embed/player", kind: "iframe", visible: true, area: 1280 * 720 },
      { url: "https://cdn.example.com/live.m3u8", kind: "resource", visible: false, area: 0 },
      { url: "https://cdn.example.com/hd.m3u8", kind: "video", visible: true, area: 1920 * 1080 },
    ],
    "https://example.com/watch"
  );

  assert.equal(picked.url, "https://cdn.example.com/hd.m3u8");
});

test("falls back to a visible iframe when no direct media exists", () => {
  const picked = pickBestCandidate(
    [
      { url: "https://example.com/embed/player", kind: "iframe", visible: true, area: 1280 * 720 },
      { url: "https://example.com/embed/other", kind: "iframe", visible: false, area: 640 * 360 },
    ],
    "https://example.com/watch"
  );

  assert.equal(picked.url, "https://example.com/embed/player");
});

test("buildPlaybackHeaders includes referer and user agent", () => {
  assert.deepEqual(buildPlaybackHeaders("https://example.com/watch", "Mozilla/5.0"), {
    Referer: "https://example.com/watch",
    "User-Agent": "Mozilla/5.0",
  });
});

test("normalizes youtube embed urls to watch urls", () => {
  assert.equal(
    normalizePlaybackUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
});

test("normalizes twitch player urls to channel urls", () => {
  assert.equal(
    normalizePlaybackUrl("https://player.twitch.tv/?channel=ohnepixel&parent=twitch.tv"),
    "https://www.twitch.tv/ohnepixel"
  );
});

test("recognizes direct media urls", () => {
  assert.equal(isDirectMediaUrl("https://cdn.example.com/live.m3u8"), true);
  assert.equal(isDirectMediaUrl("https://player.twitch.tv/?channel=lieth&parent=twitch.tv"), false);
});

test("does not attach playback headers to youtube watch urls", () => {
  assert.equal(shouldAttachPlaybackHeaders("https://www.youtube.com/watch?v=rb3THmr4j2c"), false);
});

test("skips page probing for youtube watch urls", () => {
  assert.equal(shouldProbePage("https://www.youtube.com/watch?v=rb3THmr4j2c"), false);
});

test("prefers the visible playback state for start time", () => {
  const picked = pickBestPlaybackState([
    { hasVideo: true, visible: false, area: 1920 * 1080, currentTime: 12.5, playing: true, paused: false },
    { hasVideo: true, visible: true, area: 640 * 360, currentTime: 98.25, playing: true, paused: false },
  ]);

  assert.equal(picked.currentTime, 98.25);
});

test("enables action for youtube urls", () => {
  assert.equal(shouldEnableAction("https://www.youtube.com/watch?v=rb3THmr4j2c", [], null), true);
});

test("does not include playback start time for twitch urls", () => {
  assert.equal(shouldIncludePlaybackStartTime("https://www.twitch.tv/ohnepixel"), false);
});

test("disables action when no media is detected", () => {
  assert.equal(shouldEnableAction("https://example.com/article", [], null), false);
});

test("enables action when media candidate exists", () => {
  assert.equal(
    shouldEnableAction("https://example.com/article", [{ url: "https://cdn.example.com/live.m3u8", kind: "resource" }], null),
    true
  );
});
