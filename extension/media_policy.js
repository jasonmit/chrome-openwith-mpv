const PLAYABLE_URL = /^(https?:)?\/\//i;
const MEDIA_URL = /\.(m3u8|mpd|mp4|mkv|webm|mov)(\?|#|$)/i;

function isYoutubeUrl(url) {
  if (typeof url !== "string" || !PLAYABLE_URL.test(url)) {
    return false;
  }

  const parsed = new URL(url);
  return parsed.hostname === "youtu.be" || parsed.hostname.endsWith("youtube.com") || parsed.hostname.endsWith("youtube-nocookie.com");
}

function isTwitchUrl(url) {
  if (typeof url !== "string" || !PLAYABLE_URL.test(url)) {
    return false;
  }

  const parsed = new URL(url);
  return parsed.hostname === "twitch.tv" || parsed.hostname.endsWith(".twitch.tv");
}

function isDirectMediaUrl(url) {
  return typeof url === "string" && PLAYABLE_URL.test(url) && MEDIA_URL.test(url);
}

function normalizePlaybackUrl(url) {
  if (typeof url !== "string" || !PLAYABLE_URL.test(url)) {
    return url;
  }

  const parsed = new URL(url);
  if (parsed.hostname === "youtu.be") {
    const videoId = parsed.pathname.replace(/^\//, "").split("/")[0];
    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
  }

  if (parsed.hostname.endsWith("youtube.com") || parsed.hostname.endsWith("youtube-nocookie.com")) {
    const embedMatch = parsed.pathname.match(/^\/embed\/([^/]+)/);
    if (embedMatch?.[1]) {
      return `https://www.youtube.com/watch?v=${embedMatch[1]}`;
    }

    const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/]+)/);
    if (shortsMatch?.[1]) {
      return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    }
  }

  if (parsed.hostname === "player.twitch.tv") {
    const channel = parsed.searchParams.get("channel");
    if (channel) {
      return `https://www.twitch.tv/${channel}`;
    }
  }

  return url;
}

function shouldAttachPlaybackHeaders(url) {
  if (typeof url !== "string" || !PLAYABLE_URL.test(url)) {
    return false;
  }

  const parsed = new URL(url);
  if (parsed.hostname === "youtu.be") {
    return false;
  }

  if (parsed.hostname.endsWith("youtube.com") || parsed.hostname.endsWith("youtube-nocookie.com")) {
    return false;
  }

  return true;
}

function shouldProbePage(url) {
  if (isYoutubeUrl(url)) {
    return false;
  }

  return typeof url === "string" && PLAYABLE_URL.test(url);
}

function shouldEnableAction(url, candidates, playbackState) {
  if (isYoutubeUrl(url) || isTwitchUrl(url) || isDirectMediaUrl(url)) {
    return true;
  }

  if (playbackState?.visible || playbackState?.pip || playbackState?.fullscreen || playbackState?.playing) {
    return true;
  }

  return false;
}

function shouldIncludePlaybackStartTime(url) {
  if (typeof url !== "string" || !PLAYABLE_URL.test(url)) {
    return false;
  }

  const parsed = new URL(url);
  return !parsed.hostname.endsWith("twitch.tv");
}

function buildPlaybackHeaders(pageUrl, userAgent) {
  return {
    Referer: pageUrl,
    "User-Agent": userAgent,
  };
}

function scoreCandidate(candidate, pageUrl) {
  if (!candidate || typeof candidate.url !== "string" || !PLAYABLE_URL.test(candidate.url)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (candidate.kind === "video") score += 50_000;
  else if (candidate.kind === "source") score += 40_000;
  else if (candidate.kind === "resource") score += 35_000;
  else if (candidate.kind === "iframe" || candidate.kind === "embed") score += 10_000;
  else score += 1_000;

  if (candidate.visible) score += 1_000_000;
  if (candidate.pip) score += 2_000_000;
  if (candidate.fullscreen) score += 1_500_000;
  if (candidate.playing) score += 100_000;
  if (candidate.paused === false) score += 10_000;
  if (candidate.mediaLike || MEDIA_URL.test(candidate.url)) score += 250_000;

  score += Math.min(Number(candidate.area) || 0, 4_000_000);

  if (candidate.pageUrl && candidate.pageUrl === pageUrl) score += 1;

  return score;
}

function scorePlaybackState(state) {
  if (!state || !state.hasVideo) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (state.visible) score += 5_000_000;
  if (state.pip) score += 6_000_000;
  if (state.fullscreen) score += 5_500_000;
  if (state.playing) score += 100_000;
  if (state.paused === false) score += 10_000;
  score += Math.min(Number(state.area) || 0, 1_000_000);
  return score;
}

function pickBestCandidate(candidates, pageUrl) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates || []) {
    const score = scoreCandidate(candidate, pageUrl);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function pickBestPlaybackState(states) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const state of states || []) {
    const score = scorePlaybackState(state);
    if (score > bestScore) {
      best = state;
      bestScore = score;
    }
  }

  return best;
}

export { buildPlaybackHeaders, normalizePlaybackUrl, pickBestCandidate, pickBestPlaybackState, scoreCandidate, scorePlaybackState, shouldAttachPlaybackHeaders, shouldEnableAction, shouldIncludePlaybackStartTime, shouldProbePage, isDirectMediaUrl, isTwitchUrl };
