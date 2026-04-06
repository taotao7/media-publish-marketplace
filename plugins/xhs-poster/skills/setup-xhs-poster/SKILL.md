---
name: setup-xhs-poster
description: Set up the xhs-poster (小红书) plugin — install dependencies and complete QR code login. Run this after installing the media-publish-marketplace to get xhs-poster working. Trigger when the user mentions setup xhs, 配置小红书, or xhs-poster not working.
---

# Setup XHS Poster

Guide the user through setting up the xhs-poster plugin step by step.

## Step 1: Install Dependencies

Run in the plugin directory:

```bash
cd ${CLAUDE_PLUGIN_ROOT} && bun install
```

If `bun` is not found, tell the user to install Bun first: `curl -fsSL https://bun.sh/install | bash`

## Step 2: Login via QR Code

Use the `get_login_qrcode` MCP tool to generate a QR code, then ask the user to scan it with the Xiaohongshu app. After scanning, use `check_login_status` to verify.

If `XHS_HEADLESS` is set to `false`, the browser window will be visible for debugging.

## Step 3: Verify

Run `list_accounts` to confirm the login was saved. Then try `check_login_status` to make sure the session is valid.

## Troubleshooting

- **MCP server won't start**: Run `cd ${CLAUDE_PLUGIN_ROOT} && bun install` manually, check for errors.
- **Login fails**: Set `XHS_HEADLESS=false` to see the browser and debug.
- **Need R2 image upload**: Install and configure the separate `r2-uploader` plugin.
