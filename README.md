# media-publish-marketplace

Claude Code plugin marketplace for media publishing tools — 社交媒体发布工具集。

## Install

```shell
/plugin marketplace add taotao7/media-publish-marketplace
/plugin install xhs-poster@media-publish-marketplace
/plugin install r2-uploader@media-publish-marketplace
/plugin install douyin-poster@media-publish-marketplace
/plugin install bilibili-poster@media-publish-marketplace
```

## Setup

安装后首次使用，运行对应的 setup skill 完成初始化（安装依赖，并按插件完成登录或环境变量配置）：

```
/xhs-poster:setup-xhs-poster
/r2-uploader:setup-r2-uploader
/douyin-poster:setup-douyin-poster
```

> 依赖会在首次启动 MCP server 时自动安装，setup skill 主要用于引导登录和配置环境变量。

`bilibili-poster` 目前走 B 站开放平台 OAuth 与官方投稿接口，不依赖浏览器自动化，因此没有单独 setup skill。使用前需要先在 B 站开放平台申请应用，并配置环境变量后通过 `get_auth_url` / `exchange_code` 完成授权。

## Plugins

### xhs-poster

小红书 MCP Server — 通过 MCP 协议实现小红书的登录、发布图文笔记、管理笔记。

基于 Puppeteer 浏览器自动化，支持扫码登录、多账号管理、图文发布、话题标签、定时发布、编辑、删除等功能。

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
| `delete_cookies` | 删除已保存 Cookie，重置登录状态 |

**环境变量:**

| Variable | Default | Description |
|----------|---------|-------------|
| `XHS_HEADLESS` | `true` | `false` 可显示浏览器窗口（调试用） |
| `XHS_COOKIES_PATH` | `~/.media-mcp/` | Cookie 存储路径 |

如需把本地图片先传到图床，再把 URL 用在其他流程里，安装单独的 `r2-uploader` 插件。

### r2-uploader

Cloudflare R2 MCP Server — 上传本地图片到 R2 并返回公开 URL，可单独使用，也可和 `xhs-poster` 搭配。

**Tools:**

| Tool | Description |
|------|-------------|
| `upload_image` | 上传本地图片到 Cloudflare R2，返回公开 URL |

**环境变量:**

| Variable | Default | Description |
|----------|---------|-------------|
| `R2_ACCOUNT_ID` | — | Cloudflare 账户 ID |
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

### bilibili-poster

哔哩哔哩 MCP Server — 通过 B 站开放平台官方 API 完成 OAuth 授权、封面上传、分区查询和视频投稿。

适合已经拿到 B 站开放平台应用 `client_id` / `client_secret` 的场景，不依赖 Puppeteer。

**Tools:**

| Tool | Description |
|------|-------------|
| `list_accounts` | 列出已保存 OAuth token 的账号 |
| `get_auth_url` | 生成 B 站 OAuth 授权地址 |
| `exchange_code` | 用授权码换取并保存 access token / refresh token |
| `refresh_access_token` | 刷新 access token |
| `check_login_status` | 检查当前账号授权状态 |
| `list_categories` | 查询投稿分区 |
| `upload_cover` | 上传视频封面图 |
| `publish_video` | 上传本地视频并提交稿件 |
| `delete_account_auth` | 删除已保存授权 |

**环境变量:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BILIBILI_CLIENT_ID` | — | B 站开放平台应用 Client ID |
| `BILIBILI_CLIENT_SECRET` | — | B 站开放平台应用 Client Secret |
| `BILIBILI_REDIRECT_URI` | — | OAuth 回调地址，对应开放平台配置的回调域 |
| `BILIBILI_DATA_PATH` | `~/.media-mcp/bilibili/` | 账号 token 持久化目录 |

**授权流程:**

1. 调用 `get_auth_url`
2. 在浏览器打开返回的 URL，完成授权
3. 从回调地址里取出 `code`
4. 调用 `exchange_code`
5. 后续调用 `list_categories`、`upload_cover`、`publish_video`

## Requirements

- [Bun](https://bun.sh) runtime（依赖会在首次启动时自动安装）

## Adding more plugins

1. Create `plugins/<name>/` with source code
2. Add `plugins/<name>/.claude-plugin/plugin.json`
3. Register in `.claude-plugin/marketplace.json`
