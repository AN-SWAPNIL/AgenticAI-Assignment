import { MODEL_OPTIONS, type ModelId } from "../types";

const MODEL_PREFERENCE_STORAGE_KEY = "smart-pi-assistant:preferred-model";
const VALID_MODEL_IDS = new Set<string>(MODEL_OPTIONS.map((option) => option.id));

function isModelId(candidate: string): candidate is ModelId {
  return VALID_MODEL_IDS.has(candidate);
}

export function readPreferredModelId(): ModelId | null {
  try {
    const stored = localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY)?.trim();
    if (!stored || !isModelId(stored)) return null;
    return stored;
  } catch {
    return null;
  }
}

export function writePreferredModelId(modelId: string): void {
  const normalized = modelId.trim();
  if (!normalized || !isModelId(normalized)) return;
  try {
    localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage errors (private mode, denied quotas, etc.).
  }
}
