import { buildPlaybackHeaders, isDirectMediaUrl, normalizePlaybackUrl, pickBestCandidate, pickBestPlaybackState, shouldAttachPlaybackHeaders, shouldIncludePlaybackStartTime, shouldProbePage } from "./media_policy.js";

const HOST_NAME = "com.jasonmit.chrome_openwith_mpv";
const IDLE_ICON = "icons/mpv.png";
const LOADING_FRAMES = [
  "icons/loading/loading-0.png",
  "icons/loading/loading-1.png",
  "icons/loading/loading-2.png",
  "icons/loading/loading-3.png",
  "icons/loading/loading-4.png",
  "icons/loading/loading-5.png",
  "icons/loading/loading-6.png",
  "icons/loading/loading-7.png",
];
const ICON_PATHS = {
  16: IDLE_ICON,
  32: IDLE_ICON,
  48: IDLE_ICON,
  128: IDLE_ICON,
};

let loadingTimer = null;
let loadingRequests = 0;
let loadingFrame = 0;

function isHttpUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "unknown error"));
        return;
      }
      resolve(response);
    });
  });
}

function setIdleIcon() {
  chrome.action.setIcon({ path: ICON_PATHS });
}

function setLoadingFrame(frame) {
  const path = LOADING_FRAMES[frame % LOADING_FRAMES.length];
  chrome.action.setIcon({
    path: {
      16: path,
      32: path,
      48: path,
      128: path,
    },
  });
}

function startLoadingIcon() {
  loadingRequests += 1;
  if (loadingRequests > 1) {
    return;
  }

  loadingFrame = 0;
  setLoadingFrame(loadingFrame);
  loadingTimer = setInterval(() => {
    loadingFrame = (loadingFrame + 1) % LOADING_FRAMES.length;
    setLoadingFrame(loadingFrame);
  }, 120);
}

function stopLoadingIcon() {
  if (loadingRequests > 0) {
    loadingRequests -= 1;
  }

  if (loadingRequests > 0) {
    return;
  }

  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  setIdleIcon();
}

function executeScript(target, func, args = []) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target, func, args }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results || []);
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
        return;
      }

      resolve(tab);
    });
  });
}

function scanPageForMedia(pageUrl) {
  const MEDIA_URL = /\.(m3u8|mpd|mp4|mkv|webm|mov)(\?|#|$)/i;
  const seen = new Set();
  const candidates = [];
  const userAgent = navigator.userAgent;

  function isHttpCandidate(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 48) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity || "1") === 0) {
      return false;
    }
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function areaOf(el) {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.round(rect.width * rect.height));
  }

  function addCandidate(candidate) {
    if (!candidate || !isHttpCandidate(candidate.url)) return;
    const key = `${candidate.kind}:${candidate.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  }

  for (const video of document.querySelectorAll("video")) {
    const videoUrl = video.currentSrc || video.src || "";
    const videoCandidate = {
      kind: "video",
      url: videoUrl,
      visible: isVisible(video),
      area: areaOf(video),
      pip: document.pictureInPictureElement === video,
      fullscreen: document.fullscreenElement === video || video.matches(":fullscreen"),
      paused: video.paused,
      playing: !video.paused && !video.ended,
      mediaLike: MEDIA_URL.test(videoUrl),
      pageUrl,
    };
    addCandidate(videoCandidate);

    for (const source of video.querySelectorAll("source[src]")) {
      addCandidate({
        kind: "source",
        url: source.src,
        visible: videoCandidate.visible,
        area: videoCandidate.area,
        pip: videoCandidate.pip,
        fullscreen: videoCandidate.fullscreen,
        paused: videoCandidate.paused,
        playing: videoCandidate.playing,
        mediaLike: MEDIA_URL.test(source.src),
        pageUrl,
      });
    }
  }

  for (const frame of document.querySelectorAll("iframe[src], embed[src]")) {
    const frameUrl = frame.src || "";
    addCandidate({
      kind: frame.tagName.toLowerCase(),
      url: frameUrl,
      visible: isVisible(frame),
      area: areaOf(frame),
      mediaLike: MEDIA_URL.test(frameUrl),
      pageUrl,
    });
  }

  for (const entry of performance.getEntriesByType("resource")) {
    if (!isHttpCandidate(entry.name) || !MEDIA_URL.test(entry.name)) continue;
    addCandidate({
      kind: "resource",
      url: entry.name,
      visible: false,
      area: 0,
      mediaLike: true,
      pageUrl,
    });
  }

  return { pageUrl, userAgent, candidates };
}

function scanPlaybackState(pausePlayback) {
  const states = [];
  const pageUrl = location.href;
  const userAgent = navigator.userAgent;

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 48) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity || "1") === 0) {
      return false;
    }
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function areaOf(el) {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.round(rect.width * rect.height));
  }

  for (const video of document.querySelectorAll("video")) {
    const state = {
      hasVideo: true,
      visible: isVisible(video),
      area: areaOf(video),
      pip: document.pictureInPictureElement === video,
      fullscreen: document.fullscreenElement === video || video.matches(":fullscreen"),
      paused: video.paused,
      playing: !video.paused && !video.ended,
      currentTime: video.currentTime,
      pageUrl,
      userAgent,
    };

    if (pausePlayback && !video.paused) {
      video.pause();
    }

    states.push(state);
  }

  return { pageUrl, userAgent, states };
}

async function probeTab(tabId, pageUrl) {
  const results = await executeScript({ tabId, allFrames: true }, scanPageForMedia, [pageUrl]);
  const mergedCandidates = [];
  let detectedPageUrl = null;
  let userAgent = null;

  for (const result of results) {
    const payload = result?.result;
    if (!payload) continue;
    detectedPageUrl = detectedPageUrl || payload.pageUrl || null;
    userAgent = userAgent || payload.userAgent || null;
    mergedCandidates.push(...(payload.candidates || []));
  }

  return { pageUrl: detectedPageUrl || pageUrl || null, userAgent, candidates: mergedCandidates };
}

async function probePlaybackState(tabId, pausePlayback) {
  const results = await executeScript({ tabId, allFrames: true }, scanPlaybackState, [pausePlayback]);
  const states = [];
  let pageUrl = null;
  let userAgent = null;

  for (const result of results) {
    const payload = result?.result;
    if (!payload) continue;
    pageUrl = pageUrl || payload.pageUrl || null;
    userAgent = userAgent || payload.userAgent || null;
    states.push(...(payload.states || []));
  }

  return { pageUrl, userAgent, state: pickBestPlaybackState(states) };
}

async function mutePlaybackForTab(tabId) {
  if (!tabId) {
    return;
  }

  try {
    await new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, { muted: true }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    console.warn("Chrome Open with mpv mute failed:", error.message);
  }
}

async function openInMpv(url, referer, userAgent, startTime) {
  url = normalizePlaybackUrl(url);
  if (!isHttpUrl(url)) {
    console.warn("Chrome Open with mpv: unsupported URL", url);
    return;
  }

  const headers = referer && referer !== url && shouldAttachPlaybackHeaders(url) ? buildPlaybackHeaders(referer, userAgent) : null;
  const message = { url };
  if (headers) message.headers = headers;
  if (startTime !== undefined && startTime !== null && Number.isFinite(startTime) && startTime > 0) {
    message.start_time = startTime;
  }
  startLoadingIcon();
  try {
    await sendNativeMessage(message);
  } finally {
    stopLoadingIcon();
  }
}

async function openBestMediaForTab(tab) {
  const liveTab = tab?.id ? await getTab(tab.id) : null;
  if (!liveTab) {
    return;
  }

  const fallbackUrl = liveTab.url;
  if (!isHttpUrl(fallbackUrl)) {
    console.warn("Chrome Open with mpv: unsupported tab URL", fallbackUrl);
    return;
  }

  let playbackState = null;
  try {
    playbackState = await probePlaybackState(tab.id, false);
  } catch (error) {
    console.warn("Chrome Open with mpv playback probe failed:", error.message);
  }

  let pageData = null;
  if (shouldProbePage(fallbackUrl)) {
    try {
      pageData = await probeTab(tab.id, fallbackUrl);
    } catch (error) {
      console.warn("Chrome Open with mpv probe failed:", error.message);
    }
  }

  const pageUrl = pageData?.pageUrl || fallbackUrl;
  const userAgent = pageData?.userAgent || navigator.userAgent;
  const candidate = pickBestCandidate(pageData?.candidates || [], pageUrl);
  const startTime = shouldIncludePlaybackStartTime(pageUrl) ? playbackState?.state?.currentTime : undefined;
  const isTwitchPage = new URL(pageUrl).hostname.endsWith("twitch.tv");

  if (candidate?.url && candidate.url !== pageUrl && (!isTwitchPage || isDirectMediaUrl(candidate.url))) {
    await openInMpv(candidate.url, pageUrl, userAgent, startTime);
    await mutePlaybackForTab(tab.id);
    return;
  }

  await openInMpv(pageUrl, pageUrl, userAgent, startTime);
  await mutePlaybackForTab(tab.id);
}

async function openLinkInMpv(linkUrl, pageUrl) {
  linkUrl = normalizePlaybackUrl(linkUrl);
  if (!isHttpUrl(linkUrl)) {
    console.warn("Chrome Open with mpv: unsupported link URL", linkUrl);
    return;
  }

  await openInMpv(linkUrl, pageUrl || linkUrl, navigator.userAgent, undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  setIdleIcon();

  chrome.contextMenus.create({
    id: "open-page-with-mpv",
    title: "Open page in mpv",
    contexts: ["page"],
  });

  chrome.contextMenus.create({
    id: "open-link-with-mpv",
    title: "Open link in mpv",
    contexts: ["link"],
  });
});

chrome.action.onClicked.addListener((tab) => {
  openBestMediaForTab(tab).catch((error) => {
    console.error("Chrome Open with mpv failed:", error.message);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-link-with-mpv") {
    openLinkInMpv(info.linkUrl, info.pageUrl || tab?.url).catch((error) => {
      console.error("Chrome Open with mpv link failed:", error.message);
    });
    return;
  }

  if (info.menuItemId === "open-page-with-mpv") {
    openBestMediaForTab(tab).catch((error) => {
      console.error("Chrome Open with mpv page failed:", error.message);
    });
  }
});

export { openBestMediaForTab };
