#!/bin/bash
# Build only: never touch /Applications or an installed user's data.
set -euo pipefail
cd "$(dirname "$0")"
root="$(pwd -P)"
out="$root/build/MacDV.app"
mkdir -p build
stage="$(mktemp -d "$root/build/.app.XXXXXXXX")"
trap 'rm -rf "$stage"' EXIT
app="$stage/MacDV.app"
swift build -c release -Xswiftc -file-prefix-map -Xswiftc "$root=."
bin="$(swift build -c release --show-bin-path)/MacDV"
mkdir -p "$app/Contents/"{MacOS,Resources}
install -m 755 "$bin" "$app/Contents/MacOS/MacDV"
/usr/bin/strip -S -x "$app/Contents/MacOS/MacDV"
install -m 644 Assets/AppIcon.icns "$app/Contents/Resources/AppIcon.icns"
install -m 644 packaging/macos/Info.plist "$app/Contents/Info.plist"
/usr/bin/plutil -lint "$app/Contents/Info.plist"
/usr/bin/codesign --force --sign - --timestamp=none "$app"
/usr/bin/codesign --verify --strict --deep "$app"
if [[ -e "$out" ]]; then
    previous="$(mktemp -d "$root/build/previous.XXXXXXXX")"
    mv "$out" "$previous/"
fi
mv "$app" "$out"
echo "已构建：$out"
