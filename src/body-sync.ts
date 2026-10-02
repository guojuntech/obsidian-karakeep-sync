import { sha256 } from "@noble/hashes/sha256";
import { App, requestUrl } from "obsidian";
import Turndown from "turndown";
import { gfm } from "turndown-plugin-gfm";

import { HoarderBookmark } from "./hoarder-client";
import { HoarderSettings } from "./settings";

const mimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "application/zip": "zip",
};
async function localize(
  url: string,
  app: App,
  settings: HoarderSettings,
  baseUrl: string
): Promise<string> {
  if (!settings.downloadAssets) return new URL(url, baseUrl).href;
  const folder = settings.attachmentsFolder.replace(/^\/+|\/+$/g, "") || "assets";
  if (!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);
  let buffer: Uint8Array | undefined;
  let mime = "";
  let absolute: string;
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error("Invalid embedded attachment");
    mime = match[1];
    buffer = match[2]
      ? Uint8Array.from(atob(match[3].replace(/\s/g, "")), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[3]));
    absolute = url;
  } else {
    absolute = new URL(url, baseUrl).href;
    if (!/^https?:/.test(absolute)) throw new Error("Unsupported attachment URL");
  }
  const id = Array.from(sha256(buffer || new TextEncoder().encode(absolute)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  const listing = await app.vault.adapter.list(folder);
  const existing = listing.files.find((f) => (f.split("/").pop() || "").startsWith(id + "."));
  if (existing) return relativeAttachmentPath(existing, settings.syncFolder);
  if (!buffer) {
    const api = new URL(settings.apiEndpoint);
    const target = new URL(absolute);
    const headers: Record<string, string> = {};
    // Send the token only to Karakeep's asset API, never to article hosts.
    if (target.origin === api.origin && /^\/(?:api\/v1\/)?assets\//.test(target.pathname)) {
      const assetId = target.pathname.split("/").pop();
      absolute = settings.apiEndpoint.replace(/\/$/, "") + "/assets/" + assetId;
      headers.Authorization = "Bearer " + settings.apiKey;
    }
    const response = await requestUrl({ url: absolute, headers });
    if (response.status >= 400) throw new Error("Attachment HTTP " + response.status);
    mime = (response.headers["content-type"] || "").split(";")[0];
    if (mime === "text/html") throw new Error("Attachment returned an HTML page");
    buffer = new Uint8Array(response.arrayBuffer);
  }
  const ext =
    mimeExtensions[mime] ||
    (new URL(absolute.startsWith("data:") ? "https://inline.invalid/" : absolute).pathname.match(
      /\.([a-zA-Z0-9]{1,8})$/
    ) || [])[1] ||
    "bin";
  const path = folder + "/" + id + "." + ext.toLowerCase();
  await app.vault.adapter.writeBinary(path, Uint8Array.from(buffer).buffer);
  return relativeAttachmentPath(path, settings.syncFolder);
}
export async function bodyMarkdown(
  bookmark: HoarderBookmark,
  app: App,
  settings: HoarderSettings
): Promise<string> {
  const content = bookmark.content;
  if (content.type === "asset") {
    if (!content.assetId) return "";
    const path = await localize(
      settings.apiEndpoint + "/assets/" + content.assetId,
      app,
      settings,
      settings.apiEndpoint
    );
    return "![](" + path + ")";
  }
  if (content.type === "text") {
    let markdown = content.text || "";
    const references = [
      ...markdown.matchAll(/(!?)\[([^\]\n]*)\]\(<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\)/g),
    ];
    for (const match of references.reverse()) {
      const url = match[3];
      if (!/^(https?:|data:)/.test(url)) continue;
      const target = new URL(url);
      if (
        !match[1] &&
        !/\.(pdf|png|jpe?g|gif|webp|svg|avif|mp4|mp3|ogg|zip|docx?|xlsx?|pptx?)$/i.test(
          target.pathname
        ) &&
        !(
          target.origin === new URL(settings.apiEndpoint).origin &&
          /^\/(?:api\/v1\/)?assets\//.test(target.pathname)
        )
      )
        continue;
      const local = await localize(url, app, settings, settings.apiEndpoint);
      markdown =
        markdown.slice(0, match.index) +
        match[1] +
        "[" +
        match[2] +
        "](" +
        local +
        ")" +
        markdown.slice(match.index + match[0].length);
    }
    return markdown;
  }
  if (!content.htmlContent || !content.htmlContent.trim())
    throw new Error("Karakeep has no article body for bookmark " + bookmark.id);
  const doc = new DOMParser().parseFromString(content.htmlContent, "text/html");
  const root = doc.querySelector<HTMLElement>("#js_content") || doc.body;
  root.querySelectorAll("script,style,noscript,iframe,form,button").forEach((n) => n.remove());
  const base = content.url || settings.apiEndpoint;
  for (const node of root.querySelectorAll("img,video,audio,source,a[href]")) {
    const isLink = node.tagName === "A";
    const attr = isLink ? "href" : "src";
    const raw =
      node.getAttribute(attr) ||
      node.getAttribute("data-src") ||
      node.getAttribute("data-original");
    if (!raw || raw.startsWith("#")) continue;
    const absolute = new URL(raw, base);
    if (!["http:", "https:", "data:"].includes(absolute.protocol)) continue;
    const isAttachment =
      !isLink ||
      /\.(pdf|png|jpe?g|gif|webp|svg|avif|mp4|mp3|ogg|zip|docx?|xlsx?|pptx?)(?:$)/i.test(
        absolute.pathname
      ) ||
      (absolute.origin === new URL(settings.apiEndpoint).origin &&
        /^\/(?:api\/v1\/)?assets\//.test(absolute.pathname));
    if (isAttachment) {
      node.setAttribute(attr, await localize(raw, app, settings, base));
      node.removeAttribute("srcset");
    } else node.setAttribute(attr, absolute.href);
  }
  const td = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.use(gfm);
  td.addRule("media", {
    filter: ["video", "audio", "source"],
    replacement: (_, n) =>
      n.getAttribute("src") ? "\n\n![](" + n.getAttribute("src") + ")\n\n" : "",
  });
  return td.turndown(root).trim();
}

// Standard Markdown links must resolve from the note's folder, not the vault root.
export function relativeAttachmentPath(assetPath: string, syncFolder: string): string {
  const from = syncFolder.split("/").filter(Boolean);
  const to = assetPath.split("/").filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to.map(encodeURIComponent)].join("/");
}
