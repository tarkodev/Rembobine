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
  const session = { ...base, id: "session", type: "Session" };
  await page.addInitScript((session) => {
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
        confirmBeforeDeleting: true,
        showBookmarksInFullscreen: true,
        defaultMenuItem: "Full Sessions",
        clipClearSegmentsAfterCreatingClip: false,
      }),
    );
    localStorage.setItem(
      "segra.appstate.v1",
      JSON.stringify({ content: [session], screenshots: [] }),
    );
  }, session);
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
      url.searchParams.get("input")?.endsWith(".png") ||
      url.pathname === "/api/thumbnail"
    ) {
      return route.fulfill({
        headers,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="blue"/></svg>',
      });
    }
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
  const create = button(/^Create Clips?$/);
  const add = button("Add Segment");
  const options = button("Segment options");
  assert.equal(await button(/^Set (start|end) here/i).count(), 0);
  assert.equal(await button(/^Play segment/i).count(), 0);
  await seek(1.25);
  await add.click();
  await create.click();
  const first = (await lastExport()).Segments[0];
  assert.equal(first.startTime, 1.25);
  assert.ok(first.endTime > first.startTime);

  const handle = await page
    .getByLabel("Resize segment end", { exact: true })
    .boundingBox();
  const track = await page.locator(".timeline-container").boundingBox();
  assert.ok(handle && track);
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  const shift = track.width / 12; // One second on the unzoomed 12-second fixture.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + shift, y, { steps: 10 });
  await page.mouse.up();
  await create.click();
  const resized = (await lastExport()).Segments[0];
  assert.equal(resized.startTime, first.startTime);
  assert.ok(Math.abs(resized.endTime - first.endTime - 1) < 0.05);

  await seek(6);
  await add.click();
  await create.click();
  const separate = await lastExport();
  assert.equal(separate.OutputMode, "separate");
  assert.equal(separate.Segments.length, 2);
  assert.equal(separate.Segments[0].endTime, resized.endTime);
  assert.equal(separate.Segments[1].startTime, 6);

  await options.click();
  assert.ok(await page.getByRole("radio", { name: "Separate" }).isChecked());
  await page.getByRole("radio", { name: "Combined" }).check();
  await page.keyboard.press("Escape");
  assert.equal(await options.getAttribute("aria-expanded"), "false");
  await button("Clear").click();
  await page.locator("dialog:modal").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog:modal").waitFor({ state: "hidden" });
  await create.click();
  const combined = await lastExport();
  assert.equal(combined.OutputMode, "combined");
  assert.deepEqual(combined.Segments, separate.Segments);

  // Simulate the backend announcing the exported clip and linking its excerpts in the source.
  const timeString = (t) =>
    new Date(Math.round(t * 1000)).toISOString().slice(11, 23);
  let offset = 0;
  const bookmarks = combined.Segments.map((segment, index) => {
    const bookmark = {
      id: 10 + index,
      type: "ClipSaved",
      mediaId: clip.id,
      time: timeString(segment.endTime),
      clipStart: timeString(segment.startTime),
      clipOffset: offset,
    };
    offset += segment.endTime - segment.startTime;
    return bookmark;
  });
  await page.evaluate(
    ({ session, bookmarks, clip, segments }) => {
      const emit = (method, content) =>
        window.dispatchEvent(
          new CustomEvent("websocket-message", { detail: { method, content } }),
        );
      emit("State", { content: [{ ...session, bookmarks }, clip] });
      emit("ClipProgress", {
        id: 42,
        progress: 100,
        clipIds: [clip.id],
        segments,
      });
    },
    { session, bookmarks, clip, segments: combined.Segments },
  );
  const marker = button(`Clip Saved at ${bookmarks[0].time}`);
  await marker.click();
  await button("Open Clip").waitFor();
  await page.keyboard.press("Escape");
  await button("Open Clip").waitFor({ state: "hidden" });
  await marker.click();
  assert.equal(await button("View created clip").count(), 0);
  await seek(4.5);
  await button("Open Clip").click();
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

  const isPlayingFile = (file) =>
    page.waitForFunction((file) => {
      const src = document.querySelector("video")?.currentSrc;
      return src && new URL(src).searchParams.get("input") === file;
    }, file);
  await isPlayingFile("X:/clip.mp4");
  await player.hover();
  await button("Enter Fullscreen").click();
  const speed = button("Change playback speed");
  await speed.click();
  await page.keyboard.press("Escape");
  assert.equal(await speed.getAttribute("aria-expanded"), "false");
  await button("Exit Fullscreen").waitFor();
  await page.keyboard.down("Escape");
  await button("Enter Fullscreen").waitFor();
  await page.keyboard.down("Escape"); // A held key must not also leave the clip.
  await page.keyboard.up("Escape");
  await isPlayingFile("X:/clip.mp4");
  await page.keyboard.press("Escape");
  await isPlayingFile("X:/source.mp4");
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video.paused && Math.abs(video.currentTime - 4.5) < 0.05;
  });
  await page.keyboard.press("Escape");
  await page.locator('[data-content-id="session"]').waitFor();

  // A previously selected combined output must survive a fresh player instance.
  await page.reload();
  await page.locator('[data-content-id="session"]').click();
  await options.click();
  assert.ok(await page.getByRole("radio", { name: "Combined" }).isChecked());
  await page.keyboard.press("Escape");

  // Two captures share the first timestamp, two are slightly apart, three share the last.
  const times = [
    "00:00:00",
    "00:00:00",
    "00:00:04.000",
    "00:00:04.016",
    "00:00:12",
    "00:00:12",
    "00:00:12",
  ];
  await page.evaluate(
    ({ session, times }) => {
      const screenshots = times.map((_, id) => ({
        mediaId: String(id),
        fileName: id + ".png",
        filePath: "X:/" + id + ".png",
        title: "Capture " + id,
        game: session.game,
        isImported: false,
        createdAt: session.createdAt,
        fileSizeBytes: 200,
      }));
      const bookmarks = times.map((time, id) => ({
        id,
        time,
        type: "ScreenshotSaved",
        mediaId: id === 3 ? undefined : String(id),
      }));
      bookmarks.push(
        { id: 20, time: "00:00:08", type: "ScreenshotSaved" },
        { id: 21, time: "00:00:08", type: "ClipSaved" },
      );
      window.dispatchEvent(
        new CustomEvent("websocket-message", {
          detail: {
            method: "State",
            content: { content: [{ ...session, bookmarks }], screenshots },
          },
        }),
      );
    },
    { session, times },
  );
  for (const fullscreen of [false, true]) {
    if (fullscreen) {
      await player.hover();
      await button("Enter Fullscreen").click();
    }
    const pairButton = (i) =>
      button(`Screenshot Saved at ${times[i]}, ${(i % 2) + 1} of 2`).first();
    for (let i = 0; i < 4; i++) {
      const marker = pairButton(i);
      if (i === 0) await marker.focus();
      else await marker.hover();
      const preview = page.getByRole("tooltip");
      const img = preview.locator("img");
      await img.evaluate((el) => el.decode());
      const url = new URL(await img.getAttribute("src"));
      assert.equal(
        url.searchParams.get("input"),
        i === 3 ? "X:/source.mp4" : `X:/${i}.png`,
      );
      if (i === 3) assert.equal(url.searchParams.get("time"), "4.016");
      assert.equal(
        await preview.innerText(),
        i < 2 ? "00:00.000" : times[i].slice(3),
      );
      const footprint = await marker.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const track = el.parentElement.getBoundingClientRect();
        const line = el.querySelector("line");
        const tip = new DOMPoint(
          line.x2.baseVal.value,
          line.y2.baseVal.value,
        ).matrixTransform(line.getScreenCTM());
        return {
          left: rect.left,
          start: track.left,
          width: track.width,
          tip: tip.x,
        };
      });
      const seconds = Number(times[i].split(":").pop());
      assert.ok(
        Math.abs(
          footprint.tip - footprint.start - (footprint.width * seconds) / 12,
        ) < 1,
      );
      assert.ok(footprint.left >= footprint.start - 1);
      if (i % 2 === 1) {
        const previous = await pairButton(i - 1).boundingBox();
        assert.ok(footprint.left >= previous.x + previous.width + 2);
      }
      await marker.click();
      await page.waitForFunction((t) => {
        const v = document.querySelector("video");
        return v.paused && Math.abs(v.currentTime - t) < 0.001;
      }, seconds);
      await page.keyboard.press("Escape");
    }
    await button("Clip Saved at 00:00:08, 2 of 2").first().waitFor();
    await button("3 bookmarks").first().hover();
    const grouped = page.getByRole("group", { name: "Overlapping bookmarks" });
    await grouped.waitFor();
    assert.equal(await grouped.getByRole("button").count(), 3);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Clip editor, Escape navigation and overlapping screenshot previews passed in both player layouts.",
  );
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
