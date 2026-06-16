# chrome-openwith-mpv

Send browser media to `mpv` for better playback, controls, and hw acceleration.



https://github.com/user-attachments/assets/e9fc88fa-5238-4f52-9ec2-5dd1067d6ee6



## Platform

Linux only.

- Tested with Brave and Google Chrome on Linux desktop.
- Native messaging install paths use Linux `~/.config/...` locations.
- The host uses `xdotool` for window-waiting when available, so X11 or XWayland is the expected desktop setup.
- Not supported on macOS or Windows.

## Install

Requirements:

- `node`
- `mpv`
- `yt-dlp`
- `xdotool` for X11/XWayland window detection (optional, but recommended)
- `ytdl-raw-options=cookies-from-browser=brave` in `~/.config/mpv/mpv.conf` if you want Twitch and other cookie-gated sites

From the repository root, run:

```bash
script="$PWD/native/chrome_openwith_mpv.js"
for host_dir in \
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
  "$HOME/.config/google-chrome/NativeMessagingHosts"
do
  mkdir -p "$host_dir"
  cat > "$host_dir/com.jasonmit.chrome_openwith_mpv.json" <<EOF
{
  "name": "com.jasonmit.chrome_openwith_mpv",
  "description": "Open URLs from Chromium browsers in mpv",
  "path": "$script",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://gmclpcnmgokfgcgdjgmaaiojepmnjjlf/"
  ]
}
EOF
done
chmod 755 "$script"
```

Load the extension once in each browser you use:

- Open `brave://extensions` or `chrome://extensions`.
- Enable Developer mode.
- Select Load unpacked.
- Choose the `extension` directory in this repo.

## Use

- Click the toolbar button to inspect the current page for playable media and open the best candidate in `mpv`.
- Right-click a page and choose `Open page in mpv`.
- Right-click a link and choose `Open link in mpv`.

When the extension finds a direct stream URL, it also sends `Referer` and `User-Agent` headers to `mpv`.

The native host only accepts `http://` and `https://` URLs.

YouTube and Twitch are supported. DRM-protected sites like Netflix are not supported.
