import { test, expect } from "@playwright/test";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { cube, stl } from "../fixtures.js";
function obj() {
  let next = 1;
  return [
    ["Left", cube()],
    ["Right", cube(30, 0, 0)],
  ]
    .map(([name, p]) => {
      let text = "o " + name + "\n";
      for (let i = 0; i < p.length; i += 3) text += `v ${p[i]} ${p[i + 1]} ${p[i + 2]}\n`;
      for (let i = 0; i < p.length / 3; i += 3) text += `f ${next + i} ${next + i + 1} ${next + i + 2}\n`;
      next += p.length / 3;
      return text;
    })
    .join("");
}
async function previewColours(page) {
  return page.locator(".viewer canvas").evaluate((canvas) => {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext("2d");
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    const result = { blue: { count: 0, x: 0, y: 0 }, purple: { count: 0, x: 0, y: 0 } };
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.slice(i, i + 3);
      const key =
        b > 80 && b > r * 1.8 && b > g * 1.7
          ? "blue"
          : b > 80 && r > 70 && b > g * 1.5 && r > g * 1.3
            ? "purple"
            : null;
      if (key) {
        const colour = result[key];
        colour.count++;
        colour.x += (i / 4) % copy.width;
        colour.y += Math.floor(i / 4 / copy.width);
      }
    }
    for (const colour of Object.values(result)) {
      colour.x = ((colour.x / colour.count) * canvas.clientWidth) / copy.width;
      colour.y = ((colour.y / colour.count) * canvas.clientHeight) / copy.height;
    }
    return result;
  });
}
test("class codes, mm scaling, OBJ colours, advanced requests, extracted ZIP files and bulk actions", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /THREE|shader|WebGLProgram/.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.filePickerCalls = 0;
    Object.defineProperty(window, "showSaveFilePicker", {
      value: () => {
        window.filePickerCalls++;
        throw new Error("File editing access should not be requested");
      },
      configurable: true,
    });
  });
  await page.goto("http://127.0.0.1:4174/teacher");
  await page.getByLabel("Password").fill("local-demo-teacher-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("School for new class").selectOption({ label: "School A" });
  await page.getByLabel("New class name").fill("Design Studio");
  await page.getByLabel("New class code").fill("PRINT4");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await expect(page.getByLabel("Class code for Design Studio")).toHaveValue("PRINT4");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved. The upload page now uses these options.")).toBeVisible();
  await page.goto("http://127.0.0.1:4174/");
  const archive = zipSync({
    "parts/colours.obj": strToU8(obj()),
    "small.stl": stl(new Float32Array([...cube(), ...cube(30, 0, 0)])),
    "another.stl": stl(),
    "readme.txt": strToU8("Do not upload"),
    "photo.png": strToU8("not CAD"),
  });
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "my-cad-files.zip", mimeType: "application/zip", buffer: Buffer.from(archive) });
  await expect(page.getByText("File 1 of 3", { exact: false })).toBeVisible();
  await expect(page.getByText("2 separate parts")).toBeVisible();
  await expect(page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Left/ })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Scale (%)" }).fill("150");
  await expect(page.locator(".viewer-unit-label")).toHaveText("75.0 × 30.0 × 30.0 mm");
  await page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Left/ }).click();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Special filament (on request)" })
    .check();
  await page.getByLabel("Which special filament do you need?").fill("PLA-CF, please check printer compatibility.");
  await page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Right/ }).click();
  await expect(
    page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Right.*Jade White/ }),
  ).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Blue", exact: true })
    .check();
  await expect(
    page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Left.*Special filament/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Right.*Blue/ }),
  ).toBeVisible();
  const colours = await previewColours(page);
  expect(colours.blue.count).toBeGreaterThan(300);
  expect(colours.purple.count).toBeGreaterThan(300);
  await page.locator(".viewer canvas").click({ position: { x: colours.purple.x, y: colours.purple.y } });
  await expect(page.getByRole("group", { name: "Model parts" }).getByRole("button", { name: /Left/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({ path: "test-results/obj-multicolour-glitter-scale.png", fullPage: true });
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(page.getByText("File 2 of 3", { exact: false })).toBeVisible();
  await expect(page.getByText("2 separate parts")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Scale (%)" }).fill("50");
  await expect(page.locator(".viewer-unit-label")).toHaveText("25.0 × 10.0 × 10.0 mm");
  await page
    .getByRole("group", { name: "Model parts" })
    .getByRole("button", { name: /Part 1/ })
    .click();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Special filament (on request)" })
    .check();
  await page.getByLabel("Which special filament do you need?").fill("Silk PLA purple");
  await page
    .getByRole("group", { name: "Model parts" })
    .getByRole("button", { name: /Part 2/ })
    .click();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Blue", exact: true })
    .check();
  await page.getByText("I’ve read the model check", { exact: false }).click();
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(page.getByText("File 3 of 3", { exact: false })).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("First name").fill("Casey");
  await page.getByLabel("School", { exact: false }).first().selectOption({ label: "School A" });
  await page.getByLabel("BNTS teacher").selectOption({ label: "Alex" });
  await page.getByLabel("Class code").fill("wrong");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Class code not found");
  await page.getByLabel("Class code").fill(" print4 ");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("3 files", { exact: true })).toBeVisible();
  await expect(page.getByText("Design Studio", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send for printing" }).click();
  await expect(page.getByRole("heading", { name: /been sent/ })).toBeVisible();
  const records = (
    await page.request.get("http://127.0.0.1:4174/api/admin/submissions").then((r) => r.json())
  ).records.filter((r) => r.firstName === "Casey");
  expect(records).toHaveLength(3);
  expect(records.every((r) => r.classroom === "Design Studio" && !r.originalName.endsWith(".zip"))).toBe(true);
  expect(records.map((r) => r.scalePercent).sort((a, b) => a - b)).toEqual([50, 100, 150]);
  expect(records.find((r) => r.originalName === "colours.obj").advancedFilamentNote).toContain("PLA-CF");
  expect(records.find((r) => r.originalName === "colours.obj").dimensionsMm).toEqual([75, 30, 30]);
  for (const record of records)
    expect(record.filename).toMatch(/^School-A_(WHITE|ADVANCED_BLUE)_\d{4}-\d\d-\d\d_Casey\.(obj|stl)$/);
  await page.goto("http://127.0.0.1:4174/teacher");
  await page.getByRole("combobox", { name: "Class", exact: true }).selectOption({ label: "Design Studio" });
  await page.getByLabel("Select all files").check();
  const toolbar = page.locator(".bulk-actions");
  await toolbar.getByRole("combobox", { name: "Bulk print status" }).selectOption("printing");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByRole("status")).toContainText("Updated 3 files.");
  await page.getByLabel("Select all files").check();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".bulk-actions").getByRole("button", { name: "Download ZIP" }).click();
  const downloaded = await downloadPromise;
  const files = unzipSync(new Uint8Array(await readFile(await downloaded.path())));
  expect(Object.keys(files).filter((name) => /\.(obj|stl)$/.test(name))).toHaveLength(3);
  expect(Buffer.from(files["Print settings.csv"]).toString()).toContain("150");
  expect(Buffer.from(files["Print settings.csv"]).toString()).toContain("PLA-CF");
  expect(await page.evaluate(() => window.filePickerCalls)).toBe(0);
  await page.getByRole("button", { name: /Casey.*small.stl/ }).click();
  await expect(page.locator(".viewer-unit-label")).toHaveText("25.0 × 10.0 × 10.0 mm");
  const teacherColours = await previewColours(page);
  expect(teacherColours.blue.count).toBeGreaterThan(300);
  expect(teacherColours.purple.count).toBeGreaterThan(300);
  await page.getByRole("button", { name: "Close" }).click();
  await page.goto("http://127.0.0.1:4174/");
  const home = page.getByRole("region", { name: "Find your uploads" });
  await home.getByLabel("School").selectOption({ label: "School A" });
  await home.getByLabel("First name").fill("Casey");
  await home.getByRole("button", { name: "Find files" }).click();
  await home.getByRole("button", { name: /small.stl/ }).click();
  await expect(page.locator(".viewer-unit-label")).toHaveText("25.0 × 10.0 × 10.0 mm");
  const homeColours = await previewColours(page);
  expect(homeColours.blue.count).toBeGreaterThan(300);
  expect(homeColours.purple.count).toBeGreaterThan(300);
  await page.getByRole("button", { name: "Close" }).click();
  await page.route("**/api/admin/submissions", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.records = body.records.map((record) => ({ ...record, bytes: 70 * 1024 * 1024 }));
    await route.fulfill({ response, json: body });
  });
  await page.goto("http://127.0.0.1:4174/teacher");
  await page.getByRole("combobox", { name: "Class", exact: true }).selectOption({ label: "Design Studio" });
  await page.getByLabel("Select all files").check();
  await page.locator(".bulk-actions").getByRole("button", { name: "Download ZIP" }).click();
  const batches = page.getByRole("dialog", { name: "Download files" });
  await expect(batches).toBeVisible();
  await expect(batches.getByRole("button", { name: /Download ZIP/ })).toHaveCount(2);
  let downloadedCount = 0;
  for (const index of [1, 2]) {
    const next = page.waitForEvent("download");
    await batches.getByRole("button", { name: "Download ZIP " + index, exact: true }).click();
    const download = await next;
    expect(download.suggestedFilename()).toContain("part-" + index + "-of-2");
    const contents = unzipSync(new Uint8Array(await readFile(await download.path())));
    downloadedCount += Object.keys(contents).filter((name) => /\.(obj|stl)$/.test(name)).length;
    expect(contents["Print settings.csv"]).toBeTruthy();
  }
  expect(downloadedCount).toBe(3);
  expect(await page.evaluate(() => window.filePickerCalls)).toBe(0);
  expect(errors).toEqual([]);
});
test("ZIP model errors keep the batch unsubmitted; OBJ material groups can be coloured separately", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  const archive = zipSync({
    "good.stl": stl(),
    "broken.obj": strToU8("This is not a model"),
    "notes.txt": strToU8("skip"),
  });
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "damaged-model.zip", mimeType: "application/zip", buffer: Buffer.from(archive) });
  await expect(page.getByText("File 1 of 2", { exact: false })).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(page.getByRole("heading", { name: "Send a file to be 3D printed" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("broken.obj");
  await expect(page.getByRole("alert")).toContainText("Remove this file from the ZIP");
  const grouped = obj().replace("o Left\n", "o Shared\nusemtl Base\n").replace("o Right\n", "usemtl Detail\n");
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "material-groups.obj", mimeType: "model/obj", buffer: Buffer.from(grouped) });
  const parts = page.getByRole("group", { name: "Model parts" });
  await expect(parts.getByRole("button", { name: /Shared · Base/ })).toBeVisible();
  await expect(parts.getByRole("button", { name: /Shared · Detail/ })).toBeVisible();
  await expect(page.getByText("2 separate parts")).toBeVisible();
});
