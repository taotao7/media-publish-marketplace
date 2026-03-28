# media-publish-marketplace

Claude Code plugin marketplace for media publishing tools — 社交媒体发布工具集。

## Install

```shell
/plugin marketplace add taotao7/media-publish-marketplace
/plugin install xhs-poster@media-publish-marketplace
/plugin install douyin-poster@media-publish-marketplace
```

## Setup

安装后首次使用，运行对应的 setup skill 完成初始化（安装依赖 + 扫码登录）：

```
/xhs-poster:setup-xhs-poster
/douyin-poster:setup-douyin-poster
```

> 依赖会在首次启动 MCP server 时自动安装，setup skill 主要用于引导登录和配置环境变量。

## Plugins

### xhs-poster

小红书 MCP Server — 通过 MCP 协议实现小红书的登录、发布图文笔记、管理笔记。

基于 Puppeteer 浏览器自动化，支持扫码登录、多账号管理、图片上传、话题标签、定时发布、编辑、删除、R2 图床等功能。

**Tools:**

| Tool | Description |
|------|-------------|
| `check_login_status` | 检查 Cookie 是否为有效登录状态 |
| `get_login_qrcode` | 生成登录二维码，等待扫码（最长 4 分钟） |
| `list_accounts` | 列出所有已保存的账号 |
| `list_notes` | 列出笔记（分页） |
| `list_all_notes` | 列出所有笔记（自动翻页） |
| `publish_content` | 发布图文笔记（支持定时、附件） |
| `edit_note` | 编辑已发布笔记 |
| `delete_note` | 删除笔记 |
| `upload_image` | 上传图片到 Cloudflare R2，返回公开 URL |
| `delete_cookies` | 删除已保存 Cookie，重置登录状态 |

**环境变量:**

| Variable | Default | Description |
|----------|---------|-------------|
| `XHS_HEADLESS` | `true` | `false` 可显示浏览器窗口（调试用） |
| `XHS_COOKIES_PATH` | `~/.media-mcp/` | Cookie 存储路径 |
| `R2_ACCOUNT_ID` | — | Cloudflare 账户 ID（可选，R2 图床用） |
| `R2_ACCESS_KEY_ID` | — | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | — | R2 API Token Secret Key |
| `R2_BUCKET_NAME` | — | R2 存储桶名称 |
| `R2_PUBLIC_URL` | — | R2 公开访问域名（如 `https://img.example.com`） |

### douyin-poster

抖音 MCP Server — 通过 MCP 协议实现抖音创作者平台登录、视频发布与图文发布。

基于 Puppeteer 浏览器自动化，支持扫码登录、多账号 Cookie 管理、视频上传、图文发布、标题/简介填写、标签和可见性设置。

**Tools:**

| Tool | Description |
|------|-------------|
| `check_login_status` | 检查 Cookie 是否为有效登录状态 |
| `get_login_qrcode` | 生成登录二维码，等待扫码（最长 4 分钟） |
| `list_accounts` | 列出所有已保存的账号 |
| `publish_video` | 发布视频，支持标题、简介、标签和私密可见 |
| `publish_images` | 发布图文，支持多图、标题、标签和定时发布 |
| `delete_cookies` | 删除已保存 Cookie，重置登录状态 |

**环境变量:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DOUYIN_HEADLESS` | `true` | `false` 可显示浏览器窗口（调试用） |
| `DOUYIN_COOKIES_PATH` | `~/.media-mcp/douyin/` | 抖音账号 Cookie 存储根目录 |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detect | 指定本地 Chrome/Chromium 可执行文件路径 |

## Requirements

- [Bun](https://bun.sh) runtime（依赖会在首次启动时自动安装）

## Adding more plugins

1. Create `plugins/<name>/` with source code
2. Add `plugins/<name>/.claude-plugin/plugin.json`
3. Register in `.claude-plugin/marketplace.json`
