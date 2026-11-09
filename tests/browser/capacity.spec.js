import { test, expect } from "@playwright/test";
import { stl } from "../fixtures.js";

const CF = "http://127.0.0.1:4174";

test("a brief server hiccup during a busy lesson is retried and the upload still goes through", async ({ page }) => {
  let failures = 0;
  // The first two attempts to start the upload hit a brief server error, as can happen at a busy moment.
  await page.route("**/api/uploads/init", async (route) => {
    if (failures < 2) {
      failures++;
      await route.fulfill({ status: 503, json: { error: "Storage is unavailable.", retry: true } });
    } else await route.continue();
  });
  await page.goto(CF + "/");
  await page.getByLabel("Upload a 3D printing file").setInputFiles({
    name: "busy-lesson.stl",
    mimeType: "application/octet-stream",
    buffer: stl(),
  });
  await expect(page.getByText("No problems found")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("First name").fill("Quinn");
  await page.getByLabel("School", { exact: false }).first().selectOption({ label: "School A" });
  await page.getByLabel("BNTS teacher").selectOption({ label: "Alex" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send for printing" }).click();
  await expect(page.getByRole("heading", { name: /been sent/ })).toBeVisible({ timeout: 20000 });
  expect(failures).toBe(2);
});

test("a fortnight of requests from a large class shows a page at a time", async ({ page }) => {
  // Make one real request look like 250, as a busy fortnight would.
  await page.route("**/api/admin/submissions", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const sample = body.records[0];
    body.records = Array.from({ length: 250 }, (_, i) => ({
      ...sample,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      firstName: "Student",
    }));
    await route.fulfill({ response, json: body });
  });
  await page.goto(CF + "/teacher");
  await page.getByLabel("Password").fill("local-demo-teacher-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Print requests", exact: true })).toBeVisible();
  await expect(page.locator(".print-card")).toHaveCount(120);
  await page.getByRole("button", { name: "Show more (130 more)" }).click();
  await expect(page.locator(".print-card")).toHaveCount(240);
  await page.getByRole("button", { name: "Show more (10 more)" }).click();
  await expect(page.locator(".print-card")).toHaveCount(250);
  await expect(page.getByRole("button", { name: /Show more/ })).toHaveCount(0);
});
