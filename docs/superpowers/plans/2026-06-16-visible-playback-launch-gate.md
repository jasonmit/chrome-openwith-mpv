# Visible Playback Launch Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only launch mpv from generic pages when playback is visibly active, while preserving direct YouTube, Twitch, and direct media launches.

**Architecture:** Keep the existing scan/probe flow, but move the final launch decision behind a stricter gate. Generic pages can still be scanned for candidates, but hidden videos, iframe matches, and resource URLs must not trigger mpv unless playback is visibly active. Known provider and direct-media URLs remain fast-path launches.

**Tech Stack:** JavaScript native host, Chromium extension MV3, Node test runner.

## Global Constraints

- Linux only.
- Keep click-time launch behavior; no interval polling or SPA refresh plumbing.
- Keep post-launch muting of the source tab.
- Preserve YouTube and Twitch support.
- Do not add a build step or TypeScript for the native host.
- Keep the native messaging contract unchanged.

---

### Task 1: Tighten the launch gate

**Files:**
- Modify: `extension/media_policy.js:78-106`
- Modify: `extension/background.js:308-370`

**Interfaces:**
- Consumes: `shouldEnableAction(url, candidates, playbackState)`, `openBestMediaForTab(tab)`
- Produces: launch decisions that require visible active playback for generic pages

- [ ] **Step 1: Write the failing test**

Add a regression in `extension/test/media_policy.test.mjs` that proves a hidden `playbackState` does not enable generic-page launch:

```js
test("does not enable action for hidden playback state", () => {
  assert.equal(
    shouldEnableAction("https://github.com/jasonmit/chrome-openwith-mpv", [], {
      hasVideo: true,
      visible: false,
      pip: false,
      fullscreen: false,
      playing: false,
    }),
    false
  );
});
```

Add a regression in `extension/test/background.test.mjs` that a page with only hidden playback state and no real media candidates does not call `sendNativeMessage()` or `tabs.update(...muted...)`.

- [ ] **Step 2: Run the failing tests**

Run:
```bash
node --test extension/test/media_policy.test.mjs
node --test extension/test/background.test.mjs
```

Expected: the new regression fails because the current gate still treats hidden playback as launch-worthy.

- [ ] **Step 3: Implement the minimal fix**

Update `shouldEnableAction()` so the generic-page branch requires visible active playback:

```js
function shouldEnableAction(url, candidates, playbackState) {
  if (isYoutubeUrl(url) || isTwitchUrl(url) || isDirectMediaUrl(url)) {
    return true;
  }

  if (playbackState?.visible || playbackState?.pip || playbackState?.fullscreen || playbackState?.playing) {
    return true;
  }

  return false;
}
```

Leave the candidate selection in `openBestMediaForTab()` in place, but only let it run after the gate passes. That keeps the current URL-picking logic for visible playback cases without allowing hidden embeds or resource hits to trigger launch by themselves.

In `openBestMediaForTab()`, add a final gate before any `openInMpv()` call:

```js
if (!shouldEnableAction(pageUrl, pageData?.candidates || [], playbackState?.state || null)) {
  return;
}
```

- [ ] **Step 4: Run the tests again**

Run:
```bash
node --test extension/test/media_policy.test.mjs
node --test extension/test/background.test.mjs
```

Expected: both files pass.

### Task 2: Verify full suite and keep the docs clean

**Files:**
- Modify: `extension/test/media_policy.test.mjs`
- Modify: `extension/test/background.test.mjs`

**Interfaces:**
- Consumes: the updated launch gate from Task 1
- Produces: regression coverage for visible-only launch behavior

- [ ] **Step 1: Keep the regression cases narrow**

Keep the tests focused on launch behavior only:
- visible playback still launches
- hidden playback does not launch
- generic no-media pages do not launch
- YouTube/Twitch/direct media still launch through the existing fast paths

- [ ] **Step 2: Run the full suite**

Run:
```bash
node --test
```

Expected: all tests pass.

- [ ] **Step 3: Commit the fix**

Run:
```bash
git add extension/background.js extension/media_policy.js extension/test/background.test.mjs extension/test/media_policy.test.mjs
git commit -m "fix(extension): require visible playback"
```
