# LiveLyric 交接说明

用于在豆包新项目中继续开发 LiveLyric 时快速建立上下文。VJ-Studio 属于另一个项目，不在本仓库范围内。

## 一句话定位

舞台实时歌词提词器：控制台负责取词、对时、微调；输出层独立投屏。主程序是单文件 HTML，配套一个零依赖 Node 本地服务。

## 位置

| 项 | 值 |
|---|---|
| 本地目录 | `E:\AI\豆包\vj\LiveLyric` |
| GitHub | https://github.com/glaypan/LiveLyric （公开） |
| 当前版本 | v1.4.10 |
| 最新 Release | https://github.com/glaypan/LiveLyric/releases/tag/v1.4.10 |
| 分支 | `main`，交接时 HEAD 为 `2a20864` |

## 目录结构

| 路径 | 作用 |
|---|---|
| `LiveLyric.html` | 构建产物，156,069 B，不要手改 |
| `src/_p1_head.html` | HTML 头、设计 token、基础布局 |
| `src/_p2_css2.css` | 字幕样式、动画、11 套视觉风格 |
| `src/_p3_console_a.html` | 控制台界面上半 |
| `src/_p4_console_b.html` | 控制台界面下半 |
| `src/_p5_output.html` | 输出层结构 |
| `src/_p6_js_core.js` | 状态、持久化、歌词解析 |
| `src/_p7_js_clock.js` | 时钟、偏移、时间码换算 |
| `src/_p8_js_out.js` | 投屏渲染、样式应用 |
| `src/_p9_js_console.js` | 控制台交互、网络取词 |
| `tests/_test_*.js` | 回归测试，`node tests/_test_clock.js` 直接跑 |
| `tools/build.ps1` | 重拼构建脚本 |
| `debug-LiveLyric.bat` | 独立调试入口（独立 Edge profile、端口 17321） |
| `LiveLyricServer.js` | 本地服务：托管页面 + 歌词代理（零依赖） |

## 构建

```powershell
cd "E:\AI\豆包\vj\LiveLyric"
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

脚本按九个片段的固定顺序拼接，以 UTF-8 无 BOM 写回 `LiveLyric.html`，并打印字节数。改代码只改 `src/`，直接改产物会在下次构建时被覆盖。

已验证：用该脚本重建的产物与原文件 SHA256 完全一致（`042B1E40…693830`）。

## 运行与调试

```powershell
# 一键（会复用已在运行的实例）
debug-LiveLyric.bat

# 手动
node LiveLyricServer.js --port 17321 --no-open
```

- 端口可用 `--port` 或环境变量 `PORT` 改，默认 17321。
- 控制台地址 `http://127.0.0.1:17321/`，输出层加 `?mode=output`。
- 控制台和输出层必须在同一浏览器配置内，跨窗口同步依赖 `BroadcastChannel('livelyric')` 与 `localStorage` 轮询。
- `/health` 返回 `{"ok":1,"app":"livelyric","port":17321}`。

## 状态存储

| 键 | 内容 |
|---|---|
| `livelyric.state.v1` | `{S, LINES, META, savedAt}`，含歌词、偏移、样式、歌单 |
| `livelyric.cache.v1` | 联网取词缓存，有容量上限并做淘汰 |
| `livelyric.bus.v1.*` | 跨窗口总线消息的兜底副本 |

不同端口是不同 origin，存储与总线天然隔离。

## 已修复并验证的问题

- **offset 三个入口全部无效**（v1.4.9）：`Clock.nowSong()` 在内部音频源下没读 `S.offset`。现拆成 `songRaw()`（真实位置，供 HUD）与 `nowSong()`（歌词位置，含偏移）。
- **竖排叠加渐隐方向错**（v1.4.10）：`fade-mask` 固定 `to bottom`，竖排是横向列，首末列被硬裁。已加 `.frame.fade-mask.s-vertical .lyrwrap` 覆盖为 `to right`。

## 当前能力

- 11 种字幕样式：classic / karaoke / glow / bounce / vertical / minimal / type / neon / duo / marquee / persp
- 4 组组合预设：夜场霓虹、念白打字、发布会渐变、国风竖排
- 时间轴与时间码双模式可选；时间码歌词可导入并嵌时间码
- 播放条常驻全局微调：offset 滑块、±100、本首偏移
- 本地服务代理网易云 / QQ 取词，规避同源与防盗链

## 已知边界

- 竖排样式下拉丁字母按 CJK 规则逐字成列，属排版固有表现。
- 网易云匿名态逐字（`yrc`）基本拿不到，逐字需用 QQ 源。
- 输出层全屏依赖浏览器 `requestFullscreen`，需要一次用户手势。
- 缓存只存本机浏览器，换机器需重新取词。

## 新项目第一条消息（可直接粘贴）

> 接手 LiveLyric 项目。本地目录 `E:\AI\豆包\vj\LiveLyric`，仓库 https://github.com/glaypan/LiveLyric，当前 v1.4.10。先读 `README.md` 和 `HANDOFF.md`。源码只改 `src/_p1…_p9`，改完跑 `tools\build.ps1` 重拼 `LiveLyric.html`。不要动 VJ-Studio 的任何文件。
