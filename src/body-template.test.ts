/** @jest-environment jsdom */
import { TextEncoder } from "util";

import { HoarderBookmark } from "./hoarder-client";
import HoarderPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import {
  BODY_ONLY_TEMPLATE,
  buildTemplateContext,
  renderTemplate,
  validateTemplate,
} from "./template-renderer";

Object.assign(globalThis, { TextEncoder });
const bookmark: HoarderBookmark = {
  id: "article",
  createdAt: "2026-10-01T00:00:00Z",
  modifiedAt: null,
  archived: false,
  favourited: false,
  taggingStatus: null,
  tags: [],
  content: {
    type: "link",
    url: "https://example.org",
    htmlContent: "<h2>Article</h2><p>Full body</p>",
  },
  assets: [{ id: "unrelated", assetType: "screenshot" }],
};
function plugin() {
  const p = Object.create(HoarderPlugin.prototype) as HoarderPlugin;
  p.settings = { ...DEFAULT_SETTINGS };
  return p;
}
test("registers content_markdown in context and validates the body-only template", () => {
  expect(validateTemplate(BODY_ONLY_TEMPLATE).valid).toBe(true);
  const context = buildTemplateContext(
    bookmark,
    "Title",
    [],
    "",
    null,
    DEFAULT_SETTINGS,
    "## Body"
  );
  expect(context.content_markdown).toBe("## Body");
  expect(renderTemplate(BODY_ONLY_TEMPLATE, context)).toContain("## Body");
});
test.each(["content_markdown", "content_html"])(
  "requests full body for %s templates using small API pages",
  async (variable) => {
    const p = plugin();
    p.settings.customTemplate = `<%= it.${variable} %>`;
    const getBookmarks = jest.fn(async () => ({ bookmarks: [], nextCursor: null }));
    Object.assign(p, { client: { getBookmarks } });
    await p.fetchBookmarks("cursor");
    expect(getBookmarks).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, cursor: "cursor", includeContent: true })
    );
  }
);
test("preserves list-only API behavior when no full-content template is selected", async () => {
  const p = plugin();
  p.settings.useCustomTemplate = false;
  const getBookmarks = jest.fn(async () => ({ bookmarks: [], nextCursor: null }));
  Object.assign(p, { client: { getBookmarks } });
  await p.fetchBookmarks();
  expect(getBookmarks).toHaveBeenCalledWith(
    expect.objectContaining({ limit: 100, includeContent: undefined })
  );
});
test("renders only the body without querying unrelated assets", async () => {
  const p = plugin();
  Object.assign(p, { app: { vault: {} } });
  const md = await p.formatBookmarkAsMarkdown(bookmark, "Title");
  expect(md).toContain("## Article\n\nFull body");
  expect(md).not.toContain("## Notes");
  expect(md).not.toContain("screenshot");
});

test.each([
  ["/", ["root.md", "folder/nested.md", "folder-other/other.md"]],
  ["/folder/", ["folder/nested.md"]],
])("finds local bookmark notes in sync folder %s", async (syncFolder, expected) => {
  const p = plugin();
  p.settings.syncFolder = syncFolder;
  const exists = jest.fn(async () => true);
  Object.assign(p, {
    app: {
      vault: {
        adapter: { exists },
        getMarkdownFiles: () => ["root.md", "folder/nested.md", "folder-other/other.md"].map(path => ({ path })),
      },
      metadataCache: { getFileCache: (file: { path: string }) => ({ frontmatter: { bookmark_id: file.path } }) },
    },
  });
  expect([...((await p.getLocalBookmarkFiles()).values())]).toEqual(expected);
  if (syncFolder === "/") expect(exists).not.toHaveBeenCalled();
});


describe("automatic sync scheduling", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("zero cancels an existing timer without starting or scheduling sync", () => {
    const p = plugin();
    const sync = jest.spyOn(p, "syncBookmarks").mockResolvedValue({ success: true, message: "OK" });
    p.syncIntervalId = window.setInterval(() => { void p.syncBookmarks(); }, 1000);
    p.settings.syncIntervalMinutes = 0;
    p.startPeriodicSync();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(sync).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a positive interval enables startup and periodic sync", () => {
    const p = plugin();
    const sync = jest.spyOn(p, "syncBookmarks").mockResolvedValue({ success: true, message: "OK" });
    p.settings.syncIntervalMinutes = 10;
    p.startPeriodicSync();
    expect(sync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(sync).toHaveBeenCalledTimes(2);
    p.settings.syncIntervalMinutes = 0;
    p.startPeriodicSync();
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
