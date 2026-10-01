#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

VERSION="1.0.0"
APP_NAME="MacDV"
APP_BUNDLE="MacDV.app"
APP_DIR="$DIR/build/$APP_BUNDLE"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "🔨 正在编译 $APP_NAME Release 模式..."
swift build -c release

echo "📦 正在组织 $APP_BUNDLE Bundle..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy binary
cp "$DIR/.build/release/MacDV" "$MACOS_DIR/MacDV"
chmod +x "$MACOS_DIR/MacDV"

# Copy Icon
if [ -f "$DIR/Assets/AppIcon.icns" ]; then
    cp "$DIR/Assets/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"
fi

# Write Info.plist
cat << 'EOF' > "$CONTENTS_DIR/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>MacDV</string>
    <key>CFBundleIdentifier</key>
    <string>com.chenweijie.MacDV</string>
    <key>CFBundleName</key>
    <string>MacDV</string>
    <key>CFBundleDisplayName</key>
    <string>MacDV 抖音客户端</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>com.chenweijie.MacDV.schemes</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>bitbrowser</string>
                <string>adspower</string>
                <string>hubstudio</string>
                <string>ixbrowser</string>
                <string>maskfog</string>
                <string>snssdk</string>
                <string>snssdk1128</string>
                <string>bytedance</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
EOF

echo "🔏 正在进行本地代码自签名..."
codesign --force --deep --sign - "$APP_DIR"

echo "💿 正在制作 DMG 安装镜像..."
DMG_NAME="MacDV-${VERSION}.dmg"
DMG_PATH="$DIR/build/$DMG_NAME"
STAGING_DIR="/tmp/macdv_dmg_staging"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_DIR" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

# Add background if present
if [ -f "$DIR/Assets/dmg_background.png" ]; then
    mkdir -p "$STAGING_DIR/.background"
    cp "$DIR/Assets/dmg_background.png" "$STAGING_DIR/.background/dmg_background.png"
fi

rm -f "$DMG_PATH"
# Create read-write temporary image
TMP_DMG="/tmp/macdv_tmp.dmg"
rm -f "$TMP_DMG"
hdiutil create -volname "MacDV 安装器" -srcfolder "$STAGING_DIR" -ov -format UDRW -size 100M "$TMP_DMG"

# Mount temporary image to configure Finder window
DEVICE=$(hdiutil attach -readwrite -noverify -noautoopen "$TMP_DMG" | egrep '^/dev/' | sed 1q | awk '{print $1}')
sleep 1

# AppleScript to set Finder layout
osascript << APPLESCRIPT || true
tell application "Finder"
    tell disk "MacDV 安装器"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {400, 200, 1000, 600}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 96
        if exists file ".background:dmg_background.png" then
            set background picture of viewOptions to file ".background:dmg_background.png"
        end if
        set position of item "MacDV.app" of container window to {150, 205}
        set position of item "Applications" of container window to {450, 205}
        close
        open
        update without registering applications
        delay 1
        close
    end tell
end tell
APPLESCRIPT

sync
hdiutil detach "$DEVICE" || hdiutil detach "$DEVICE" -force
sleep 1

# Convert to compressed read-only DMG
hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH"
rm -f "$TMP_DMG"
rm -rf "$STAGING_DIR"

echo "📦 正在制作 PKG 系统安装包..."
PKG_NAME="MacDV-${VERSION}.pkg"
PKG_PATH="$DIR/build/$PKG_NAME"
rm -f "$PKG_PATH"
pkgbuild --component "$APP_DIR" --install-location "/Applications" "$PKG_PATH"

echo "🚚 正在将安装包复制到桌面与下载文件夹..."
cp "$DMG_PATH" "/Users/chenweijie/Downloads/$DMG_NAME"
cp "$DMG_PATH" "/Users/chenweijie/Desktop/$DMG_NAME"
cp "$PKG_PATH" "/Users/chenweijie/Downloads/$PKG_NAME"
cp "$PKG_PATH" "/Users/chenweijie/Desktop/$PKG_NAME"

echo "🎉 打包完成！"
echo "DMG 安装包: $DMG_PATH"
echo "PKG 安装包: $PKG_PATH"
echo "已复制至桌面: /Users/chenweijie/Desktop/$DMG_NAME"
echo "已复制至下载: /Users/chenweijie/Downloads/$DMG_NAME"
