/**
 * One-time script to pre-bake a Daytona snapshot with all agent dependencies installed.
 * This eliminates the npm install step during sandbox provisioning, cutting cold-start
 * time from ~30s to ~5s.
 *
 * Usage:
 *   $env:DAYTONA_API_KEY = "dtn_xxx"; node scripts/create-snapshot.mjs
 *
 * After running, add to your Convex deployment env:
 *   npx convex env set DAYTONA_SNAPSHOT agentic-runtime-v1
 *
 * The snapshot includes: node:20-slim + @mariozechner/pi-agent-core, @mariozechner/pi-ai,
 * @sinclair/typebox, convex (all at latest).
 */

import { Daytona, Image } from "@daytona/sdk";

const SNAPSHOT_NAME = process.env.SNAPSHOT_NAME || "agentic-runtime-v3";
const DAYTONA_TARGET = process.env.DAYTONA_TARGET || "eu";

const apiKey = process.env.DAYTONA_API_KEY;
if (!apiKey) {
  console.error("Error: DAYTONA_API_KEY environment variable is required.");
  process.exit(1);
}

console.log(`Creating Daytona snapshot: ${SNAPSHOT_NAME}`);
console.log(`Target region: ${DAYTONA_TARGET}`);

const daytona = new Daytona({ apiKey, target: DAYTONA_TARGET });

// Build a Node.js 20 slim image with all agent runtime dependencies pre-installed.
// The agentHost.mjs bundle itself is NOT baked in — it's uploaded fresh on each provision
// so code changes deploy without requiring a new snapshot.
const image = Image.base("node:20-slim").runCommands(
  // Core system tools + full build toolchain so the agent never has to apt-get install at runtime
  "apt-get update -qq && apt-get install -y --no-install-recommends " +
    "git ca-certificates curl wget " +
    "build-essential gcc g++ make cmake " +
    "python3 python3-pip python3-venv " +
    "default-jdk-headless " +
    "golang-go " +
    "sudo " +
    "&& rm -rf /var/lib/apt/lists/*",
  // Give the daytona user passwordless sudo
  "echo 'daytona ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers || true",
  "mkdir -p /home/daytona/agent /home/daytona/workspace/uploads",
  "cd /home/daytona/agent && npm init -y",
  "cd /home/daytona/agent && npm install --save @mariozechner/pi-agent-core@latest @mariozechner/pi-ai@latest @sinclair/typebox@latest convex@latest --no-fund --no-audit",
  "npm cache clean --force",
);

try {
  const snapshot = await daytona.snapshot.create(
    {
      name: SNAPSHOT_NAME,
      image,
    },
    {
      onLogs: (log) => process.stdout.write(log),
      timeout: 600,
    },
  );

  console.log("\n✓ Snapshot created successfully!");
  console.log(`  Name: ${snapshot.name}`);
  console.log("\nNext steps:");
  console.log(`  npx convex env set DAYTONA_SNAPSHOT ${snapshot.name}`);
  console.log("  # Or add to .env.local: DAYTONA_SNAPSHOT=" + snapshot.name);
} catch (err) {
  console.error("\n✗ Snapshot creation failed:", err.message || err);
  process.exit(1);
}
