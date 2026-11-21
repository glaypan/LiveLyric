# LiveLyric v1.4.11

舞台实时歌词提词器：控制台 + 独立输出层，单文件 HTML，零依赖本地服务。

本次为工程侧补丁，**界面与运行行为无变化**，产物字节数不变。

## 本版修复

- **构建脚本在 Windows PowerShell 5.1 下无法执行**：`tools/build.ps1` 为无 BOM 的 UTF-8 且含中文注释，5.1 按 ANSI 解码后引号被吞，报 `Missing closing ')'`。已补 UTF-8 BOM，5.1 与 pwsh 7 均可构建，产物逐字节一致。
- **时钟回归测试自 v1.4.9 起失效**：`_test_clock.js` 抛 `this.songRaw is not a function`。已改为同时装载 `songRaw` / `songShift` / `nowSong`，并补 offset 回归用例；5 个测试同步改为读 `src/`，不再读根目录的历史副本。

## 校验

- 全部 5 个回归测试通过。
- `LiveLyric.html` 156,069 B，SHA256 `458CF0CCC5C7947838DBA7930225B21D2645D948EA4BBC3CD882B0E99D406552`。
- `/health` 实测 `{"ok":1,"app":"livelyric","port":17399}`。

## 下载

`LiveLyric-v1.4.11.zip`（5 个文件）：

- `LiveLyric.html` — 主程序，控制台 + 输出层
- `LiveLyricServer.js` — 本地服务，托管页面并代理歌词接口
- `启动 LiveLyric.bat` — Windows 一键启动
- `README.md` — 完整说明书
- `CHANGELOG.md` — 更新日志

## 运行

解压后双击 `启动 LiveLyric.bat`，默认端口 `17321`。

## 源码

主程序由 `src/` 下九个片段构建，构建脚本 `tools/build.ps1`，用法见 README 第十一节。
