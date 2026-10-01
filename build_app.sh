#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "🔨 正在编译 MacDV Release 模式..."
swift build -c release

APP_DIR="$DIR/build/MacDV.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "📦 正在打包 MacDV.app Bundle..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy binary
cp "$DIR/.build/release/MacDV" "$MACOS_DIR/MacDV"
chmod +x "$MACOS_DIR/MacDV"

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

echo "✅ 打包完成！应用位于: $APP_DIR"
