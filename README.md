# MacDV 🎵 — 专为 macOS 打造的高清原生横屏抖音客户端

<p align="center">
  <img src="Assets/AppIcon.icns" width="128" height="128" alt="MacDV Icon" />
</p>

<p align="center">
  <strong>基于 Swift 6 + SwiftUI + AVPlayer + WebKit 动态引擎构建的纯原生 macOS 抖音客户端</strong><br>
  横屏大屏精选 · 4K/1080P 最高画质 · 播放防休眠 · 全屏纯净模式 · 键盘快进快退 · 极简丝滑
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-macOS%2013.0+-blue?logo=apple" alt="macOS" />
  <img src="https://img.shields.io/badge/Language-Swift%206.0-orange?logo=swift" alt="Swift 6" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## 💖 致谢与鸣谢 (Acknowledgements)

> [!NOTE]
> 本项目的很多核心产品逻辑、横屏精选通道策略、高画质码率解析算法以及交互设计**深度借鉴了知名的开源项目 [MYDV](https://github.com/chenweijie-git/MYDV)**（Android TV 端优秀的抖音客户端）。
> 
> 非常感谢 **MYDV** 作者及开源社区先驱探索出的宝贵经验！**MacDV** 致力于将这一份沉浸、极致、纯粹的大屏观影体验带给 macOS 桌面平台的用户。

---

## ✨ 核心亮点

### 📺 1. 横屏精选视频流优先
- 深度锁定官方横屏精选推荐通道，内置宽高比智能过滤与识别；
- 专为 Mac 视网膜屏幕与外接宽屏显示器打造，告别竖屏黑边，大幅提升观影沉浸感。

### 🚀 2. 始终最高清晰度优先 (1080P/超清/60fps)
- 自动解析每个作品的所有清晰度与比特率码率流，优先选用最高清晰度；
- 支持 1080P、2K、4K、60fps 高帧率流无缝硬件解码播放。

### 💡 3. 长视频播放防屏幕休眠
- 底层无缝集成 macOS 原生电源管理断言（`IOKit.pwr_mgt`）；
- 视频播放时自动阻止 Mac 屏幕变暗、灰屏或进入休眠；暂停播放后立即智能释放，节能安全。

### ⏩ 4. 键盘左右方向键快进与快退
- **`→` 右方向键**：快速前进（默认 10 秒）；
- **`←` 左方向键**：快速后退（默认 10 秒）；
- **支持连续按键累加**：快速敲击 3 次即快进 30 秒，无需反复缓冲；
- **原生全屏毛玻璃 HUD 指示器**：屏幕中央实时浮现快进秒数、当前时间进度与 mini 进度条；
- **步长秒数可自由定制**：在设置中提供 5秒、10秒、15秒、30秒预设及 1~180 秒自定义调节。

### 🪟 5. 全屏纯净观影模式（快捷键 `H`）
- 一键隐藏画面上的所有操作按钮、作者信息、标题和进度条，全屏幕仅保留纯净视频画面；
- **智能联动恢复**：进入全屏可自动进入纯净模式，退出全屏时按键与控件自动恢复，体验优雅。

### 🖱️ 6. 触控板单次滑动精准防连跳
- 针对 Mac 触控板惯性动量（Inertia Phase）深度优化，每次物理轻扫手势仅切换单个视频，彻底杜绝一次划过多个视频的失控现象。

### 🛡️ 7. 第三方弹窗彻底免疫
- 内置 DOM 拦截、WebKit URL Scheme 过滤以及 LaunchServices 静默处理，彻底阻断类似 `bitbrowser://` 等烦人的系统弹窗。

### 🐟 8. 摸鱼与日常使用优化
- **窗口置顶 (快捷键 `T`)**：小窗浮动，始终保持在其他窗口之上；
- **透明度无极调节**：支持 25%~100% 窗口透明度调节；
- **一键快捷静音 (快捷键 `M`)**；
- **原生评论抽屉 (快捷键 `C`)**：右侧平滑滑出热门评论列表。

---

## ⌨️ 键盘快捷键一览

| 快捷键 | 功能说明 |
| :--- | :--- |
| **`→` (右箭头)** | 视频**快进**（默认 10 秒，可在设置中调节） |
| **`←` (左箭头)** | 视频**后退**（默认 10 秒，可在设置中调节） |
| **`Space` (空格)** | **暂停 / 继续播放** |
| **`↓` / `J`** | 切换到**下一个视频** |
| **`↑` / `K`** | 切换到**上一个视频** |
| **`H`** | **纯净模式切换**（一键隐藏/恢复全部界面按钮） |
| **`S`** | 切换画面**铺满窗口 / 原始比例** |
| **`F`** / **双击画面** | 进入 / 退出**全屏模式** |
| **`M`** | 快速**静音 / 开启声音** |
| **`C`** | 打开 / 关闭**原生评论抽屉** |
| **`R`** 或 **`⌘ + R`** | **刷新**当前视频推荐流 |
| **`T`** | 切换**窗口置顶 (Always on Top)** |
| **触控板双指滑动** | 阻尼翻页切换视频（精准防连跳） |

---

## 📦 安装与编译

### 直接下载安装
项目已自动生成 macOS 原生安装镜像，可直接使用：
- **DMG 镜像**：打开 `MacDV-1.0.0.dmg`，将 `MacDV` 图标拖拽至 `Applications` 即可。
- **PKG 安装包**：双击 `MacDV-1.0.0.pkg`，跟随系统向导一键安装。

### 从源码编译
要求：macOS 13.0+，Xcode 15+ 或 Swift 6.0 工具链。

```bash
# 克隆仓库
git clone https://github.com/<your-username>/MacDV.git
cd MacDV

# 编译 Release 模式并打包 .app
./build_app.sh

# 打包 DMG 与 PKG 安装镜像
./package_app.sh
```

---

## 📁 项目工程架构

```
MacDV/
├── Package.swift                     # Swift Package 依赖与构建配置
├── build_app.sh                      # 一键编译与本地签名脚本
├── package_app.sh                    # 一键打包 DMG 与 PKG 安装包脚本
├── Assets/
│   ├── AppIcon.icns                  # macOS 原生 Squircle 应用图标
│   └── dmg_background.png            # DMG 安装界面背景图
└── Sources/MacDV/
    ├── App.swift                     # 应用入口、系统菜单与全局快捷键映射
    ├── Models/
    │   └── DouyinModels.swift        # 抖音 REST API 数据模型与最高画质解析
    ├── Engine/
    │   ├── DouyinEngine.swift        # WebKit 动态反爬引擎、Cookie与网络请求
    │   └── SleepPreventer.swift      # IOKit 原生电源管理防休眠控制器
    └── Views/
        ├── MainView.swift            # 播放容器、手势调度、HUD 与快捷键监听
        ├── VideoPlayerView.swift     # AVPlayer 原生视频播放层 (Metal 硬件解码)
        ├── VideoActionOverlay.swift  # 交互浮层 (作者、标题、点赞、评论、全屏)
        ├── CommentSheetView.swift    # 原生半透明侧边评论抽屉
        ├── LoginSheetView.swift      # 扫码登录与 Cookie 同步面板
        └── SettingsView.swift        # 偏好设置、快进秒数微调与透明度滑块
```

---

## ⚠️ 免责声明 (Disclaimer)

1. 本项目仅供技术交流与个人学习使用，不包含任何商业目的或盈利行为。
2. 视频资源与接口版权归属字节跳动（ByteDance / 抖音）所有。
3. 请遵守相关法律法规与平台服务条款。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
