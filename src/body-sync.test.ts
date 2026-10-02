/** @jest-environment jsdom */
import { App, requestUrl } from "obsidian";
import { TextEncoder } from "util";

import { bodyMarkdown, relativeAttachmentPath } from "./body-sync";
import { HoarderBookmark } from "./hoarder-client";
import { DEFAULT_SETTINGS } from "./settings";

Object.assign(globalThis, { TextEncoder });

const settings = {
  ...DEFAULT_SETTINGS,
  apiEndpoint: "https://keep.example/api/v1",
  apiKey: "private-token",
  syncFolder: "Articles",
  attachmentsFolder: "Articles/media",
};
const article = (html: string): HoarderBookmark => ({
  id: "article",
  createdAt: "2026-10-01T00:00:00Z",
  modifiedAt: null,
  archived: false,
  favourited: false,
  taggingStatus: null,
  tags: [],
  content: {
    type: "link",
    url: "https://article.example/read",
    htmlContent: html,
    imageAssetId: "banner",
    screenshotAssetId: "screenshot",
  },
  assets: [{ id: "archive", assetType: "fullPageArchive" }],
});
let files: Map<string, ArrayBuffer>;
let app: App;
beforeEach(() => {
  jest.clearAllMocks();
  files = new Map();
  app = {
    vault: {
      createFolder: jest.fn(),
      adapter: {
        exists: jest.fn(async () => true),
        list: jest.fn(async () => ({ files: [...files.keys()], folders: [] })),
        writeBinary: jest.fn(async (p: string, data: ArrayBuffer) => files.set(p, data)),
      },
    },
  } as unknown as App;
});

test("converts article formatting and localizes only referenced embedded images", async () => {
  const html =
    '<script>evil()</script><h2>Heading</h2><p><b>Body</b></p><img src="data:image/png;base64,AQID"><a href="/next">Next</a><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>';
  const result = await bodyMarkdown(article(html), app, settings);
  expect(result).toContain("## Heading");
  expect(result).toContain("**Body**");
  expect(result).toContain("| A |");
  expect(result).toContain("https://article.example/next");
  expect(result).not.toContain("evil");
  expect(result).toContain(
    "media/039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81.png"
  );
  expect(files.size).toBe(1);
  expect([...new Uint8Array([...files.values()][0])]).toEqual([1, 2, 3]);
  expect(requestUrl).not.toHaveBeenCalled();
  expect(await bodyMarkdown(article(html), app, settings)).toBe(result);
  expect(files.size).toBe(1);
});

test("extracts WeChat article body without page header", async () => {
  expect(
    await bodyMarkdown(
      article('<p>Page header</p><div id="js_content"><p>Body</p></div>'),
      app,
      settings
    )
  ).toBe("Body");
});

test("downloads external referenced media without transmitting the API key", async () => {
  (requestUrl as jest.Mock).mockResolvedValue({
    status: 200,
    headers: { "content-type": "image/png" },
    arrayBuffer: new Uint8Array([1, 2]).buffer,
  });
  const result = await bodyMarkdown(
    article('<img src="/image.png"><a href="/next">next</a>'),
    app,
    settings
  );
  expect(result).toContain("media/");
  expect(requestUrl).toHaveBeenCalledTimes(1);
  expect(requestUrl).toHaveBeenCalledWith({
    url: "https://article.example/image.png",
    headers: {},
  });
});

test("authenticates Karakeep assets only on the exact API origin", async () => {
  (requestUrl as jest.Mock).mockResolvedValue({
    status: 200,
    headers: { "content-type": "application/pdf" },
    arrayBuffer: new Uint8Array([1, 2]).buffer,
  });
  await bodyMarkdown(
    article('<a href="https://keep.example/assets/document">PDF</a>'),
    app,
    settings
  );
  expect(requestUrl).toHaveBeenCalledWith({
    url: "https://keep.example/api/v1/assets/document",
    headers: { Authorization: "Bearer private-token" },
  });
  jest.clearAllMocks();
  await bodyMarkdown(
    article('<img src="https://keep.example.attacker.test/image.png">'),
    app,
    settings
  );
  expect(requestUrl).toHaveBeenCalledWith({
    url: "https://keep.example.attacker.test/image.png",
    headers: {},
  });
});

test("retains remote and data references when downloading is disabled", async () => {
  const result = await bodyMarkdown(
    article('<img src="/image.png"><img src="data:image/png;base64,AQID">'),
    app,
    { ...settings, downloadAssets: false }
  );
  expect(result).toContain("https://article.example/image.png");
  expect(result).toContain("data:image/png;base64,AQID");
  expect(files.size).toBe(0);
  expect(requestUrl).not.toHaveBeenCalled();
});

test("localizes Markdown text attachments", async () => {
  const b = article("");
  b.content = { type: "text", text: "Body\n\n![Image](data:image/png;base64,AQID)" };
  expect(await bodyMarkdown(b, app, settings)).toContain("![Image](media/");
  expect(files.size).toBe(1);
});

test("reports missing content and failed attachments instead of replacing a note with an empty body", async () => {
  await expect(bodyMarkdown(article(""), app, settings)).rejects.toThrow("no article body");
  (requestUrl as jest.Mock).mockResolvedValue({ status: 403, headers: {} });
  await expect(bodyMarkdown(article('<img src="/missing.png">'), app, settings)).rejects.toThrow(
    "403"
  );
  expect(files.size).toBe(0);
});

test("builds relative references for root, sibling and nested folders", () => {
  expect(relativeAttachmentPath("assets/hash.png", "/")).toBe("assets/hash.png");
  expect(relativeAttachmentPath("assets/hash.png", "Articles")).toBe("../assets/hash.png");
  expect(relativeAttachmentPath("Articles/media folder/hash.png", "Articles")).toBe(
    "media%20folder/hash.png"
  );
});
