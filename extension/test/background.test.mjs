import assert from "node:assert/strict";
import test from "node:test";

test("launches mpv and mutes the source tab", async () => {
  const events = [];
  const updates = [];

  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendNativeMessage(_host, message, callback) {
        events.push(["native", message]);
        callback({ ok: true });
      },
      onInstalled: { addListener() {} },
    },
    action: {
      enable() {},
      disable() {},
      setIcon() {},
      onClicked: { addListener() {} },
    },
    scripting: {
      executeScript(_options, callback) {
        events.push(["probe", _options.args[0]]);
        callback([
          {
            result: {
              pageUrl: "https://www.youtube.com/watch?v=rb3THmr4j2c",
              userAgent: "Mozilla/5.0",
              states: [
                {
                  hasVideo: true,
                  visible: true,
                  area: 1920 * 1080,
                  currentTime: 12.34,
                  playing: true,
                  paused: false,
                },
              ],
            },
          },
        ]);
      },
    },
    tabs: {
      get(_tabId, callback) {
        callback({ id: 1, url: "https://www.youtube.com/watch?v=rb3THmr4j2c" });
      },
      update(_tabId, _updateProperties, callback) {
        updates.push([_tabId, _updateProperties]);
        callback({});
      },
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    contextMenus: {
      create() {},
      onClicked: { addListener() {} },
    },
  };

  const module = await import(`../background.js?${Date.now()}`);

  await module.openBestMediaForTab({ id: 1, url: "https://www.youtube.com/watch?v=rb3THmr4j2c" });

  assert.deepEqual(events, [
    ["probe", false],
    ["native", { url: "https://www.youtube.com/watch?v=rb3THmr4j2c", start_time: 12.34 }],
  ]);
  assert.deepEqual(updates, [[1, { muted: true }]]);
});

test("does not launch mpv when only hidden media candidates exist", async () => {
  const events = [];
  const updates = [];

  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendNativeMessage(_host, message, callback) {
        events.push(["native", message]);
        callback({ ok: true });
      },
      onInstalled: { addListener() {} },
    },
    action: {
      enable() {},
      disable() {},
      setIcon() {},
      onClicked: { addListener() {} },
    },
    scripting: {
      executeScript(_options, callback) {
        events.push(["probe", _options.args[0]]);
        callback([
          {
            result: {
              pageUrl: "https://example.com/article",
              userAgent: "Mozilla/5.0",
              states: [
                {
                  hasVideo: true,
                  visible: false,
                  pip: false,
                  fullscreen: false,
                  playing: false,
                },
              ],
              candidates: [
                {
                  url: "https://cdn.example.com/live.m3u8",
                  kind: "resource",
                  visible: false,
                  area: 0,
                },
              ],
            },
          },
        ]);
      },
    },
    tabs: {
      get(_tabId, callback) {
        callback({ id: 1, url: "https://example.com/article" });
      },
      update(_tabId, _updateProperties, callback) {
        updates.push([_tabId, _updateProperties]);
        callback({});
      },
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    contextMenus: {
      create() {},
      onClicked: { addListener() {} },
    },
  };

  const module = await import(`../background.js?${Date.now()}`);

  await module.openBestMediaForTab({ id: 1, url: "https://example.com/article" });

  assert.deepEqual(events, [
    ["probe", false],
    ["probe", "https://example.com/article"],
  ]);
  assert.deepEqual(updates, []);
});
