---
name: setup-r2-uploader
description: Set up the r2-uploader plugin — install dependencies and configure Cloudflare R2 environment variables. Run this after installing the media-publish-marketplace to get r2-uploader working. Trigger when the user mentions setup r2, 配置 R2, 图床上传, or r2-uploader not working.
---

# Setup R2 Uploader

Guide the user through setting up the r2-uploader plugin step by step.

## Step 1: Install Dependencies

Run in the plugin directory:

```bash
cd ${CLAUDE_PLUGIN_ROOT} && bun install
```

If `bun` is not found, tell the user to install Bun first: `curl -fsSL https://bun.sh/install | bash`

## Step 2: Configure Environment Variables

The plugin requires these env vars:

| Variable | Description |
|----------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret Key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for the bucket (e.g. `https://img.example.com`) |

To set env vars for the MCP server, add them to the plugin's `mcpServers` config in Claude Code settings:

```json
{
  "mcpServers": {
    "r2-uploader": {
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

## Step 3: Verify

Run the `upload_image` MCP tool with an absolute local image path and confirm it returns a public URL under `R2_PUBLIC_URL`.

## Troubleshooting

- **MCP server won't start**: Run `cd ${CLAUDE_PLUGIN_ROOT} && bun install` manually, then retry.
- **Upload fails with missing env vars**: Make sure all 5 R2 env vars are present under `mcpServers.r2-uploader.env`.
- **Returned URL is wrong**: Check that `R2_PUBLIC_URL` points to the public domain you actually expose for the bucket.
