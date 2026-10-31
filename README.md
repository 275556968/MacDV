# WinDV 🎵 / MacDV — 高清原生横屏抖音客户端 (Windows & macOS)

<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="WinDV / MacDV Icon" />
</p>

<p align="center">
  <strong>专为 Windows 与 macOS 桌面平台打造的高清横屏精选抖音客户端</strong><br>
  横屏精选 · 4K/1080P 最高画质 · 播放防休眠 · 全屏纯净模式 · 键盘快进快退 · 摸鱼置顶透明 · 极简丝滑
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2B%20%7C%20macOS%2013%2B-blue?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/Windows-Electron%2033%20%2B%20Node%2024-brightgreen?logo=electron" alt="Windows" />
  <img src="https://img.shields.io/badge/macOS-Swift%206%20%2B%20AVPlayer-orange?logo=swift" alt="macOS" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## 💖 致谢与鸣谢 (Acknowledgements)

> [!NOTE]
> 本项目的很多核心产品逻辑、横屏精选通道策略、高画质码率解析算法以及交互设计**深度借鉴了知名的开源项目 [MYDV](https://github.com/chenweijie-git/MYDV)**（Android TV 端优秀的抖音客户端）。
> 
> 非常感谢 **MYDV** 作者及开源社区先驱探索出的宝贵经验！本项目致力于将这一份沉浸、极致、纯粹的大屏观影体验带给 Windows 与 macOS 桌面平台的用户。

---

## ✨ 核心亮点

### 📺 1. 横屏精选视频流优先
- 深度锁定官方横屏精选推荐通道（`/jingxuan`）与综合推荐通道，内置宽高比智能识别与过滤；
- 专为 PC 宽屏显示器、高刷电竞屏打造，告别竖屏黑边，大幅提升观影沉浸感。

### 🚀 2. 始终最高清晰度优先 (1080P/超清/4K)
- 自动解析每个作品的所有清晰度与比特率码率流，优先选用最高清晰度；
- 支持 1080P、2K、4K 高清流无缝硬件加速解码播放。

### 💡 3. 长视频播放防屏幕休眠
- 深度集成 Windows 电源管理系统（`PowerSaveBlocker` / `SetThreadExecutionState`）；
- 视频播放时自动阻止 Windows 屏幕熄灭、变暗或进入睡眠；暂停播放后立即智能释放，节能安全。

### ⏩ 4. 键盘左右方向键快进与快退
- **`→` 右方向键**：快速前进（默认 10 秒）；
- **`←` 左方向键**：快速后退（默认 10 秒）；
- **支持连续按键累加**：快速敲击 3 次即快进 30 秒，无需反复缓冲；
- **原生居中毛玻璃 HUD 指示器**：屏幕中央实时浮现快进秒数、当前时间进度与 mini 进度条；
- **步长秒数可自由定制**：在设置中提供 5秒、10秒、15秒、30秒预设及 1~180 秒自定义调节。

### 🪟 5. 全屏纯净观影模式（快捷键 `H`）
- 一键隐藏画面上的所有操作按钮、作者信息、标题和进度条，全屏幕仅保留纯净视频画面；
- **智能联动恢复**：进入全屏可自动进入纯净模式，退出全屏时按键与控件自动恢复，体验优雅。

### 🖱️ 6. 滚轮与触控板精准防连跳
- 针对 Windows 鼠标滚轮与高精度触控板优化阻尼手势，每次物理轻扫手势仅切换单个视频，彻底杜绝一次划过多个视频的失控现象。

### 🛡️ 7. 第三方弹窗彻底免疫
- 内置 DOM 拦截与 URL Scheme 过滤机制，彻底阻断类似 `bitbrowser://` 等烦人的系统弹窗探针。

### 🐟 8. 摸鱼与日常使用优化
- **窗口置顶 (快捷键 `T`)**：小窗浮动，始终保持在其他窗口之上；
- **透明度无极调节**：支持 25%~100% 窗口半透明调节，办公摸鱼神器；
- **一键快捷静音 (快捷键 `M`)**；
- **半透明评论抽屉 (快捷键 `C`)**：右侧平滑滑出热门评论列表；
- **扫码与 Cookie 登录**：支持官方扫码登录与 Cookie 导入，自动同步个性化推荐。

---

## ⌨️ 键盘快捷键一览

| 快捷键 | 功能说明 |
| :--- | :--- |
| **`→` (右方向键)** | 视频**快进**（默认 10 秒，可在设置中调节，支持连续敲击累加） |
| **`←` (左方向键)** | 视频**后退**（默认 10 秒，可在设置中调节，支持连续敲击累加） |
| **`Space` (空格)** | **暂停 / 继续播放** |
| **`↓` / `J`** | 切换到**下一个视频** |
| **`↑` / `K`** | 切换到**上一个视频** |
| **鼠标滚轮 / 触控板滑动** | 阻尼翻页切换视频（单次滑动精准防连跳） |
| **`H`** | **纯净模式切换**（一键隐藏/恢复全部界面按钮） |
| **`S`** | 切换画面**铺满窗口 / 原始比例** |
| **`F`** / **双击画面** | 进入 / 退出**全屏模式** |
| **`M`** | 快速**静音 / 开启声音** |
| **`C`** | 打开 / 关闭**半透明评论抽屉** |
| **`R`** 或 **`Ctrl + R`** | **刷新**当前视频推荐流 |
| **`T`** | 切换**窗口置顶 (Always on Top)** |
| **`Esc`** | 退出全屏 / 关闭弹窗及评论抽屉 |

---

## 📦 Windows 版本安装与运行

### 1. 直接运行绿色免安装版 (Portable)
已自动编译生成单文件免安装绿色版：
- 文件路径：`dist/WinDV-1.0.0-Portable.exe`
- 双击即可直接运行，无需安装，无任何系统残留。

或者直接使用解包目录绿色版：
- 文件路径：`dist/win-unpacked/WinDV.exe`

### 2. 从源码运行与打包

环境要求：Windows 10/11，Node.js 18+ (推荐 Node 20/24)。

```bash
# 1. 安装依赖
npm install

# 2. 本地开发启动运行
npm start

# 3. 运行自动化端到端测试
node scripts/test-app-e2e.js

# 4. 打包 Windows 绿色版与安装包
npm run dist
```

---

## 📁 项目工程架构

```
windy/
├── package.json                      # 项目元信息与依赖配置
├── electron-builder.json             # Windows 打包构建配置文件
├── assets/
│   ├── icon.ico                      # Windows 高清多尺寸应用图标
│   └── icon.png                      # 高清 PNG 图标
├── src/
│   ├── main/
│   │   ├── main.js                   # Windows 主进程：窗口管理、防休眠、IPC通信、防弹窗
│   │   ├── engine.js                 # 抖音动态解析引擎、最高画质筛选、Cookie与评论
│   │   └── sleep-preventer.js        # Windows 电源防休眠管理器
│   ├── preload/
│   │   └── preload.js                # 安全上下文桥接 (ContextBridge)
│   └── renderer/
│       ├── index.html                # 主播放界面结构
│       ├── css/
│       │   ├── style.css             # 全局主题变量与基础样式
│       │   ├── titlebar.css          # Windows 11 Fluent 风格无边框标题栏
│       │   ├── player.css            # 播放器容器、比例适配、交互浮层
│       │   ├── hud.css               # 居中快进快退 HUD、Toast 通知
│       │   ├── comment.css           # 半透明滑动评论抽屉
│       │   └── modal.css             # 扫码登录与偏好设置弹窗
│       └── js/
│           ├── app.js                # 界面主控制器与手势/快捷键调度
│           ├── player.js             # 硬件加速视频播放、音量与步长快进
│           ├── overlay.js            # 作者信息、点赞、分享、清晰度标签
│           ├── comment.js            # 评论获取与时间流渲染
│           ├── settings.js           # 本地偏好设置持久化与应用
│           └── login.js              # 二维码扫码登录与 Cookie 导入
├── scripts/
│   ├── test-engine.js                # 引擎接口自动化测试
│   ├── test-playback.js              # 视频硬件解码与播放测试
│   └── test-app-e2e.js               # 完整端到端流程验证测试
├── dist/
│   ├── WinDV-1.0.0-Portable.exe      # 单文件免安装绿色版
│   └── win-unpacked/WinDV.exe        # 解包目录可执行程序
└── Sources/MacDV/                    # 原 macOS Swift 源码 (保留跨平台双端支持)
```

---

## ⚠️ 免责声明 (Disclaimer)

1. 本项目仅供技术交流与个人学习使用，不包含任何商业目的或盈利行为。
2. 视频资源与接口版权归属字节跳动（ByteDance / 抖音）所有。
3. 请遵守相关法律法规与平台服务条款。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
