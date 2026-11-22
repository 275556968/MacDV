#!/bin/bash
# Produce a ZIP for the architecture actually built, plus its SHA-256 digest.
set -euo pipefail
case "$#:${1:-}" in
    0:) installers=0 ;;
    1:--installers) installers=1 ;;
    *) echo "Usage: $0 [--installers]" >&2; exit 2 ;;
esac
cd "$(dirname "$0")"
./build_app.sh
cd build
version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' MacDV.app/Contents/Info.plist)"
arch="$(/usr/bin/lipo -archs MacDV.app/Contents/MacOS/MacDV | tr ' ' '-')"
name="MacDV-${version}-macOS-${arch}.zip"
stage="$(mktemp -d "$PWD/.zip.XXXXXXXX")"
trap 'rm -rf "$stage"' EXIT
# Unix modes survive extraction; no Finder metadata, absolute paths or local timestamps.
python3 - "$stage/$name" <<'PYTHON'
import pathlib, sys, zipfile
app = pathlib.Path("MacDV.app")
with zipfile.ZipFile(sys.argv[1], "x") as archive:
    for path in sorted(app.rglob("*")):
        if path.is_symlink():
            raise SystemExit(f"Unexpected symlink in standalone bundle: {path}")
        if path.is_file():
            entry = zipfile.ZipInfo(path.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            mode = 0o100755 if path == app/"Contents"/"MacOS"/"MacDV" else 0o100644
            entry.external_attr = mode << 16
            archive.writestr(entry, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
PYTHON
(
    cd "$stage"
    /usr/bin/shasum -a 256 "$name" > "$name.sha256"
    /usr/bin/shasum -a 256 -c "$name.sha256"
    /usr/bin/ditto -x -k "$name" unpacked
    /usr/bin/codesign --verify --strict --deep unpacked/MacDV.app
)
artifacts=("$name" "$name.sha256")
if (( installers )); then
    base="${name%.zip}"
    mkdir "$stage/image" "$stage/payload"
    /usr/bin/ditto MacDV.app "$stage/image/MacDV.app"
    ln -s /Applications "$stage/image/Applications"
    /usr/bin/hdiutil create -quiet -volname "MacDV $version" -srcfolder "$stage/image" \
        -format UDZO "$stage/$base.dmg"
    /usr/bin/hdiutil verify -quiet "$stage/$base.dmg"
    /usr/bin/ditto MacDV.app "$stage/payload/MacDV.app"
    /usr/bin/pkgbuild --analyze --root "$stage/payload" "$stage/components.plist"
    /usr/libexec/PlistBuddy -c 'Set :0:BundleIsRelocatable false' "$stage/components.plist"
    /usr/bin/pkgbuild --root "$stage/payload" --component-plist "$stage/components.plist" \
        --identifier com.chenweijie.MacDV.pkg --version "$version" \
        --install-location /Applications "$stage/$base.pkg"
    /usr/sbin/pkgutil --payload-files "$stage/$base.pkg" >"$stage/payload-files"
    grep -Eq '(^|/)MacDV.app/Contents/MacOS/MacDV$' "$stage/payload-files"
    for installer in "$base.dmg" "$base.pkg"; do
        (cd "$stage" && /usr/bin/shasum -a 256 "$installer" > "$installer.sha256")
        artifacts+=("$installer" "$installer.sha256")
    done
fi
previous=""
for artifact in "${artifacts[@]}"; do
    if [[ -e "$artifact" && -z "${previous:-}" ]]; then previous="$(mktemp -d "$PWD/previous.XXXXXXXX")"; fi
    if [[ -e "$artifact" ]]; then mv "$artifact" "$previous/"; fi
    mv "$stage/$artifact" "$artifact"
done
printf '发布文件：%s\n' "${artifacts[@]}"
