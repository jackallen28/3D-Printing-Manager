import { test, expect } from "@playwright/test";
import { stl } from "../fixtures.js";

const CF = "http://127.0.0.1:4174";

async function signIn(page) {
  await page.goto(CF + "/teacher");
  await page.getByLabel("Password").fill("local-demo-teacher-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Print requests", exact: true })).toBeVisible();
}
async function sendFile(page, base, firstName, fileName) {
  await page.goto(base + "/");
  await page.getByLabel("Upload a 3D printing file").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: stl(),
  });
  await expect(page.getByText("No problems found")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("School", { exact: false }).first().selectOption({ label: "School A" });
  await page.getByLabel("BNTS teacher").selectOption({ label: "Alex" });
  await page.getByRole("button", { name: "Continue" }).click();
}

test("teachers can pause uploads instantly, see activity and delete spam in bulk", async ({ page, context }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Pause uploads" }).click();
  try {
    await expect(page.getByRole("region", { name: "Uploads" }).getByText("Paused", { exact: true })).toBeVisible();
    // Students see a clear message and can't start an upload.
    const student = await context.newPage();
    await student.goto(CF + "/");
    await expect(student.getByText("Uploads are paused right now.", { exact: false })).toBeVisible();
    await expect(student.getByRole("button", { name: "Choose a file" })).toBeDisabled();
    await student.close();
    // The queue shows a reminder that uploads are paused, with a way to resume.
    await page.getByRole("button", { name: /Print queue/ }).click();
    await expect(page.getByText("Uploads are paused.", { exact: false })).toBeVisible();
  } finally {
    await page.getByRole("button", { name: "Resume uploads" }).first().click();
  }
  await expect(page.getByText("Uploads are paused.", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  const activity = page.getByRole("region", { name: "Security" }).locator(".activity-list");
  await expect(activity).toContainText("Signed in");
  await expect(activity).toContainText("Uploads paused");
  await expect(activity).toContainText("Uploads resumed");

  // Two spam uploads, removed together.
  for (const name of ["spam-one.stl", "spam-two.stl"]) {
    const student = await context.newPage();
    await sendFile(student, CF, "Spammer", name);
    await student.getByRole("button", { name: "Send for printing" }).click();
    await expect(student.getByRole("heading", { name: /been sent/ })).toBeVisible();
    await student.close();
  }
  await page.getByRole("button", { name: /Print queue/ }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("searchbox", { name: "Search requests" }).fill("Spammer");
  await expect(page.locator(".print-card")).toHaveCount(2);
  await page.getByLabel("Select all files").check();
  await page.locator(".bulk-actions").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deleted 2 requests." })).toBeVisible();
  await expect(page.locator(".print-card")).toHaveCount(0);
});

test("sign out everywhere ends the current staff session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("with the robot check on, students pass it once and then send", async ({ page }) => {
  // Stand in for Cloudflare's Turnstile script: the widget immediately reports a passing token.
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = { render(el, options) { setTimeout(() => options.callback("pass"), 300); return "w"; }, remove() {} };`,
    }),
  );
  await sendFile(page, "http://127.0.0.1:4175", "Robin", "robot-check.stl");
  const send = page.getByRole("button", { name: "Send for printing" });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole("heading", { name: /been sent/ })).toBeVisible();
});

test("a failing robot check keeps the send button off and offers a retry", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = { render(el, options) { setTimeout(() => options.callback("fail"), 100); return "w"; }, remove() {} };`,
    }),
  );
  await sendFile(page, "http://127.0.0.1:4175", "Robin", "robot-check.stl");
  await expect(page.getByText("The robot check didn’t pass.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send for printing" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
