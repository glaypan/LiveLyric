# LiveLyric v1.4.12

**控制台拆出日版 / 夜版两套配色；macOS 上「投屏了但全屏不了」从根上解决。**

产物 `LiveLyric.html`：177,862 B，SHA256 `1EF83B9A54C8B830503A3EF211AF958C751E7D0E03695BC05FC53EB0EBA742C5`。

## 新 1：界面日版 / 夜版 / 自动

白天、户外、亮环境里深色控制台反光看不清，需要一套浅色界面；演出时还是深色顺手。

做法是不给每个组件写第二套规则，把颜色抽成语义令牌（`--bg` / `--panel` / `--surface` / `--field` / `--text` / `--dim` / `--mute` / `--acc` / `--line` / `--card-shadow` / `--st-ok` …），只在 `body.th-day` 里重定义。组件规则一行不改，切主题只是换一组变量。

- 三档：日版 / 夜版 / 自动（跟随系统 `prefers-color-scheme`），入口在右栏「界面」卡片，带当前档位标签。
- 存 `S.uiTheme`，落在 `livelyric.state.v1`，刷新后仍生效。
- **输出窗口永远不加 `th-day`**：`applyTheme()` 里 `if (IS_OUT) return`，投屏画面不会因为控制台切日版而变浅。
- 日版补了两处对比度：`.go` 播放键原写死 `#CFFFF7`，白底几乎不可见 → 改用 `--go-ink` / `--go-run-ink`；在线取词的服务状态原是三处硬编码色（`#3ddc97` / `#ffb84d` / `#8b96a8`，浅底不可读）→ 改 `--st-ok` / `--st-warn` / `--st-idle`，日版落到 `#0B7A66` / `#8A5200` / `#66727F`。

## 新 2：投屏 / 全屏设置（含副屏）

**现象**：Mac 上接投影 / 电视，输出窗口打开后无法全屏，只能是个窗口。

**根因**：`requestFullscreen()` 要求**调用它的那个文档里**有用户手势。原实现是控制台点完去调 `outputWin.document.documentElement.requestFullscreen()` —— 跨窗口调用拿不到激活状态，浏览器一律拒绝；Safari 桌面端还缺部分 Fullscreen API。跟权限、设备都无关。

**修法**：把「全屏」的入口放回输出窗口自己身上，控制台只负责「把窗口送到哪块屏」。

- 输出窗口新增常驻 ⛶ 按钮（`#btnOutFs`）+ `F` 键，在本窗口内发起全屏，标准与 `webkit` 前缀链式尝试；失败立刻退化为「窗口铺满」（按 `screen.availWidth/Height` 做 `resizeTo` + `moveTo`），并提示 macOS 用 `⌃⌘F`、Windows 用 `F11`。
- 控制台新增「投屏 / 全屏」卡片：
  - 目标屏幕：`getScreenDetails()`（Chrome / Edge）列出所有屏，可选自动 / 副屏 / 手动坐标；Safari 无此 API 则退化手动坐标。
  - 全屏方式：自动 / 原生全屏 / 窗口铺满。
  - 手动坐标：允许负数（副屏在主屏左边填 `-1920`）。
  - 「打开并投屏」带 `cast=1` 开窗定位，**铺满由输出窗口自己执行**。
- 顶栏「输出全屏」改为发 `fsreq` 总线指令，由输出窗口在本窗口执行。
- 状态新增 `S.cast = {screen, mode, manual, manualX, manualY, autoOpen}`，`loadState` 用 `DEF_STATE.cast` 浅合并补齐，老存档不会因为缺字段炸掉。

## 修：输出窗口的全屏按钮点不到

首版 ⛶ 按钮为 `opacity:0; pointer-events:none`，只在 hover 时开事件。真实点击被判 `#stage intercepts pointer events`，事件穿透到画面层——现场等于「有个看不见也点不着的按钮」。改为常驻可点、默认 `opacity:.22`，hover / `.show` 提亮，`z-index:6`；原生全屏后 `body.fs-on` 隐藏。

## 修：跨窗口 `resizeTo` 被浏览器时好时坏地忽略

「打开并投屏」原由控制台隔着窗口调 `w.LyricOut.fill()`，实测出现过窗口已就位但 `fs-fill` 没设上的情况。改为开窗带 `cast=1`，由输出层初始化时自己铺满，行为稳定。

## 验证（Playwright，`127.0.0.1:17321`，真实点击）

| 项 | 结果 |
|---|---|
| 日版 | `body=th-day`、`--bg=#EDF1F5`、卡片转白、标签「日版」、弹窗白底深字（状态色 `rgb(11,122,102)`） |
| 夜版 | 回到 `#0A1014`、标签「夜版」；刷新后档位仍保持 |
| 打开并投屏 | `body=is-output fs-fill`、窗口 `0,0 @1920×1040`、提示「已铺满当前屏幕…」 |
| 输出窗 ⛶ | `document.fullscreenElement` 非空、`body=is-output fs-on`、`1907×970`，浏览器边框与按钮全消失 |
| 主题隔离 | 控制台 `th-day` 时输出窗背景仍 `rgb(10,16,20)` |
| 手动坐标 `-1920,0` | `Cast.targetRect()={left:-1920,top:0,…}` 并写入 `S.cast`（单屏机器上 OS 夹回 0，属系统限制） |
| 回归测试 | 5 个脚本全 PASS |

## 未在真机验证

- macOS Safari 的 `webkit` 前缀链与 `⌃⌘F` 指引。
- 真实双屏下的副屏定位、`getScreenDetails` 授权后的多屏枚举（自动化环境里授权弹窗会挂起，已加 8 s 超时兜底）。

## 发行包

`LiveLyric-v1.4.12.zip`：`LiveLyric.html` / `LiveLyricServer.js` / `启动 LiveLyric.bat` / `README.md` / `CHANGELOG.md`。

使用方式不变：双击 `启动 LiveLyric.bat`，浏览器打开 `http://127.0.0.1:17321/`。
