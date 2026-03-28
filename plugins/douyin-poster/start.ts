#!/usr/bin/env bun
/**
 * Startup wrapper: ensures dependencies are installed before launching the MCP server.
 * Used by plugin.json so the plugin works immediately after marketplace installation.
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { execSync } from "node:child_process"

const pluginRoot = dirname(new URL(import.meta.url).pathname)
const nodeModules = join(pluginRoot, "node_modules")

if (!existsSync(nodeModules)) {
  console.error("[douyin-poster] Installing dependencies...")
  execSync("bun install", { cwd: pluginRoot, stdio: "inherit" })
}

await import("./src/index.js")
