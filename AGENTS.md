# media-publish-marketplace

Codex plugin marketplace for media publishing tools.

## Project Structure

```
.Codex-plugin/marketplace.json       # marketplace catalog (name: "media-publish-marketplace")
plugins/xhs-poster/                   # XHS MCP server plugin
  .Codex-plugin/plugin.json          # plugin manifest — declares mcpServers config
  src/index.ts                        # MCP server entry, all tool definitions
  src/mcp.ts                          # McpServer/transport wrapper
  package.json / tsconfig.json / bun.lock
README.md
```

## Runtime

Uses **Bun** — always `bun run` or `bun install`, never node/npm.

## Adding a New Plugin

1. Create `plugins/<name>/` with source code
2. Create `plugins/<name>/.Codex-plugin/plugin.json` with `name`, `description`, `version`, and component config (`mcpServers`, `commands`, `skills`, etc.)
3. Add entry to `.Codex-plugin/marketplace.json` plugins array with `"source": "./plugins/<name>"`

## Plugin Marketplace Spec

### `marketplace.json` Schema

Location: `.Codex-plugin/marketplace.json` at repo root.

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

- Plugins are **copied** to `~/.Codex/plugins/cache/` — cannot reference files outside their directory via `../`.
- Use symlinks to share files across plugins.
- Use `${CLAUDE_PLUGIN_ROOT}` in hooks/MCP configs to reference installed plugin files.
- Use `${CLAUDE_PLUGIN_DATA}` for state/data that should survive plugin updates.

### Version & Caching

- Version is set in `plugin.json` (wins) or marketplace entry. Avoid setting both.
- For relative-path plugins: set version in marketplace entry.
- For all other sources: set version in `plugin.json`.

### Team/Org Distribution (`.Codex/settings.json`)

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
Codex plugin validate .
# or inside Codex:
/plugin validate .
```

Common errors: duplicate plugin names, `..` in paths, invalid JSON, non-kebab-case names.

## xhs-poster Tools

`list_accounts`, `check_login_status`, `get_login_qrcode`, `list_notes`, `list_all_notes`, `delete_note`, `edit_note`, `publish_content`, `upload_image`, `delete_cookies`

## xhs-poster Env Vars

| Variable | Description |
|----------|-------------|
| `XHS_HEADLESS` | `true` to hide browser (default) |
| `XHS_COOKIES_PATH` | Cookie storage path |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API Token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret Key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for R2 bucket |
