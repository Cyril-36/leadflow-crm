import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

// A paced walkthrough of the assessment's evaluation matrix, recorded as video. The waits here
// are deliberate pauses for the viewer, not synchronisation; every step still asserts its result.
//
// Recording: Chrome's screencast at 2x pixel density (2560x1600) sends a frame on every repaint, with its
// time. Those frames are resampled to a steady 30 fps by when each was on screen, so the video
// plays at real speed (1x), then encoded at high quality. Needs ffmpeg with libx264 on the PATH.

const FRAMES = path.resolve("test-results/demo-frames");
const OUTPUT = path.resolve("../docs/demo.mp4");

async function startRecording(page: Page) {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const frames: { file: string; at: number }[] = [];
  const cdp: CDPSession = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `frame-${String(frames.length).padStart(5, "0")}.jpg`;
    writeFileSync(path.join(FRAMES, file), Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 1, maxWidth: 2560, maxHeight: 1600 });
  return async () => {
    const end = Date.now() / 1000;
    await cdp.send("Page.stopScreencast");
    // Resample to a steady 30 fps: each tick shows the frame that was on screen at that moment,
    // so the video lasts exactly as long as the recording did (1x). Sorted by time, since Chrome
    // can stamp its first (initial-state) frame after the next one.
    const ordered = [...frames].sort((a, b) => a.at - b.at);
    const fps = 30;
    const ticks = Math.round((end - ordered[0].at) * fps);
    const sequence = path.join(FRAMES, "sequence");
    mkdirSync(sequence);
    for (let tick = 0, j = 0; tick < ticks; tick++) {
      const t = ordered[0].at + tick / fps;
      while (j + 1 < ordered.length && ordered[j + 1].at <= t) j++;
      symlinkSync(path.join(FRAMES, ordered[j].file), path.join(sequence, `${String(tick).padStart(6, "0")}.jpg`));
    }
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-framerate", String(fps), "-i", path.join(sequence, "%06d.jpg"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-an", OUTPUT,
    ]);
    writeFileSync(path.join(FRAMES, "timing.json"), JSON.stringify({ seconds: end - ordered[0].at, ticks, fps }));
    return frames.length;
  };
}

const CAPTION_ID = "demo-caption";

async function caption(page: Page, text: string) {
  await page.evaluate(
    ({ id, text }) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        Object.assign(el.style, {
          // Bottom-left: clear of the header and of the centred toasts.
          position: "fixed", left: "16px", bottom: "16px", zIndex: "2147483647",
          padding: "12px 16px", borderRadius: "12px", background: "rgba(22,32,29,0.94)", color: "#fff",
          font: "600 15px/1.35 system-ui, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,.25)",
          pointerEvents: "none", maxWidth: "400px",
        });
        document.body.appendChild(el);
      }
      el.textContent = text;
    },
    { id: CAPTION_ID, text },
  );
}

/** A visible cursor, since recorded video doesn't show the real one. */
async function installCursor(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        position: "fixed", width: "18px", height: "18px", borderRadius: "50%", zIndex: "2147483646",
        background: "rgba(13,92,79,0.35)", border: "2px solid #0d5c4f", pointerEvents: "none",
        transform: "translate(-50%, -50%)", left: "-40px", top: "-40px", transition: "transform 120ms",
      });
      document.body.appendChild(dot);
      window.addEventListener("mousemove", (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
      window.addEventListener("mousedown", () => { dot.style.transform = "translate(-50%, -50%) scale(0.7)"; }, true);
      window.addEventListener("mouseup", () => { dot.style.transform = "translate(-50%, -50%)"; }, true);
    });
  });
}

async function point(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("target not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(250);
}

async function clickOn(page: Page, target: Locator) {
  await point(page, target);
  await target.click();
}

const pause = (page: Page, ms = 1800) => page.waitForTimeout(ms);

// Headed: only a visible window gives the screencast frames at full 2x resolution (headless
// sends them at CSS size). The flags keep Chrome painting at full speed if the window is covered.
test.use({
  video: "off",
  deviceScaleFactor: 2,
  headless: false,
  launchOptions: {
    args: [
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  },
});

test("LeadFlow walkthrough", async ({ page }) => {
  await installCursor(page);
  await page.goto("/");
  await expect(page.locator('section[aria-labelledby="agenda-heading"]')).toBeVisible();
  await page.waitForTimeout(600); // let entrance animations settle before recording
  const stopRecording = await startRecording(page);
  const zone = await page.evaluate(
    () => new Intl.DateTimeFormat("en-US", { timeZoneName: "long" }).formatToParts().find((p) => p.type === "timeZoneName")?.value,
  );
  await caption(page, `LeadFlow: a single-screen lead tracker (times shown in ${zone})`);
  await pause(page, 2600);

  // 1. Lead list.
  await caption(page, "1. Every lead shows its name, status badge, last discussion and how long ago it was");
  await point(page, page.locator("[data-lead-id]").nth(2));
  await pause(page, 2400);
  await page.mouse.wheel(0, 420);
  await pause(page, 1600);
  await page.mouse.wheel(0, -420);
  await pause(page, 900);

  // 2. Today's follow-ups.
  await caption(page, "2. Today's follow-ups are pinned on top: overdue in red, above the Now line");
  await point(page, page.locator('section[aria-labelledby="agenda-heading"] [data-lead-id]').first());
  await pause(page, 2800);

  // 3. Timeline dialog.
  await caption(page, "3. Clicking a lead opens its timeline in a dialog, newest first");
  const ananya = page.locator("[data-lead-id]", { hasText: "Ananya Rao" });
  await clickOn(page, ananya);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Intro call. 40 reps")).toBeVisible();
  await pause(page, 3000);
  await clickOn(page, dialog.getByRole("button", { name: "Close" }));
  await pause(page, 600);

  // 4. Discussion with a follow-up updates the list immediately.
  await caption(page, "4. Log a discussion with a follow-up later today; the list updates without a reload");
  const leah = page.locator("[data-lead-id]", { hasText: "Leah Fernandes" });
  await clickOn(page, leah);
  const note = dialog.getByLabel("New discussion");
  await clickOn(page, note);
  await note.pressSequentially("Trial set up for both advisors. Call this afternoon to check in.", { delay: 28 });
  await clickOn(page, dialog.getByRole("button", { name: "Change follow-up" }));
  await pause(page, 600);
  await clickOn(page, dialog.getByRole("button", { name: /^Later today/ }));
  await pause(page, 1200);
  await clickOn(page, dialog.getByRole("button", { name: "Save note" }));
  await expect(page.getByText("Note saved.", { exact: true })).toBeVisible();
  await pause(page, 1600);
  await clickOn(page, dialog.getByRole("button", { name: "Close" }));
  await expect(page.locator('section[aria-labelledby="agenda-heading"]').getByText("Leah Fernandes")).toBeVisible();
  await caption(page, "4. Leah moved into Today's follow-ups straight away");
  await pause(page, 3000);

  // 5. Add a lead.
  await caption(page, "5. Add a new lead: name required, company and phone optional, status starts as New");
  await clickOn(page, page.getByRole("button", { name: "Add lead" }));
  await page.getByLabel("Name").pressSequentially("Meera Iyer", { delay: 45 });
  await page.getByLabel(/Company/).pressSequentially("Saffron Wealth Partners", { delay: 30 });
  await page.getByLabel(/Phone/).pressSequentially("555-0109", { delay: 45 });
  await pause(page, 700);
  await clickOn(page, page.getByRole("button", { name: "Save lead" }));
  const meera = page.locator("[data-lead-id]", { hasText: "Meera Iyer" });
  await expect(meera).toContainText("New");
  await point(page, meera);
  await pause(page, 2600);

  // 6. Status change persists.
  await caption(page, "6. Change the status from the dialog; it is recorded in the timeline");
  await clickOn(page, meera);
  await clickOn(page, dialog.getByRole("combobox"));
  await pause(page, 700);
  await clickOn(page, page.getByRole("option", { name: "Contacted" }));
  await expect(dialog.getByText("Status changed from New to Contacted")).toBeVisible();
  await pause(page, 2400);
  await clickOn(page, dialog.getByRole("button", { name: "Close" }));
  await caption(page, "6. Reloading the page: the change persisted in the database");
  await pause(page, 900);
  await page.reload();
  await caption(page, "6. Reloading the page: the change persisted in the database");
  await expect(page.locator("[data-lead-id]", { hasText: "Meera Iyer" })).toContainText("Contacted");
  await point(page, page.locator("[data-lead-id]", { hasText: "Meera Iyer" }));
  await pause(page, 2600);

  // Bonus features.
  await caption(page, "Bonus: search by name or company");
  const search = page.getByLabel("Search leads");
  await clickOn(page, search);
  await search.pressSequentially("kestrel", { delay: 70 });
  await expect(page.locator("[data-lead-id]")).toHaveCount(1);
  await pause(page, 2000);
  await search.fill("");
  await caption(page, "Bonus: status filters with counts across all leads");
  await clickOn(page, page.getByRole("radio", { name: /^Qualified/ }));
  await pause(page, 1800);
  await clickOn(page, page.getByRole("radio", { name: /^Won/ }));
  await pause(page, 1600);
  await clickOn(page, page.getByRole("radio", { name: /^All/ }));
  await pause(page, 900);

  // Extras beyond the brief.
  await caption(page, "Extra: the overdue count is a filter too");
  const overdueToggle = page.getByRole("button", { name: /overdue$/ });
  await clickOn(page, overdueToggle);
  await pause(page, 2200);
  await clickOn(page, overdueToggle);
  await pause(page, 700);

  await caption(page, "Extra: Needs attention lists open leads that need action, and says why");
  const attention = page.getByRole("button", { name: /Needs attention/ });
  await clickOn(page, attention);
  await expect(page.getByText(/^Open leads with an overdue follow-up/)).toBeVisible();
  await pause(page, 900);
  await page.mouse.wheel(0, 260); // bring the reason chips up, clear of the caption
  await pause(page, 600);
  await point(page, page.getByText("No follow-up scheduled", { exact: true }).first());
  await pause(page, 2800);
  await clickOn(page, attention);
  await pause(page, 700);

  await caption(page, "Extra: Snooze a due follow-up in one click");
  const rohan = page.locator("[data-lead-id]", { hasText: "Rohan Mehta" });
  await clickOn(page, page.getByRole("button", { name: "Snooze the follow-up for Rohan Mehta" }));
  await pause(page, 1200);
  await clickOn(page, page.getByRole("menuitem", { name: "Tomorrow, 10 AM" }));
  await expect(page.getByText("Follow-up for Rohan Mehta moved to Tomorrow, 10:00 AM.")).toBeVisible();
  await expect(rohan).toContainText("Follow-up Tomorrow, 10:00 AM");
  await point(page, rohan);
  await pause(page, 2600);

  await caption(page, "Extra: export the leads on screen as CSV, with the active filters");
  const download = page.waitForEvent("download");
  await clickOn(page, page.getByRole("button", { name: "Export the leads shown as CSV" }));
  await download;
  await expect(page.getByText(/^Exported \d+ leads\.$/)).toBeVisible();
  await pause(page, 2400);

  await caption(page, "Extra: reschedule a follow-up without writing a note");
  await clickOn(page, page.locator("[data-lead-id]", { hasText: "Arjun Kapoor" }));
  await clickOn(page, dialog.getByRole("button", { name: "Change follow-up" }));
  await clickOn(page, dialog.getByRole("button", { name: "Tomorrow, 10 AM" }));
  await pause(page, 900);
  await clickOn(page, dialog.getByRole("button", { name: "Save follow-up" }));
  await expect(dialog.getByText(/^Follow-up moved to Tomorrow/)).toBeVisible();
  await pause(page, 1800);

  await caption(page, "Extra: correct a lead's details from the dialog");
  await clickOn(page, dialog.getByRole("button", { name: "Edit details" }));
  const phone = dialog.getByLabel("Phone (optional)");
  await phone.fill("");
  await phone.pressSequentially("555-0161", { delay: 45 });
  await clickOn(page, dialog.getByRole("button", { name: "Save details" }));
  await expect(dialog.getByText("Updated phone")).toBeVisible();
  await pause(page, 1800);
  await clickOn(page, dialog.getByRole("button", { name: "Close" }));

  await caption(page, "Also: Docker Compose, keyboard shortcuts and drafts that survive a refresh. Code: github.com/Cyril-36/leadflow-crm");
  await pause(page, 3400);

  const frames = await stopRecording();
  expect(frames).toBeGreaterThan(100);
});
