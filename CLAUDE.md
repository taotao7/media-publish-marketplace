# media-publish-marketplace

Claude Code plugin marketplace for media publishing tools.

## Project Structure

```
.claude-plugin/marketplace.json       # marketplace catalog (name: "media-publish-marketplace")
plugins/xhs-poster/                   # XHS MCP server plugin
plugins/r2-uploader/                  # Cloudflare R2 uploader MCP plugin
plugins/douyin-poster/                # Douyin MCP server plugin
  .claude-plugin/plugin.json          # each plugin declares its own manifest
  src/index.ts                        # MCP server entry, all tool definitions
  src/mcp.ts                          # McpServer/transport wrapper
  package.json / tsconfig.json / bun.lock
README.md
```

## Runtime

Uses **Bun** — always `bun run` or `bun install`, never node/npm.

## Adding a New Plugin

1. Create `plugins/<name>/` with source code
2. Create `plugins/<name>/.claude-plugin/plugin.json` with `name`, `description`, `version`, and component config (`mcpServers`, `commands`, `skills`, etc.)
3. Add entry to `.claude-plugin/marketplace.json` plugins array with `"source": "./plugins/<name>"`

## Plugin Marketplace Spec

### `marketplace.json` Schema

Location: `.claude-plugin/marketplace.json` at repo root.

**Required fields:**

```json
{
  "name": "kebab-case-id",         // public-facing, no spaces, reserved names blocked
  "owner": { "name": "..." },      // email optional
  "plugins": [...]
}
```

**Optional metadata:**

```json
"metadata": {
  "description": "...",
  "version": "...",
  "pluginRoot": "./plugins"        // base dir prepended to relative plugin source paths
}
```

### Plugin Entry Fields

Each entry in `plugins[]` requires `name` (kebab-case) and `source`. Optional: `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, `strict`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`.

### Plugin Sources

| Type | Example |
|------|---------|
| Relative path | `"./plugins/my-plugin"` — must start with `./`, no `..` |
| GitHub | `{ "source": "github", "repo": "owner/repo", "ref": "v1.0", "sha": "..." }` |
| Git URL | `{ "source": "url", "url": "https://...", "ref": "...", "sha": "..." }` |
| Git subdir | `{ "source": "git-subdir", "url": "...", "path": "tools/plugin", "ref": "...", "sha": "..." }` |
| npm | `{ "source": "npm", "package": "@org/pkg", "version": "2.1.0", "registry": "..." }` |
| pip | `{ "source": "pip", "package": "...", "version": "..." }` |

> **Note:** Relative paths only work when marketplace is added via Git clone (not via direct URL to the JSON file).

### Strict Mode

- `strict: true` (default): `plugin.json` is authoritative; marketplace entry merges on top.
- `strict: false`: marketplace entry is the entire definition; plugin must NOT also declare components in `plugin.json`.

### Plugin Installation Notes

- Plugins are **copied** to `~/.claude/plugins/cache/` — cannot reference files outside their directory via `../`.
- Use symlinks to share files across plugins.
- Use `${CLAUDE_PLUGIN_ROOT}` in hooks/MCP configs to reference installed plugin files.
- Use `${CLAUDE_PLUGIN_DATA}` for state/data that should survive plugin updates.

### Version & Caching

- Version is set in `plugin.json` (wins) or marketplace entry. Avoid setting both.
- For relative-path plugins: set version in marketplace entry.
- For all other sources: set version in `plugin.json`.

### Team/Org Distribution (`.claude/settings.json`)

```json
{
  "extraKnownMarketplaces": {
    "company-tools": { "source": { "source": "github", "repo": "org/repo" } }
  },
  "enabledPlugins": {
    "my-plugin@company-tools": true
  }
}
```

### Validation

```bash
claude plugin validate .
# or inside Claude Code:
/plugin validate .
```

Common errors: duplicate plugin names, `..` in paths, invalid JSON, non-kebab-case names.

## xhs-poster Tools

`list_accounts`, `check_login_status`, `get_login_qrcode`, `list_notes`, `list_all_notes`, `delete_note`, `edit_note`, `publish_content`, `delete_cookies`

## xhs-poster Env Vars

| Variable | Description |
|----------|-------------|
| `XHS_HEADLESS` | `true` to hide browser (default) |
| `XHS_COOKIES_PATH` | Cookie storage path |

## r2-uploader Tools

`upload_image`

## r2-uploader Env Vars

| Variable | Description |
|----------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret Key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for R2 bucket |

## douyin-poster Tools

`list_accounts`, `check_login_status`, `get_login_qrcode`, `publish_video`, `publish_images`, `delete_cookies`

## douyin-poster Env Vars

| Variable | Description |
|----------|-------------|
| `DOUYIN_HEADLESS` | `false` to show browser (default: headless) |
| `DOUYIN_COOKIES_PATH` | Override cookie storage root |

Cookie storage: `~/.media-mcp/douyin/accounts/<account>/cookies.json`

## douyin-poster DOM Notes (creator.douyin.com)

These are fragile — verify if selectors break after site updates.

**Image tab:** `div.tab-container-DjaX1b > div:nth-child(2)` (2nd tab on upload page)

**Image upload flow:**
- Start URL: `https://creator.douyin.com/creator-micro/content/upload`
- After first image upload, page **navigates** to `/creator-micro/content/post/image?...` — must use `waitForNavigation` alongside `uploadFile` for the first image
- Uploaded image thumbnails use CSS `background-image`, NOT `<img src>` — detect with `[style*='creator-media-private.douyin.com']`
- Music must be explicitly selected: click element with text "选择音乐" after upload — Douyin auto-picks a suitable track

**Scheduled publishing:**
- "定时发布" is a `span` (text match, `children.length <= 1`) inside `label.radio-d4zkru` — click it to reveal date picker
- Date/time input: `input[placeholder='日期和时间']`, format `yyyy-MM-dd HH:mm`
- Clear + type value + press Enter to confirm; `page.waitForSelector` the input after toggling

**QR code detection:**
- Class-based: `img[class*='qrcode_img']`, `[class*='qrcode'] img`
- Fallback: find `<img>` with base64 src **and** `naturalWidth >= 100` — the page has many small icon images that match `data:image/png;base64,` but are not QR codes
- QR code image may load slowly; poll up to 30s

**Login detection signals:**
- Not logged in: QR code selectors or text "扫码登录" present
- Logged in: file input / title input / publish button or text "发布作品" present
- After QR scan, page may redirect — `waitForLogin` must re-check after redirect settles

## Puppeteer 调试方法论：自循环 DOM 拦截

调试 Puppeteer 自动化时，**不要用截图猜界面**，直接在 `page.evaluate` 里查 DOM，效率高得多。

### 标准自循环流程

1. **写诊断脚本**（`test/inspect-*.ts`），加载 cookies、导航到目标页面
2. **`page.evaluate` 拦截 DOM**，拿到选择器、文本、属性、URL 等原始信息
3. **根据输出更新 selectors.ts**，再跑实际功能
4. **功能失败时重复**：在失败点前后各加一次 DOM dump，定位问题

### 常用 DOM 拦截模式

```ts
// 查某类元素的 class / text / src
await page.evaluate(() =>
  Array.from(document.querySelectorAll("img")).map(img => ({
    src: img.src.slice(0, 80),
    className: img.className,
    naturalWidth: (img as HTMLImageElement).naturalWidth,
  }))
)

// 找包含特定文字的叶节点
await page.evaluate(() =>
  Array.from(document.querySelectorAll("*"))
    .filter(el => el.children.length === 0 && el.textContent?.includes("音乐"))
    .map(el => ({ tag: el.tagName, className: el.className, text: el.textContent?.trim() }))
)

// 检查 URL 跳转
console.error("[url]", page.url())  // 在关键操作前后都打

// 验证选择器命中数
await page.evaluate((sel) => document.querySelectorAll(sel).length, selector)

// 查内联 style（如 background-image）
await page.evaluate((sel) =>
  Array.from(document.querySelectorAll(sel)).map(el => (el as HTMLElement).style.cssText)
, "[class*='cover']")
```

### 关键原则

- **上传/点击操作前后都打 URL**：很多页面操作会触发导航，`page.$` 在导航期间会返回 null 或报错
- **class 名有 hash 后缀**（如 `qrcode_img-NPVTJs`）— 用 `[class*='qrcode_img']` 子串匹配，不要写死完整 class
- **`img` 不一定有 src**：缩略图/背景图常用 CSS `background-image`，要查 `[style*='...']` 或 `element.style.backgroundImage`
- **诊断脚本复用 cookies**：`launchBrowser(account)` 自动加载已保存的 cookies，诊断脚本不需要重新登录

## douyin-poster Test Scripts

```bash
bun run --cwd plugins/douyin-poster test/login.ts            # scan QR code, save cookies
bun run --cwd plugins/douyin-poster test/publish-images.ts   # publish a test image post (private)
bun run --cwd plugins/douyin-poster test/inspect-login.ts    # dump login page DOM
bun run --cwd plugins/douyin-poster test/inspect-publish-page.ts  # dump image upload page DOM
```

Set `DOUYIN_HEADLESS=false` on any of the above to watch the browser.
