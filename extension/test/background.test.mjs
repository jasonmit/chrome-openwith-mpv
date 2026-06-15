import assert from "node:assert/strict";
import test from "node:test";

test("pauses playback after mpv launch completes", async () => {
  const events = [];

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
      query(_query, callback) {
        callback([]);
      },
      get(_tabId, callback) {
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
    ["probe", true],
  ]);

  delete globalThis.chrome;
});
