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

## Step 2: Login in Browser

Use the `get_login_qrcode` MCP tool to open a browser window, then ask the user to scan the QR code directly in that window with the Xiaohongshu app. After scanning, use `check_login_status` to verify.

The login tool now opens a visible browser window automatically for setup and login.

## Step 3: Verify

Run `list_accounts` to confirm the login was saved. Then try `check_login_status` to make sure the session is valid.

## Troubleshooting

- **MCP server won't start**: Run `cd ${CLAUDE_PLUGIN_ROOT} && bun install` manually, check for errors.
- **Login fails**: The login flow already opens a visible browser window. If it still fails, keep the window open and inspect the page state while retrying.
- **Need R2 image upload**: Install and configure the separate `r2-uploader` plugin.
