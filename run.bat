@echo off
chcp 65001 >nul
echo 正在启动 WinDV (Windows 原生横屏抖音客户端)...
if exist "dist\win-unpacked\WinDV.exe" (
    start "" "dist\win-unpacked\WinDV.exe"
) else if exist "dist\WinDV-1.0.0-Portable.exe" (
    start "" "dist\WinDV-1.0.0-Portable.exe"
) else (
    npm start
)
