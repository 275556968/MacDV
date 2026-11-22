#!/bin/bash
# Exercise the production NSViewRepresentable, real AVPlayerLayers and CAAnimation
# with generated test clips in a small non-activating window. Requires a logged-in
# macOS graphical session, Swift tools and Python 3; never contacts Douyin.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/macdv-playback.XXXXXXXX")"
server=""
cleanup() {
    if [[ -n "$server" ]]; then kill "$server" 2>/dev/null || :; wait "$server" 2>/dev/null || :; fi
    /usr/bin/find "$tmp" -depth -delete
}
trap cleanup EXIT
python3 "$root/Tests/PlaybackSmoke/serve.py" "$tmp" &
server=$!
swiftc -swift-version 5 "$root/Sources/MacDV/Engine/SleepPreventer.swift" \
    "$root/Sources/MacDV/Views/VideoPlayerView.swift" \
    "$root/Tests/PlaybackSmoke/Fixture.swift" "$root/Tests/PlaybackSmoke/main.swift" -o "$tmp/smoke"
"$tmp/smoke" "$tmp"
