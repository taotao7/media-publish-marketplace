---
name: setup-douyin-poster
description: Set up the douyin-poster (抖音) plugin — install dependencies and complete QR code login. Run this after installing the media-publish-marketplace to get douyin-poster working. Trigger when the user mentions setup douyin, 配置抖音, or douyin-poster not working.
---

# Setup Douyin Poster

Guide the user through setting up the douyin-poster plugin step by step.

## Step 1: Install Dependencies

Run in the plugin directory:

```bash
cd ${CLAUDE_PLUGIN_ROOT} && bun install
```

If `bun` is not found, tell the user to install Bun first: `curl -fsSL https://bun.sh/install | bash`

## Step 2: Login via QR Code

Use the `get_login_qrcode` MCP tool to generate a QR code, then ask the user to scan it with the Douyin app. After scanning, use `check_login_status` to verify.

If `DOUYIN_HEADLESS` is set to `false`, the browser window will be visible for debugging.

## Step 3: Verify

Run `list_accounts` to confirm the login was saved. Then try `check_login_status` to make sure the session is valid.

## Troubleshooting

- **MCP server won't start**: Run `cd ${CLAUDE_PLUGIN_ROOT} && bun install` manually, check for errors.
- **Login fails**: Set `DOUYIN_HEADLESS=false` in the plugin's mcpServers env config to see the browser and debug.
- **Custom cookie path**: Set `DOUYIN_COOKIES_PATH` env var to override the default `~/.media-mcp/douyin/` storage location.
