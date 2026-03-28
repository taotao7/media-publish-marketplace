---
name: setup-xhs-poster
description: Set up the xhs-poster (小红书) plugin — install dependencies, configure R2 environment variables, and complete QR code login. Run this after installing the media-publish-marketplace to get xhs-poster working. Trigger when the user mentions setup xhs, 配置小红书, or xhs-poster not working.
---

# Setup XHS Poster

Guide the user through setting up the xhs-poster plugin step by step.

## Step 1: Install Dependencies

Run in the plugin directory:

```bash
cd ${CLAUDE_PLUGIN_ROOT} && bun install
```

If `bun` is not found, tell the user to install Bun first: `curl -fsSL https://bun.sh/install | bash`

## Step 2: Configure Environment Variables (Optional — for image upload via R2)

If the user wants to upload images via Cloudflare R2, they need these env vars. Ask the user to provide them, then add to their Claude Code settings or shell profile:

| Variable | Description |
|----------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret Key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for R2 bucket (e.g. `https://img.example.com`) |

If the user doesn't need R2 image upload, skip this step — the plugin works without it.

To set env vars for the MCP server, add them to the plugin's mcpServers config in Claude Code settings:

```json
{
  "mcpServers": {
    "xhs-poster": {
      "env": {
        "R2_ACCOUNT_ID": "...",
        "R2_ACCESS_KEY_ID": "...",
        "R2_SECRET_ACCESS_KEY": "...",
        "R2_BUCKET_NAME": "...",
        "R2_PUBLIC_URL": "..."
      }
    }
  }
}
```

## Step 3: Login via QR Code

Use the `get_login_qrcode` MCP tool to generate a QR code, then ask the user to scan it with the Xiaohongshu app. After scanning, use `check_login_status` to verify.

If `XHS_HEADLESS` is set to `false`, the browser window will be visible for debugging.

## Step 4: Verify

Run `list_accounts` to confirm the login was saved. Then try `check_login_status` to make sure the session is valid.

## Troubleshooting

- **MCP server won't start**: Run `cd ${CLAUDE_PLUGIN_ROOT} && bun install` manually, check for errors.
- **Login fails**: Set `XHS_HEADLESS=false` to see the browser and debug.
- **R2 upload fails**: Double-check all 5 R2 env vars are set correctly.
