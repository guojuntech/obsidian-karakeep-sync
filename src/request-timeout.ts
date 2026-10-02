import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

export const REQUEST_TIMEOUT_MS = 90_000;

// Obsidian requestUrl has no AbortSignal support. A timed-out response is ignored;
// callers stop before any subsequent note/attachment writes.
export async function requestWithTimeout(
  params: RequestUrlParam,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<RequestUrlResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      requestUrl(params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Network request timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
