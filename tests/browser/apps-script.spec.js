import { test, expect } from "@playwright/test";
import { stl } from "../fixtures.js";
test("single-file Apps Script app works inside an iframe using google.script.run", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/__gas-frame");
  const app = page.frameLocator("iframe");
  await expect(app.getByRole("heading", { name: "Send a file to be 3D printed" })).toBeVisible();
  await expect(app.getByText("Up to 10 MB.", { exact: false })).toBeVisible();
  await app
    .getByLabel("Upload a 3D printing file")
    .setInputFiles({ name: "gas-cube.stl", mimeType: "model/stl", buffer: stl() });
  await expect(app.getByText("No problems found")).toBeVisible();
  await app.getByRole("button", { name: "Continue" }).click();
  await app.getByLabel("First name").fill("Ava");
  await app.getByLabel("School", { exact: false }).first().selectOption({ label: "School A" });
  await app.getByLabel("BNTS teacher").selectOption({ label: "Alex" });
  await app.getByRole("button", { name: "Continue" }).click();
  await app.getByRole("button", { name: "Send for printing" }).click();
  await expect(app.getByRole("heading", { name: /been sent/ })).toBeVisible();
  await page.goto("/__gas-frame?teacher=1");
  const teacher = page.frameLocator("iframe");
  await teacher.getByLabel("Password").fill("local-demo-teacher-password");
  await teacher.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(teacher.getByRole("heading", { name: "Print requests" })).toBeVisible();
  await teacher.getByRole("button", { name: /Ava.*gas-cube.stl/ }).click();
  await expect(teacher.getByRole("dialog")).toBeVisible();
  await expect(teacher.locator(".viewer canvas")).toBeVisible();
  await teacher.getByRole("button", { name: "Close" }).click();
  await teacher.getByRole("button", { name: "Settings" }).click();
  await expect(teacher.getByText("No Drive keys or tokens are needed.", { exact: false })).toBeVisible();
  await expect(teacher.getByText("GOOGLE_CLIENT_SECRET", { exact: false })).not.toBeVisible();
  await expect(teacher.getByRole("checkbox", { name: /IGES/ })).not.toBeChecked();
  await teacher.getByRole("checkbox", { name: /IGES/ }).check();
  await teacher.getByRole("button", { name: "Save changes" }).click();
  await expect(teacher.getByText("Settings saved. The upload page now uses these options.")).toBeVisible();
  expect(errors).toEqual([]);
});
