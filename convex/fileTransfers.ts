"use node";

import { Daytona } from "@daytona/sdk";
import { Buffer } from "node:buffer";
import process from "node:process";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { sanitizeDisplayName } from "./lib";

const DAYTONA_TARGET = "eu";
const MAX_TRANSFER_BYTES = 25 * 1024 * 1024;
const DEFAULT_WORKSPACE_DIR = "/home/daytona/workspace";
const UPLOADS_DIR = `${DEFAULT_WORKSPACE_DIR}/uploads`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing Convex deployment env var: ${name}`);
  }
  return value.trim();
}

function createDaytona(): Daytona {
  return new Daytona({
    apiKey: requiredEnv("DAYTONA_API_KEY"),
    target: DAYTONA_TARGET,
  });
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fallbackUploadPath(displayName: string): string {
  const safe = sanitizeDisplayName(displayName);
  return `${UPLOADS_DIR}/${Date.now()}-${safe}`;
}

export const processUploadToSandbox = internalAction({
  args: { sessionFileId: v.id("sessionFiles") },
  handler: async (ctx, { sessionFileId }) => {
    const { sessionFile, conversation } = await ctx.runQuery(internal.files.getTransferContext, {
      sessionFileId,
    });
    if (!sessionFile || sessionFile.direction !== "upload") return;

    await ctx.runMutation(internal.files.patchForTransferWorker, {
      sessionFileId,
      status: "processing",
      error: null,
    });

    try {
      if (!conversation || conversation.status === "deleted") {
        throw new Error("Conversation not found");
      }
      if (!conversation.sandboxId) {
        throw new Error("Sandbox is not provisioned for this conversation");
      }
      if (!sessionFile.storageId) {
        throw new Error("Missing storage object for upload");
      }

      const metadata = await ctx.runQuery(internal.files.getStorageMetadata, {
        storageId: sessionFile.storageId,
      });
      if (!metadata) throw new Error("Uploaded file metadata not found");
      if (metadata.size > MAX_TRANSFER_BYTES) {
        throw new Error("File exceeds 25MB transfer cap");
      }

      const blob = await ctx.storage.get(sessionFile.storageId);
      if (!blob) throw new Error("Uploaded file body is no longer available");
      const arrayBuffer = await blob.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_TRANSFER_BYTES) {
        throw new Error("File exceeds 25MB transfer cap");
      }

      const daytona = createDaytona();
      const sandbox = await daytona.get(conversation.sandboxId);
      try {
        await sandbox.start();
      } catch {
        // sandbox already running
      }
      await sandbox.fs.createFolder(UPLOADS_DIR, "755").catch(() => undefined);

      const destination = sessionFile.sandboxPath || fallbackUploadPath(sessionFile.displayName);
      await sandbox.fs.uploadFile(Buffer.from(arrayBuffer), destination);

      await ctx.runMutation(internal.files.patchForTransferWorker, {
        sessionFileId,
        status: "ready",
        error: null,
        sandboxPath: destination,
        sizeBytes: metadata.size,
        contentType: sessionFile.contentType || metadata.contentType || null,
      });
    } catch (error) {
      await ctx.runMutation(internal.files.patchForTransferWorker, {
        sessionFileId,
        status: "error",
        error: toErrorText(error),
      });
    }
  },
});

export const processExportToStorage = internalAction({
  args: { sessionFileId: v.id("sessionFiles") },
  handler: async (ctx, { sessionFileId }) => {
    const { sessionFile, conversation } = await ctx.runQuery(internal.files.getTransferContext, {
      sessionFileId,
    });
    if (!sessionFile || sessionFile.direction !== "download") return;

    await ctx.runMutation(internal.files.patchForTransferWorker, {
      sessionFileId,
      status: "processing",
      error: null,
    });

    try {
      if (!conversation || conversation.status === "deleted") {
        throw new Error("Conversation not found");
      }
      if (!conversation.sandboxId) {
        throw new Error("Sandbox is not provisioned for this conversation");
      }
      if (!sessionFile.sandboxPath) {
        throw new Error("No sandbox path set for export");
      }

      const daytona = createDaytona();
      const sandbox = await daytona.get(conversation.sandboxId);
      try {
        await sandbox.start();
      } catch {
        // sandbox already running
      }

      const fileBuffer = await sandbox.fs.downloadFile(sessionFile.sandboxPath);
      if (fileBuffer.byteLength > MAX_TRANSFER_BYTES) {
        throw new Error("File exceeds 25MB transfer cap");
      }

      const contentType = sessionFile.contentType || "application/octet-stream";
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array(fileBuffer)], { type: contentType }),
      );

      await ctx.runMutation(internal.files.patchForTransferWorker, {
        sessionFileId,
        status: "ready",
        error: null,
        storageId,
        sizeBytes: fileBuffer.byteLength,
        contentType,
        sandboxPath: sessionFile.sandboxPath,
      });
    } catch (error) {
      await ctx.runMutation(internal.files.patchForTransferWorker, {
        sessionFileId,
        status: "error",
        error: toErrorText(error),
      });
    }
  },
});
