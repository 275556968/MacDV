@echo off
chcp 65001 >nul
echo 正在编译与打包 WinDV Windows 客户端...
call npm run dist
echo 打包完成！输出文件位于 dist\ 目录：
dir dist\*.exe
pause
