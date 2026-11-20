// Run after building Frontend. Requires Playwright and ffmpeg on PATH.
// PW_ENTRY can point to a local playwright/index.mjs; BROWSER_PATH selects a Chromium executable.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PW_ENTRY ? pathToFileURL(process.env.PW_ENTRY) : "playwright"
);
const directory = await mkdtemp(join(tmpdir(), "segrabi-editor-"));
const fixture = join(directory, "source.mp4");
const formats = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};
let browser;
try {
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=size=128x72:rate=30:duration=12",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    fixture,
  ]);
  const mp4 = await readFile(fixture);
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_PATH,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = {
    title: "Source session",
    fileName: "source",
    filePath: "X:/source.mp4",
    duration: "00:00:12",
    game: "Fixture",
    fileSizeKb: 1024,
    fileSize: "1 MB",
    createdAt: "2026-01-01T00:00:00Z",
    isImported: false,
    compressed: false,
    bookmarks: [],
  };
  const clip = {
    ...base,
    id: "clip",
    type: "Clip",
    title: "Exported clip",
    filePath: "X:/clip.mp4",
    fileName: "clip",
  };
  const session = {
    ...base,
    id: "session",
    type: "Session",
    bookmarks: [
      {
        id: 10,
        type: "ClipSaved",
        mediaId: "clip",
        time: "00:00:05",
        clipStart: "00:00:02",
        clipOffset: 0,
      },
    ],
  };
  await page.addInitScript(
    ({ session, clip }) => {
      window.WebSocket = class extends EventTarget {
        static OPEN = 1;
        readyState = 1;
        send() {}
        close() {}
      };
      window.testMessages = [];
      window.external.sendMessage = (text) =>
        window.testMessages.push(JSON.parse(text));
      localStorage.setItem(
        "segra.settings.v1",
        JSON.stringify({
          airplaneMode: true,
          defaultMenuItem: "Full Sessions",
          clipClearSegmentsAfterCreatingClip: false,
        }),
      );
      localStorage.setItem(
        "segra.appstate.v1",
        JSON.stringify({ content: [session, clip], screenshots: [] }),
      );
    },
    { session, clip },
  );
  await page.route("http://editor.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (process.env.SEGRA_UI_BASE) {
      const response = await fetch(new URL(path, process.env.SEGRA_UI_BASE));
      return route.fulfill({
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: Buffer.from(await response.arrayBuffer()),
      });
    }
    const file = join("Frontend/dist", path === "/" ? "index.html" : path);
    return route.fulfill({ path: file, contentType: formats[extname(file)] });
  });
  await page.route("http://localhost:2222/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    };
    if (
      url.pathname !== "/api/content" ||
      !url.searchParams.get("input")?.endsWith(".mp4")
    ) {
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: "[]",
      });
    }
    const range = /bytes=(\d+)-(\d*)/.exec(
      route.request().headers().range ?? "",
    );
    if (!range)
      return route.fulfill({ headers, contentType: "video/mp4", body: mp4 });
    const start = Number(range[1]);
    const end = range[2]
      ? Math.min(Number(range[2]), mp4.length - 1)
      : mp4.length - 1;
    return route.fulfill({
      status: 206,
      contentType: "video/mp4",
      body: mp4.subarray(start, end + 1),
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${mp4.length}`,
      },
    });
  });
  await page.goto("http://editor.test/");
  await page.locator('[data-content-id="session"]').click();
  const player = page.locator("video").first();
  const button = (name) =>
    page.getByRole("button", { name, exact: typeof name === "string" });
  const lastExport = () =>
    page.evaluate(
      () =>
        window.testMessages.filter((m) => m.Method === "CreateClip").at(-1)
          .Parameters,
    );
  const seek = async (time) => {
    await page.waitForFunction(
      () => document.querySelector("video")?.readyState >= 2,
    );
    await player.evaluate(async (v, time) => {
      v.pause();
      if (v.currentTime === time && !v.seeking) return;
      const done = new Promise((resolve) =>
        v.addEventListener("seeked", resolve, { once: true }),
      );
      v.currentTime = time;
      await done;
    }, time);
  };
  await seek(1.25);
  await button(/^Set start here/).click();
  assert.ok(await button("Create Clip").isDisabled());
  await seek(2.75);
  await button(/^Set end here/).click();
  await button(/^Play segment.*00:01.500/).click();
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return v?.paused && Math.abs(v.currentTime - 2.75) < 0.002;
  });
  await button("Create Clip").click();
  assert.deepEqual(
    (await lastExport()).Segments.map((s) => [s.startTime, s.endTime]),
    [[1.25, 2.75]],
  );
  await seek(4);
  await button("New segment").click();
  await seek(6);
  await button(/^Set end here/).click();
  await button("Create 2 clips").click();
  assert.equal((await lastExport()).OutputMode, "separate");
  await button("Combine into one clip").click();
  assert.equal((await lastExport()).OutputMode, "combined");

  const created = await lastExport();
  await page.evaluate(
    (segments) =>
      window.dispatchEvent(
        new CustomEvent("websocket-message", {
          detail: {
            method: "ClipProgress",
            content: { id: 42, progress: 100, clipIds: ["clip"], segments },
          },
        }),
      ),
    created.Segments,
  );
  await button("View created clip").click();
  await button("Copy").click();
  assert.ok(
    await page.evaluate(() =>
      window.testMessages.some(
        (m) =>
          m.Method === "CopyFileToClipboard" &&
          m.Parameters.FilePath === "X:/clip.mp4",
      ),
    ),
  );
  await button("Adjust cut").click();
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return v?.paused && !v.seeking && Math.abs(v.currentTime - 2) < 0.001;
  });
  assert.match(await button(/^Set start here/).innerText(), /00:02\.000/);
  assert.match(await button(/^Set end here/).innerText(), /00:05\.000/);
  await seek(1);
  await button(/^Set start here/).click();
  await button("Save adjusted clip").click();
  assert.deepEqual(
    (await lastExport()).Segments.map((s) => [
      s.contentId,
      s.startTime,
      s.endTime,
    ]),
    [["session", 1, 5]],
  );
  assert.deepEqual(errors, []);
  console.log(
    "Clip editor passed: timed preview, separate/combined export, review, copy, and source adjustment with unrelated drafts.",
  );
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
