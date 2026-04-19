import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Safety net for orphaned Daytona sandboxes — VMs whose conversation row is deleted, or
 * whose daemon has been silent for hours. The orchestrator already deletes a sandbox when
 * a user removes a conversation, but if that action fails (network blip, Daytona outage)
 * the sandbox would otherwise sit until billing notices.
 *
 * Runs hourly and is intentionally aggressive about closing things down — anything that
 * hasn't heartbeated in two hours is considered abandoned.
 */
const crons = cronJobs();

crons.interval(
  "sweep-orphaned-sandboxes",
  { hours: 1 },
  internal.sweeper.sweepOrphans,
  {},
);

export default crons;
