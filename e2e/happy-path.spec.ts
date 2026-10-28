import { expect, test } from "@playwright/test";

test("sample study: verify, review two holds, pay through the PayPal sandbox", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the sample study" }).click();
  await page.waitForURL(/\/studies\/[0-9a-f-]+\/verify$/, { timeout: 120_000 });
  const studyUrl = page.url().replace(/\/verify$/, "");

  await expect(page.getByText("Verification finished.")).toBeVisible({ timeout: 12 * 60_000 });
  const counter = (label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) });
  await expect(counter("Pay")).toBeVisible();
  await expect(counter("Hold for review")).toBeVisible();
  await expect(counter("Don't pay")).toBeVisible();

  await page.goto(`${studyUrl}/review`);
  await page.getByLabel("Your name or initials").fill("E2E Reviewer");
  await page.getByRole("button", { name: "Save" }).click();
  const progress = page.getByText(/^\d+ of \d+ reviewed/);
  await expect(progress).toHaveText(/^0 of (\d+) reviewed/);
  const total = Number(/of (\d+) reviewed/.exec((await progress.textContent()) ?? "")?.[1]);
  for (let index = 0; index < 2; index += 1) {
    await expect(page.getByRole("button", { name: "Pay P", exact: true })).toBeEnabled();
    const heading = page.getByRole("heading", { name: /^Decision for R-/ });
    const ref = (await heading.textContent())?.replace("Decision for ", "") ?? "";
    await page.getByRole("button", { name: "Answers are specific and consistent" }).click();
    await page.locator("body").press("p");
    await expect(page.getByText(`${ref}: Pay recorded.`)).toBeVisible();
    await expect(progress).toHaveText(new RegExp(`^${index + 1} of ${total} reviewed`));
  }

  await page.goto(`${studyUrl}/payouts`);
  await expect(page.getByRole("heading", { name: "1 · Pre-flight checks" })).toBeVisible();
  const send = page.getByRole("button", { name: /^Send \$/ });
  await expect(send).toBeDisabled();
  await page.getByLabel(/Type the study code/).fill("SLEEP-26");
  await expect(send).toBeEnabled();
  await send.dblclick();
  await expect(page.getByText(/Sent \d+ batch/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("cell", { name: /^hon_SLEEP26_[0-9a-f]{8}_1$/ })).toHaveCount(1);

  await expect(async () => {
    await page.getByRole("button", { name: "Refresh statuses" }).click();
    await expect(page.locator(".ag-cell").filter({ hasText: /SUCCESS|UNCLAIMED/ }).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 5 * 60_000, intervals: [10_000] });

  await page.goto(`${studyUrl}/ledger`);
  await expect(page.getByText("The books balance")).toBeVisible();

  for (const tab of ["Rules", "Import", "Verification", "Review", "Payouts", "Ledger", "Ethics report"]) {
    await page.getByRole("navigation", { name: "Study" }).getByRole("link", { name: tab, exact: true }).click();
    await expect(page.getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  }
});
