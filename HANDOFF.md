# LiveLyric 交接说明

用于在新项目里继续开发 LiveLyric 时快速建立上下文。**VJ-Studio 属于另一个项目，不在本仓库范围内，任何情况下都不要改它的文件。**

## 一句话定位

舞台实时歌词提词器：控制台负责取词、对时、微调；输出层独立窗口投屏。主程序是单文件 HTML（控制台与输出层同一份代码，靠 `?mode=output` 分身），配套一个零依赖 Node 本地服务（托管页面 + 歌词代理）。时间模型为 `歌曲秒 = 时间码秒 − anchor + offset`，由 LTC / MTC / WebSocket 外部时间码驱动，失锁时按最后一帧自由续走并标红告警。

## 位置

| 项 | 值 |
|---|---|
| 本地目录 | `E:\AI\豆包\vj\LiveLyric` |
| GitHub | https://github.com/glaypan/LiveLyric （公开） |
| 当前版本 | v1.4.12（新增日/夜界面主题与投屏全屏设置；工作区改动未提交） |
| 最新 Release | https://github.com/glaypan/LiveLyric/releases/tag/v1.4.11 （v1.4.12 尚未打包） |
| 分支 | `main`，最新发布 tag `v1.4.11`（`e3b3550`）；历史提交 `8456683`（首版交接说明）、`2a20864`（调试入口）、`7ffb65f`（v1.4.10） |
| 工作区状态 | v1.4.12 已提交到本地 `main`，**未推送、未打 tag、未出 ZIP**（以 `git status` 为准） |

## 目录结构

| 路径 | 作用 |
|---|---|
| `LiveLyric.html` | **构建产物**，177,862 B（SHA256 `1EF83B9A…42C5`），不要手改（下次构建会覆盖） |
| `src/_p1_head.html` | HTML 头、设计 token、基础布局 |
| `src/_p2_css2.css` | 字幕样式、动画、11 套视觉风格、渐隐遮罩 |
| `src/_p3_console_a.html` | 控制台界面上半（时间码源、偏移、现场工具） |
| `src/_p4_console_b.html` | 控制台界面下半（样式、歌单、工程） |
| `src/_p5_output.html` | 输出层结构（`lyrwrap` / `lyrstack` / HUD） |
| `src/_p6_js_core.js` | 状态、localStorage 持久化、歌词解析（LRC / TTML / SRT / `⌚` 歌词库） |
| `src/_p7_js_clock.js` | 时钟、`songRaw` / `songShift` / `nowSong`、时间码换算、歌单定位 |
| `src/_p8_js_out.js` | 投屏渲染、样式应用、渐隐/镜面/描边 |
| `src/_p9_js_console.js` | 控制台交互、面板轮询、在线取词、LTC 解码与发生器 |
| `tests/_test_*.js` | 5 个回归测试，`node tests\_test_clock.js` 直接跑，无第三方依赖 |
| `tools/build.ps1` | 重拼构建脚本（九个片段按固定顺序拼接） |
| `LiveLyricServer.js` | 本地服务：托管页面 + 网易云/QQ 歌词代理 + LTC WAV 生成（零依赖，无需 npm） |
| `启动 LiveLyric.bat` | 一键启动（起服务并开默认浏览器） |
| `debug-LiveLyric.bat` | 独立调试入口：独立 Edge profile（`%LOCALAPPDATA%\LiveLyricDebug\profile`）+ 端口 17321，脚本会先 `netstat` 检查，已在跑就只开窗口 |
| `README.md` | 面向使用者的完整说明书 |
| `CHANGELOG.md` | 逐版根因记录（v1.4.9 / v1.4.10 有详细实测数据） |
| `LiveLyric-v1.x.x.zip` | 历史发行包，不入库（`.gitignore` 已排除） |

根目录下的 `_p1…_p9`、`_test_*.js` 是早期工作残留副本，已被 `.gitignore` 排除，**以 `src/` 与 `tests/` 为准**，不要改副本。

## 构建命令

```powershell
cd "E:\AI\豆包\vj\LiveLyric"
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

- 只改 `src/_p1…_p9`，改完必须跑构建重拼 `LiveLyric.html`；直接改产物会在下次构建被覆盖。
- 拼接用 `\n` 连接，以 **UTF-8 无 BOM** 写回，打印产物字节数。当前产物 177,862 B。
- 已验证：v1.4.12 产物为 `1EF83B9A54C8B830503A3EF211AF958C751E7D0E03695BC05FC53EB0EBA742C5`；v1.4.11 发布产物为 `458CF0CCC5C7947838DBA7930225B21D2645D948EA4BBC3CD882B0E99D406552`；v1.4.10 产物为 `042B1E40…693830`（同一份 `src/` 仅版本号不同时，可据此判断是否被误改）。
- 也可用 pwsh 7 跑：`pwsh -ExecutionPolicy Bypass -File tools\build.ps1`。
- **注意（本次修）**：`tools/build.ps1` 内含中文注释，原先是无 BOM 的 UTF-8，被 Windows PowerShell 5.1 按 ANSI 解码后引号被吞，报 `Missing closing ')'` 直接构建失败。已改为 UTF-8 **带 BOM**，5.1 与 pwsh 7 均能正常执行，产物字节与哈希不变。以后编辑此脚本请保留 BOM。
- `build.ps1` 支持 `-OutFile` 参数输出到别处（默认仓库根的 `LiveLyric.html`）。

## 端口与启动

| 项 | 值 |
|---|---|
| 默认端口 | **17321**（刻意避开 3000，后者是 Node/Vite/Next 默认端口，撞了会「页面能开、取词全失败」） |
| 改端口 | `node LiveLyricServer.js --port 端口`，或环境变量 `PORT` |
| 绑定地址 | `127.0.0.1`（仅本机，不对外暴露） |
| 控制台地址 | `http://127.0.0.1:17321/` |
| 输出层地址 | 同址加 `?mode=output`（点顶栏「输出窗口」即自动开）；加 `&fs=1` 直接请求全屏 |
| 自检地址 | 加 `?debug=1`，1.2 s 后把自检 JSON 写进页面标题 |
| 健康检查 | `GET /health` → `{"ok":1,"app":"livelyric","port":17321}`（已在 17399 实测返回 200） |

启动方式：

```powershell
# 一键（起服务 + 自动开浏览器）
.\启动 LiveLyric.bat

# 调试（独立 Edge profile，复用已在跑的 17321 实例）
debug-LiveLyric.bat

# 手动（不开浏览器）
node LiveLyricServer.js --port 17321 --no-open
```

- 首次使用只需 Node.js LTS，**不需要 npm install 任何依赖**。
- 服务只做三件事：托管 `LiveLyric.html`、代理 `/lyric`（补 Referer 与 CORS 头）、生成 `/ltc` WAV。页面与接口同源，所以在线取词不用填代理地址。
- 其它接口：`GET /lyric?kw=歌名&src=qq|netease`、`GET /lyric?id=ID&src=qq|netease`、`GET /ltc?start=HH:MM:SS:FF&dur=秒&fps=24|25|30&sr=48000&lvl=0..1`（`dur` 上限 600 s）。
- 控制台与输出层必须**同一个源**：都走 `http://127.0.0.1:17321`，或都用 `file://` 双击打开，混用会两边不同步（BroadcastChannel 与 localStorage 都按 origin 隔离）。用 `file://` 时在线取词要在弹窗里另填代理地址。
- 跨窗口同步依赖 `BroadcastChannel('livelyric')` + localStorage 兜底 + 160 ms 总线轮询。

## 三个 localStorage 键

| 键 | 内容 | 说明 |
|---|---|---|
| `livelyric.state.v1` | `{S, LINES, META, savedAt}` | 页面全量状态：当前歌词、样式、字号、offset、anchor、歌单（含每首歌词快照）、每首偏移等。读档时会修正超范围的 offset |
| `livelyric.cache.v1` | `{歌名: {lrc, title, word, src, ts}}` | 联网取词缓存，含完整 LRC 原文，**上限 24 首**，按最近使用淘汰；断网或服务没起时回退到这里 |
| `livelyric.bus.v1.*` | 各频道最后一条消息副本 | 跨窗口总线的兜底副本，key 后缀是频道名；用于 BroadcastChannel 不可用或晚开窗口补齐状态 |

存储跟着 origin 走：换端口 = 换源，旧端口的存档和缓存不会自动带过来，换之前先在右栏「导出工程」，新端口「导入」。每首偏移也按曲名存在同一份 state 里。

## 已修复并验证的两个缺陷

### 1. offset 的三个入口全部无效（v1.4.9）

**现象**：现场载入音频自己播时，全局 offset 滑块、±100 ms 按钮、播放条那组微调全都没反应。

**根因**：`Clock.nowSong()` 在内部音频源下只有 `return this.audio.currentTime || 0`，**完全没读 `S.offset`，也没读本首偏移**。而歌词索引、投屏渲染、控制台高亮全走这个函数 —— 三个入口都在改一个没人读的数。外部时间码源（LTC/MTC/WS）在 `feed()` 里早已算过 offset，所以只有「载入音频自己播」这条最常用的路径是死的。

**修法（`src/_p7_js_clock.js`）**：把「原始位置」与「歌词位置」拆开。

| 函数 | 返回 | 使用者 |
|---|---|---|
| `songRaw()` | 音频真实位置 / 外部码推算位置，**不含偏移** | HUD 时间码、`posVal` 读数、`nowTc()`、进度基准 |
| `nowSong()` | 内部源 = `songRaw() + songShift()`；外部源 = `songRaw()`（`extSong` 已带过 offset，不双算） | 歌词索引、投屏当前行、控制台高亮 |
| `songShift()` | `(S.offset + 本首偏移)/1000` | `seek` 时补偿，避免对齐后整体偏走 |

连带修掉：内部源「对齐当前行」不再无差别改全局 offset，改为 `seekInternal(行首 − songShift())`；`seekSong` / `alignTo` 的 seek 目标同样减 `songShift()`。

**验证**：`node tests\_test_clock.js` → `{"A":true,"B":true,"C":true,"D":true} PASS`，其中 D 是 v1.4.9 回归用例：`offset +2500 ms` 时 `songRaw=12.30`、`nowSong=14.80`。另有 `node tests\_test_rawsong.js` 校验内部源不扣本首偏移、外部源要扣。

### 2. 竖排叠加渐隐方向错误（v1.4.10）

**现象**：国风竖排 + 边缘渐隐时，两端该淡出的地方没淡出，反而像被裁了一刀。

**根因**：`fade-mask` 的遮罩方向写死 `to bottom`。横排文字上下滚这是对的；但 `s-vertical` 是 `writing-mode:vertical-rl`，文字变成一列列**横向**铺开，上下方向的遮罩在这个维度上等于没做，左右两端仍是硬边。

**修法（`src/_p2_css2.css`）**：新增专用规则

```css
.frame.fade-mask.s-vertical .lyrwrap{
  -webkit-mask-image:linear-gradient(to right,rgba(0,0,0,0) 0%,#000 12%,#000 88%,rgba(0,0,0,0) 100%);
  mask-image:linear-gradient(to right,rgba(0,0,0,0) 0%,#000 12%,#000 88%,rgba(0,0,0,0) 100%);
}
```

横排仍是 `to bottom`（11%/89%），竖排走 `to right`（12%/88%），互不影响。

**验证**：竖排样式下 computed `mask-image` 为 `linear-gradient(to right, …)`；横排仍为 `to bottom`。构建产物 `LiveLyric.html` 第 200 行已含 `.frame.fade-mask.s-vertical .lyrwrap` 规则（`-webkit-mask-image` 与 `mask-image` 两条声明），说明产物与 `src/` 已同步。

## v1.4.12 新增：界面主题与投屏全屏

### 1. 日版 / 夜版 / 自动（只影响控制台）

- 机制：颜色做成语义令牌，`body.th-day` 只覆盖令牌值（`--bg` / `--panel` / `--surface` / `--field` / `--text` / `--dim` / `--mute` / `--acc` / `--line` / `--card-shadow` / `--st-ok` / `--st-warn` / `--st-idle` …），组件规则一条不动。令牌定义在 `src/_p1_head.html` 顶部，`:root` 是夜版，`body.th-day` 是日版。
- 实现位置：`src/_p9_js_console.js` 的 `themeNow()` / `applyTheme()` / `setTheme()`（插在 `ConsoleApp` 之前）。
- 状态：`S.uiTheme` = `'night' | 'day' | 'auto'`，默认 `'night'`，随 `livelyric.state.v1` 持久化；`'auto'` 走 `prefers-color-scheme`。
- **输出窗口绝不加 `th-day`**：`applyTheme()` 首行 `if (IS_OUT) return`。投屏画面永远深色，控制台切日版不影响台上。
- UI 入口：右栏「界面」卡片，`#themeSeg [data-theme=day|night|auto]`，当前档位显示在 `#uiThemeTag`。
- 曾经踩的坑：`.go` 播放键沿用 `#CFFFF7` 硬编码，白底几乎不可见 → 改 `--go-ink` / `--go-run-ink`；在线取词弹窗的服务状态是三处 JS 硬编码色（`#3ddc97` / `#ffb84d` / `#8b96a8`），浅底不可读 → 改 `var(--st-ok|warn|idle)`。**以后加界面文字颜色一律走令牌**，否则日版会漏。

### 2. 投屏 / 全屏设置（副屏定位 + 三种全屏方式）

- 真因：`requestFullscreen()` 需要**调用方文档内**的用户手势。原实现是控制台按钮去调输出窗的 `requestFullscreen`，跨窗口一律被拒。这解释了 macOS 上"能投屏、不能全屏"，与设备/权限无关。
- 输出层自身入口：`#btnOutFs`（⛶，`src/_p5_output.html`）+ `F` 键；`src/_p8_js_out.js` 的 `FS` / `OutApp.enterFullscreen()` / `showFsHint()`，标准与 `webkit` 前缀链式尝试，失败退化为 `resizeTo/moveTo` 的「窗口铺满」并 toast 指引 `⌃⌘F`（macOS）/ `F11`。
- 跨窗口能力显式挂载：`window.LyricOut = {fullscreen, fill, isFullscreen, showHint}`。顶层 `const` 不进入 `window`，跨窗口必须显式挂。
- 控制台卡片（`src/_p4_console_b.html` + `src/_p9_js_console.js` 的 `Cast` 模块：`init/screens/scan/renderSelect/syncUI/targetRect/open/apply/monitor`）：
  - 目标屏幕：`getScreenDetails()`（Window Management API，Chrome/Edge 支持）；Safari 无此 API → 退化手动坐标。
  - 全屏方式：自动 / 原生全屏 / 窗口铺满。
  - 手动坐标：可为负（副屏在左填 `-1920`）；单屏机器上 OS 会把负坐标夹回 0，属系统限制。
  - 「打开并投屏」→ 带 `cast=1` 开窗定位；**铺满由输出窗口自己执行**（`src/_p9_js_console.js` 的 `IS_OUT` 初始化分支读 `QS.get('cast')`；跨窗口替它调 `resizeTo` 会被浏览器时好时坏地忽略，实测出现过窗口已就位但 `fs-fill` 未设上的情况）。
  - 顶栏「输出全屏」→ 发 `fsreq` 总线消息，由输出窗口在 `OutApp.onBus` 里执行 `enterFullscreen('auto')`；输出窗未开才走 `cast=1` 开窗路径。
- 状态：`S.cast = {screen, mode, manual, manualX, manualY, autoOpen}`；`loadState` 用 `DEF_STATE.cast` 浅合并，老存档缺字段也不会炸。
- 曾经踩的坑：`#btnOutFs` 首版是 `opacity:0; pointer-events:none`，只在 hover 时 `.show`，真实点击被 `<div id="stage"> intercepts pointer events` 拦下（等于看不见也点不着）。现为常驻可点、`opacity:.22`，hover/`.show` 提亮，`z-index:6`，原生全屏后 `body.fs-on` 隐藏。
- `Cast.scan()` 在授权弹窗挂起时会无限等待 → 已加 8 s 超时竞赛 + 「检测中…」按钮禁用反馈。

## 当前能力速览

- 11 种字幕样式：classic / karaoke / glow / bounce / vertical / minimal / type / neon / duo / marquee / persp；4 组组合预设。
- 时间码源：LTC（自带解码器，跨零间隔判位 + bit cell 相位跟踪）、MTC（quarter/full frame）、WS（断线指数退避重连 + 5 s 心跳）。
- 每首独立偏移、歌单连续累计（含每首间隔）、Cue 打点模式、`⌚` 绝对码歌词库导入导出。
- 舞台可读性：字距 / 描边 / 阴影 / 镜面 / 倒计时 / 临时上屏；工程 JSON 导出导入。
- 在线取词代理网易云 / QQ，成功即写缓存，失败回退缓存。
- 界面日版 / 夜版 / 自动（v1.4.12），只切控制台与弹窗，投屏画面不受影响。
- 投屏 / 全屏设置（v1.4.12）：副屏定位（Window Management API 或手动坐标）+ 三种全屏方式 + 失败自动铺满。

## 已知边界

- 浏览器直连网易云 / QQ 官方歌词接口会被同源与防盗链拦，必须走本地服务。
- 网易云同时请求新旧两个接口并按行数择优：新版接口毫秒精度但匿名态正文可能被版权过滤残缺；旧接口百分秒精度、正文完整。
- 网易云匿名态基本拿不到 `yrc` 字级时间，逐字请用 QQ 源。
- 输出层全屏依赖 `requestFullscreen`，且必须是**输出窗口自身**的用户手势；控制台隔着窗口调用会被拒，自动退铺满。macOS 上 `⌃⌘F` 是可靠退路（Safari 桌面版 Fullscreen API 不全）。
- 副屏枚举依赖 Window Management API：Chrome / Edge 可用，Safari 不可用，只能手动填坐标；自动化环境里授权弹窗会挂起，靠 8 s 超时兜底。
- 单屏机器上 `moveTo` 负坐标会被 OS 夹到 0；真实双屏/异 DPI 下的落位未在真机实测。
- 竖排样式下拉丁字母按 CJK 竖排规则逐字成列，属该排版固有表现，不做拉丁特例。
- 缓存与状态只存本机浏览器、且按 origin 隔离，换机器/清缓存/换端口都要重新取词或导入工程。
- 面板「写前比对」假设状态字段只由控制台自己写；以后别处改同一行文字要同时清缓存，否则停在旧值。
- LTC 是满幅音频，只能进声卡输入，绝不能送扬声器。
- 时间码断链不会停走：按最后帧自由续走并标红 `RUN · FREE`，这是演出取舍而非缺陷。

## 待办

1. **根目录副本清理**：根目录 `_p*.html/css/js`、`_test_*.js` 是历史残留（`.gitignore` 已排除）。测试已全部改为读 `src/`，但副本仍留在磁盘上，容易误改。建议删除，或明确标注为「只读快照」。
2. **测试夹具外部依赖**：`tests/_test_parse_tc.js` 仍读 `E:\BaiduNetdiskDownload\金老斯手搓提词器\4ROCK-歌词库(带时间码).json`，换机必挂。应裁一份小样本放进 `tests/fixtures/`，测试内改读相对路径。
3. **测试退出码**：`_test_slot` / `_test_embed` / `_test_parse_tc` / `_test_rawsong` 只打印结果，不设 `process.exitCode`，无法用于自动检查。建议统一 `RESULT … PASS/FAIL` 并在失败时非零退出。
4. **版本与发行**：v1.4.12 的功能已构建（`177,040 B`）但**未提交、未打 tag、未出 ZIP**。发布时按旧流程：改 `APP_VER` 与 `<title>`（本轮已改）、更新 README/CHANGELOG、跑构建、出 5 文件 ZIP、commit + tag + `gh release create`。
5. **真机验证缺口**：macOS Safari 的 `webkit` 前缀链与 `⌃⌘F` 指引、真实双屏下的副屏落位、`getScreenDetails` 授权后的多屏枚举，均只在本机 Windows + Playwright 单屏环境验证过；上台前建议在目标 Mac + 投影上走一遍「打开并投屏」。
6. **网易云逐字**：匿名态拿不到 `yrc`。若真需要网易云字级时间，得带登录 cookie 走 eapi（服务端已留有 EAPI 签名路径，尚未接登录态）。
7. **跨 origin 迁移**：换端口/换机器没有自动搬迁提示，只能靠「导出工程 → 导入」。可在启动时检测「本 origin 无 state 但同机其它端口有缓存」并提示。
8. **VJ-Studio 交叉核对**：v1.4.10 的 CHANGELOG 提到与 VJ-Studio v3.11.1 做过双软件对照，结论散落在当次对话里，没有形成文档。补一份对照结论到 README 或 `docs/`（**只写文档，不碰 VJ-Studio 的代码**）。
9. **后台续航与多屏**：已有 rAF 节流兜底（>200 ms 由定时器以 100 ms 接管），但多显示器热插拔、输出窗口被拖动到不同 DPI 屏时的字号重算尚未实测覆盖。

## 接手须知（约束）

- 源码**只改 `src/_p1…_p9`**，改完跑 `tools\build.ps1` 重拼 `LiveLyric.html`，并核对字节数与哈希。
- **不要动 VJ-Studio 的任何文件**（含其仓库、配置、运行时目录）。
- 不要直接改 `LiveLyric.html`、不要改根目录副本。
- 改完至少跑一遍 `tests\` 下的 5 个脚本，全部应输出 PASS / 期望值。
- 提交前看一眼 `git status`，发行包 zip 不入库。

## 新项目第一条消息（可直接粘贴）

> 接手 LiveLyric 项目。本地目录 `E:\AI\豆包\vj\LiveLyric`，仓库 https://github.com/glaypan/LiveLyric，当前 v1.4.12。先读 `README.md` 和 `HANDOFF.md`。源码只改 `src/_p1…_p9`，改完跑 `tools\build.ps1` 重拼 `LiveLyric.html`。不要动 VJ-Studio 的任何文件。
