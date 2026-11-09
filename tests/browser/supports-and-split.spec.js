import { test, expect } from "@playwright/test";
import { cube, stl, cantilever, multicolour3mf } from "../fixtures.js";
test("support information is grey, previews supports and marks a rough underside without failing the check", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174/");
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "overhang.stl", mimeType: "application/octet-stream", buffer: stl(cantilever()) });
  await expect(page.getByText("No problems found")).toBeVisible();
  await expect(page.locator(".check-summary.warning")).toHaveCount(0);
  await expect(page.getByText("Not a slicer.", { exact: false })).not.toBeVisible();
  const card = page.getByRole("button", { name: /About supports/ });
  await expect(card).toBeVisible();
  const colour = await card.evaluate((element) => getComputedStyle(element).color);
  const channels = colour.match(/\d+/g).map(Number);
  expect(Math.min(...channels)).toBeGreaterThan(100);
  expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(25);
  await card.click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-support-preview", "visible");
  expect(Number(await page.locator(".viewer").getAttribute("data-support-count"))).toBeGreaterThan(0);
  await expect(page.getByText("Speckled areas may leave a rough underside.")).toBeVisible();
  await page.screenshot({ path: "test-results/supports-rough-underside.png", fullPage: true });
  await page.getByRole("button", { name: "Test print", exact: true }).click();
  await expect(page.getByText("Test print finished", { exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.getByText("Your print may fail", { exact: true })).not.toBeVisible();
  await card.click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-support-preview", "hidden");
  expect(errors).toEqual([]);
});
test("joined multicolour areas are called sections and the single-part note is removed", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/");
  await page.getByRole("radio", { name: /Advanced/ }).check();
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "joined-colours.3mf", mimeType: "model/3mf", buffer: multicolour3mf() });
  const sections = page.getByRole("group", { name: "Model sections" });
  await expect(sections.getByRole("button", { name: /Section 1/ })).toBeVisible();
  await expect(sections.getByRole("button", { name: /Section 2/ })).toBeVisible();
  await expect(page.getByText("Select a section, then choose its colour.", { exact: false })).toBeVisible();
  await expect(page.getByText("One part was found.", { exact: false })).not.toBeVisible();
  await expect(page.getByRole("region", { name: "Separate objects" })).not.toBeVisible();
});
test("students split an STL and upload each object with independent settings", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/teacher");
  await page.getByLabel("Password").fill("local-demo-teacher-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Print requests" })).toBeVisible();
  await page.goto("http://127.0.0.1:4174/");
  await page.getByRole("radio", { name: /Advanced/ }).check();
  await page.getByLabel("Upload a 3D printing file").setInputFiles({
    name: "nut-and-bolt.stl",
    mimeType: "application/octet-stream",
    buffer: stl(new Float32Array([...cube(), ...cube(35, 0, 0, 10)])),
  });
  await expect(page.getByText("This file has 2 separate objects.")).toBeVisible();
  const parts = page.getByRole("group", { name: "Model parts" }),
    colours = page.getByRole("radiogroup", { name: "Available print colours" });
  await parts.getByRole("button", { name: /Part 1/ }).click();
  await colours.getByRole("radio", { name: "Blue", exact: true }).check();
  await parts.getByRole("button", { name: /Part 2/ }).click();
  await colours.getByRole("radio", { name: "Red", exact: true }).check();
  await page.getByRole("spinbutton", { name: "Scale (%)" }).fill("150");
  await page.getByRole("button", { name: "Split into separate files" }).click();
  await expect(page.getByText("File 1 of 2", { exact: false })).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();
  await expect(colours.getByRole("radio", { name: "Blue", exact: true })).toBeChecked();
  await page.getByRole("combobox", { name: "Copies", exact: true }).selectOption("2");
  await page.getByRole("combobox", { name: "Supports", exact: true }).selectOption("Prefer no supports");
  await page.getByLabel("Notes for your teacher").fill("Nut settings");
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(page.getByText("File 2 of 2", { exact: false })).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();
  await expect(colours.getByRole("radio", { name: "Red", exact: true })).toBeChecked();
  await page.getByRole("spinbutton", { name: "Scale (%)" }).fill("75");
  await page.getByRole("combobox", { name: "Supports", exact: true }).selectOption("Supports are okay");
  await page.getByLabel("Notes for your teacher").fill("Bolt settings");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("First name").fill("Taylor");
  await page.getByLabel("School", { exact: false }).first().selectOption({ label: "School A" });
  await page.getByLabel("BNTS teacher").selectOption({ label: "Alex" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("2 files", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send for printing" }).click();
  await expect(page.getByRole("heading", { name: /been sent/ })).toBeVisible();
  const records = (
    await page.request.get("http://127.0.0.1:4174/api/admin/submissions").then((r) => r.json())
  ).records.filter((record) => record.firstName === "Taylor");
  expect(records).toHaveLength(2);
  const nut = records.find((record) => record.notes === "Nut settings"),
    bolt = records.find((record) => record.notes === "Bolt settings");
  expect(nut).toMatchObject({ colour: "Blue", scalePercent: 150, copies: 2, supports: "Prefer no supports" });
  expect(bolt).toMatchObject({ colour: "Red", scalePercent: 75, copies: 1, supports: "Supports are okay" });
  expect(nut.dimensionsMm).toEqual([30, 30, 30]);
  expect(bolt.dimensionsMm).toEqual([7.5, 7.5, 7.5]);
  expect(records.every((record) => record.originalName !== "nut-and-bolt.stl")).toBe(true);
});
test("split OBJ objects round-trip through separate 3MF previews", async ({ page }) => {
  let next = 1;
  const obj = [
    ["Nut", cube()],
    ["Bolt", cube(30, 0, 0)],
  ]
    .map(([name, p]) => {
      let output = "o " + name + "\n";
      for (let i = 0; i < p.length; i += 3) output += `v ${p[i]} ${p[i + 1]} ${p[i + 2]}\n`;
      for (let i = 0; i < p.length / 3; i += 3) output += `f ${next + i} ${next + i + 1} ${next + i + 2}\n`;
      next += p.length / 3;
      return output;
    })
    .join("");
  await page.goto("http://127.0.0.1:4174/");
  await page.getByRole("radio", { name: /Advanced/ }).check();
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "assembly.obj", mimeType: "model/obj", buffer: Buffer.from(obj) });
  await expect(page.getByText("This file has 2 separate objects.")).toBeVisible();
  await page.getByRole("button", { name: "Split into separate files" }).click();
  await expect(page.getByText("File 1 of 2", { exact: false })).toBeVisible();
  await expect(page.locator(".file-bar strong")).toContainText("Nut.3mf");
  await expect(page.getByText("No problems found")).toBeVisible();
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(page.locator(".file-bar strong")).toContainText("Bolt.3mf");
  await expect(page.getByText("No problems found")).toBeVisible();
});
