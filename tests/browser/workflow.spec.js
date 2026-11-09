import { test, expect } from "@playwright/test";
import { stl, cube, multicolour3mf } from "../fixtures.js";
test("student completes upload; teacher browses, downloads, marks printed and deletes", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Send a file to be 3D printed" })).toBeVisible();
  await page.screenshot({ path: "test-results/student-home.png", fullPage: true });
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "my-robot.stl", mimeType: "application/octet-stream", buffer: stl() });
  await expect(page.getByText("No problems found")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Blue", exact: true })
    .check();
  await page.screenshot({ path: "test-results/student-model.png", fullPage: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("First name").fill("Mia");
  await page.getByLabel("School", { exact: false }).first().selectOption({ label: "BNTS Demo School" });
  await page.getByLabel("BNTS teacher").selectOption({ label: "BNTS Team" });
  await page.getByLabel("Class code").fill("design8");
  await page.getByLabel("Notes for your teacher").fill("Please keep the base flat.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("definition").filter({ hasText: "Mia" })).toBeVisible();
  await page.getByRole("button", { name: "Send for printing" }).click();
  await expect(page.getByRole("heading", { name: /been sent/ })).toBeVisible();
  await page.goto("/teacher");
  await page.getByLabel("Password").fill("local-demo-teacher-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Print requests" })).toBeVisible();
  await page.screenshot({ path: "test-results/teacher-queue.png", fullPage: true });
  await page.getByRole("button", { name: /Mia.*my-robot.stl/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Please keep the base flat.")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download original STL" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^BNTS-Demo-School_BLUE_/);
  await page.getByRole("dialog").getByLabel("Status").selectOption("printed");
  await expect(page.getByRole("dialog").getByLabel("Status")).toHaveValue("printed");
  await page.screenshot({ path: "test-results/teacher-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Delete request" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});
test("3MF preserves multiple source colours and offers separate Bambu selections", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "two-colour.3mf", mimeType: "model/3mf", buffer: multicolour3mf() });
  await expect(
    page.getByRole("group", { name: "Model sections" }).getByRole("button", { name: /Section 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Model sections" }).getByRole("button", { name: /Section 2/ }),
  ).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();
  await page
    .getByRole("group", { name: "Model sections" })
    .getByRole("button", { name: /Section 1/ })
    .click();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Blue", exact: true })
    .check();
  await page
    .getByRole("group", { name: "Model sections" })
    .getByRole("button", { name: /Section 2/ })
    .click();
  await page
    .getByRole("radiogroup", { name: "Available print colours" })
    .getByRole("radio", { name: "Purple", exact: true })
    .check();
  await page.screenshot({ path: "test-results/student-multicolour.png", fullPage: true });
});
test("floating CAD parts are highlighted and invalid file types are rejected", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("no") });
  await expect(page.getByRole("alert")).toContainText("TXT files can’t be uploaded");
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({
      name: "floating.stl",
      mimeType: "application/octet-stream",
      buffer: stl(new Float32Array([...cube(), ...cube(30, 0, 10, 10)])),
    });
  await expect(page.getByText("1 possibly floating part")).toBeVisible();
  await expect(page.getByRole("button", { name: "Highlight floating parts" })).toHaveAttribute("aria-pressed", "true");
  // Warnings must be acknowledged before continuing; clean models need no checkbox.
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByText("I’ve read the model check", { exact: false }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});
test("mobile upload fits viewport and teacher route requires a password", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/student-mobile.png", fullPage: true });
  await page.goto("/teacher");
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not correct");
});

test("OBJ has a 3D preview; STEP uploads without a preview", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({
      name: "triangle.obj",
      mimeType: "model/obj",
      buffer: Buffer.from("v 0 0 0\nv 20 0 0\nv 0 20 10\nf 1 2 3\n"),
    });
  await expect(page.getByText("Check the OBJ surfaces")).toBeVisible();
  await expect(page.locator(".viewer canvas")).toBeVisible();
  await page.getByRole("button", { name: "Change file" }).click();
  await page
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({
      name: "design.step",
      mimeType: "model/step",
      buffer: Buffer.from("ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;"),
    });
  await expect(page.getByText("There’s no 3D preview for this file type.", { exact: false })).toBeVisible();
  await expect(page.getByText("STEP files can’t be checked here.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("First name").fill("Sam");
  await page.getByLabel("School", { exact: false }).first().selectOption({ label: "BNTS Demo School" });
  await page.getByLabel("BNTS teacher").selectOption({ label: "BNTS Team" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("There’s no 3D preview for this file type.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Send for printing" }).click();
  await expect(page.getByRole("heading", { name: /been sent/ })).toBeVisible();
});
