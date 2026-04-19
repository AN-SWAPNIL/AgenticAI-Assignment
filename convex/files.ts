import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { sanitizeDisplayName } from "./lib";

const MAX_TRANSFER_BYTES = 25 * 1024 * 1024;
const DEFAULT_WORKSPACE_DIR = "/home/daytona/workspace";
const UPLOADS_DIR = `${DEFAULT_WORKSPACE_DIR}/uploads`;

type SessionFileDoc = Doc<"sessionFiles">;

function randomTag(): string {
  return Math.random().toString(36).slice(2, 9);
}

function buildUploadPath(displayName: string): string {
  const safeName = sanitizeDisplayName(displayName);
  return `${UPLOADS_DIR}/${Date.now()}-${randomTag()}-${safeName}`;
}

export const generateUploadUrl = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<string> => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.status === "deleted") {
      throw new Error("Conversation not found");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerUpload = mutation({
  args: {
    conversationId: v.id("conversations"),
    storageId: v.id("_storage"),
    displayName: v.string(),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { conversationId, storageId, displayName, contentType, sizeBytes },
  ): Promise<{ sessionFileId: Id<"sessionFiles"> }> => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.status === "deleted") {
      throw new Error("Conversation not found");
    }

    const metadata = await ctx.db.system.get("_storage", storageId);
    const resolvedSize = sizeBytes ?? metadata?.size;
    if (resolvedSize !== undefined && resolvedSize > MAX_TRANSFER_BYTES) {
      throw new Error("File exceeds 25MB upload cap");
    }

    const now = Date.now();
    const sessionFileId = await ctx.db.insert("sessionFiles", {
      conversationId,
      direction: "upload",
      source: "user",
      status: "queued",
      displayName: sanitizeDisplayName(displayName),
      sandboxPath: buildUploadPath(displayName),
      storageId,
      contentType: contentType || metadata?.contentType,
      sizeBytes: resolvedSize,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.fileTransfers.processUploadToSandbox, {
      sessionFileId,
    });

    return { sessionFileId };
  },
});

export const listForConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (
    ctx,
    { conversationId },
  ): Promise<Array<SessionFileDoc & { downloadUrl: string | null }>> => {
    const rows = await ctx.db
      .query("sessionFiles")
      .withIndex("by_conversationId_and_createdAt", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .collect();

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        downloadUrl: row.storageId ? await ctx.storage.getUrl(row.storageId) : null,
      })),
    );
  },
});

export const markDownloaded = mutation({
  args: { sessionFileId: v.id("sessionFiles") },
  handler: async (ctx, { sessionFileId }) => {
    const row = await ctx.db.get(sessionFileId);
    if (!row) return;
    await ctx.db.patch(sessionFileId, {
      downloadedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const getTransferContext = internalQuery({
  args: { sessionFileId: v.id("sessionFiles") },
  handler: async (
    ctx,
    { sessionFileId },
  ): Promise<{
    sessionFile: SessionFileDoc | null;
    conversation: Doc<"conversations"> | null;
  }> => {
    const sessionFile = await ctx.db.get(sessionFileId);
    if (!sessionFile) return { sessionFile: null, conversation: null };
    const conversation = await ctx.db.get(sessionFile.conversationId);
    return { sessionFile, conversation };
  },
});

export const getStorageMetadata = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (
    ctx,
    { storageId },
  ): Promise<{ size: number; contentType?: string } | null> => {
    const metadata = await ctx.db.system.get("_storage", storageId);
    if (!metadata) return null;
    return {
      size: metadata.size,
      contentType: metadata.contentType,
    };
  },
});

export const patchForTransferWorker = internalMutation({
  args: {
    sessionFileId: v.id("sessionFiles"),
    status: v.optional(
      v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("error")),
    ),
    error: v.optional(v.union(v.string(), v.null())),
    storageId: v.optional(v.union(v.id("_storage"), v.null())),
    sandboxPath: v.optional(v.union(v.string(), v.null())),
    contentType: v.optional(v.union(v.string(), v.null())),
    sizeBytes: v.optional(v.union(v.number(), v.null())),
    downloadedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.sessionFileId);
    if (!existing) return;

    const patch: {
      status?: SessionFileDoc["status"];
      error?: string;
      storageId?: Id<"_storage">;
      sandboxPath?: string;
      contentType?: string;
      sizeBytes?: number;
      downloadedAt?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.status !== undefined) patch.status = args.status;
    if (args.error !== undefined) patch.error = args.error ?? undefined;
    if (args.storageId !== undefined) patch.storageId = args.storageId ?? undefined;
    if (args.sandboxPath !== undefined) patch.sandboxPath = args.sandboxPath ?? undefined;
    if (args.contentType !== undefined) patch.contentType = args.contentType ?? undefined;
    if (args.sizeBytes !== undefined) patch.sizeBytes = args.sizeBytes ?? undefined;
    if (args.downloadedAt !== undefined) patch.downloadedAt = args.downloadedAt ?? undefined;

    await ctx.db.patch(args.sessionFileId, patch);
  },
});
