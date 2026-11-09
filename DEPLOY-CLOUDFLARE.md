# Deploy on Cloudflare

This version hosts the site and files in Cloudflare. It does **not** need Google OAuth, Google Drive or Render. The only app secret you enter is the teacher password.

## 1. Prepare the account

1. Sign into [Cloudflare](https://dash.cloudflare.com/).
2. Keep **Workers** on the **Free** plan.
3. Open **Storage & databases → R2** and activate R2. Cloudflare may ask for billing/payment details. R2 has included free usage, but usage beyond it can be billed. Use Standard storage. The app caps its own uploads at 8 GB; other account usage and requests still count towards allowances.

## 2. Connect GitHub and deploy

1. Go to **Workers & Pages → Create application → Import a repository** (the labels may also say **Connect to Git**).
2. Connect GitHub and select **jackallen28/3D-Printing-Manager**.
3. Use:

| Setting | Value |
| --- | --- |
| Worker name | `bnts-print-studio` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | Leave blank — Wrangler runs the build configured in `wrangler.jsonc` |
| Deploy command | `npx wrangler deploy` |

The repository configures `npm run build` as a Wrangler build step, so the default `npx wrangler deploy` command creates `dist` before uploading assets. No committed build folder is needed.

4. Deploy as a **Worker with static assets**, not a Pages-only/static-site deployment. The included `wrangler.jsonc` points to the correct frontend and backend.
5. Current Wrangler automatically creates/binds a private **R2 bucket** (`PRINTS`) and **D1 database** (`DB`). The build dashboard may ask you to approve creating these resources. No bucket/database IDs need to be pasted into the repository.

Cloudflare manages the build's deployment token. It needs **Workers Scripts: Edit**, **Workers R2 Storage: Edit**, and **D1: Edit** permissions for resource provisioning. If the build reports that D1/R2 creation is forbidden, open the build's API token settings (or **My Profile → API Tokens**), add the missing account permission, then retry the build. This token belongs to deployment; do not put it in the site's JavaScript or send it to students.

The first deployment may show a setup message because the staff password is not yet set. No student files are accepted until a valid password, school and staff options are configured.

## 3. Add the teacher password

1. Open the deployed Worker → **Settings → Variables and Secrets**.
2. Add a **Secret** named `TEACHER_PASSWORD` with a unique password of at least 12 characters.
3. Save/deploy the change if Cloudflare prompts you. Set a runtime secret, not just a build variable. Do not prefix it with `VITE_`.
4. Open the Worker's `https://...workers.dev/teacher` address and sign in.
5. In **Setup & supplies**, add schools and staff, optional classes with teacher-chosen class codes, colours and extra formats. Existing classes without a code need one entered before saving. Click **Save setup**.

The database schema and random session signing key are created automatically. There is no folder link, Google login or storage key to configure. Changing the teacher password invalidates existing teacher sessions and pending upload tickets.

## 4. Check storage and cleanup

- In the Worker **Bindings** page, check that `PRINTS` is an R2 bucket and `DB` is a D1 database.
- Keep R2 **Public access / r2.dev disabled**. Do not attach a public domain directly to the bucket. The app serves authorised files through the Worker.
- In the Worker **Settings → Triggers / Cron Triggers**, check that `*/10 * * * *` is present. The configuration deploys it automatically. Cloudflare can take time to propagate a new schedule.
- As a backup, open the bound R2 bucket → **Settings → Object lifecycle rules**. Add a rule for prefix **`submissions/`** that deletes objects after **14 days**. R2 lifecycle deletion usually happens within 24 hours after its expiry time; the Worker's 10-minute schedule is the primary cleanup and also deletes the D1 student details.
- In teacher setup, click **Clean up now** once and check the last-success status.

No GitHub Actions scheduler or Render service is needed. If a previous Render deployment is running, remove its GitHub auto-deploy connection before relying only on Cloudflare. Deleting/revoking old Google access will stop cleanup of any files still in Drive; resolve old submissions separately before removing that access. New Cloudflare uploads do not use it.

## 5. Test before sharing

1. On the student page, check that it says **Up to 50 MB per file**.
2. Upload a small STL, adjust its scale and check the dimensions in mm, choose a colour, and submit it with a first name, school and staff member. Enter a class code if one is provided, or leave it blank.
3. Find it in `/teacher`, check its saved scale/colours, open the preview and download the original. You can also select several files to export them together or change their status.
4. Check that it appears under the expected school/date/class prefix in the private R2 bucket.
5. In **View at home** at the bottom of the student page, select the same school and type the same first name. Open the model.
6. Delete the test submission in the teacher console. Repeat the home lookup; it should say **“This has been deleted.”**

School + first name is deliberately a simple lookup. Anyone with those details can view matching models, and students with identical first names at the same school see the same results. Staff notes, generated filenames and other submission details are not returned. Do not upload private material. The teacher console remains separately password protected.

Share the normal `workers.dev` URL with students. Keep `/teacher` and its password for staff. You can add a custom domain later without changing the storage bindings.

## Updates

Push changes to `main`; Cloudflare's connected build deploys them. Keep the Worker name and `DB`/`PRINTS` bindings unchanged so existing files/settings remain attached. Do not reset the database or create replacement storage for an update. Resources provisioned by the dashboard are visible there even though their IDs are not committed to GitHub.

## Command-line alternative

If you prefer your own computer:

```sh
npm ci
npx wrangler login
npm run deploy
npx wrangler secret put TEACHER_PASSWORD
```

Wrangler opens Cloudflare sign-in. It provisions the resources and writes their IDs/names into your local configuration. Keep that updated configuration if you later switch to Git builds so you reuse the same resources. If the account has multiple Cloudflare accounts, select the intended school account when prompted.

For local development, copy `.dev.vars.example` to `.dev.vars`, set the local password, then run `npm run dev:cloudflare`. Local emulated storage is separate from the live bucket/database.

## Costs and limits

The design uses the Workers Free plan and the included R2/D1 allowances. The app reserves space before accepting an upload and stops when its **8 GB** cap is reached. Pending uploads, thumbnail allowance and completed files all count. It also limits upload creation and home lookups to reduce abuse. This is not a Cloudflare account-wide spending cap: other resources, request usage and policy changes can still create costs. Review Cloudflare's billing/usage page and alerts. R2 is not an unlimited free disk.

Local tests cover the Worker, R2/D1 storage, 50 MB size limit and browser flow. A live deployment still needs the checks in step 5; this repository does not by itself authorise or publish anything in your Cloudflare account.

## If a previous build failed with a missing `dist` folder

Retry deployment using the latest `main` commit. The Wrangler configuration now builds the frontend automatically. Keep the deploy command as `npx wrangler deploy`. If you choose to keep a separate build command in the dashboard, `npm run build` also works, but it is no longer required.
