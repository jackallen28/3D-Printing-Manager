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
5. In **Settings**, add schools and staff, optional classes with teacher-chosen class codes, colours and extra formats. Existing classes without a code need one entered before saving. Click **Save changes**.

The database schema and random session signing key are created automatically. There is no folder link, Google login or storage key to configure. Changing the teacher password invalidates existing teacher sessions and pending upload tickets.

## 4. Check storage and cleanup

- In the Worker **Bindings** page, check that `PRINTS` is an R2 bucket and `DB` is a D1 database.
- Keep R2 **Public access / r2.dev disabled**. Do not attach a public domain directly to the bucket. The app serves authorised files through the Worker.
- In the Worker **Settings → Triggers / Cron Triggers**, check that `*/10 * * * *` is present. The configuration deploys it automatically. Cloudflare can take time to propagate a new schedule.
- As a backup, open the bound R2 bucket → **Settings → Object lifecycle rules**. Add a rule for prefix **`submissions/`** that deletes objects after **14 days**. R2 lifecycle deletion usually happens within 24 hours after its expiry time; the Worker's 10-minute schedule is the primary cleanup and also deletes the D1 student details.
- In teacher setup, click **Clean up now** once and check the last-success status.

No GitHub Actions scheduler or Render service is needed. If a previous Render deployment is running, remove its GitHub auto-deploy connection before relying only on Cloudflare. Deleting/revoking old Google access will stop cleanup of any files still in Drive; resolve old submissions separately before removing that access. New Cloudflare uploads do not use it.

## 5. Test before sharing

1. On the student page, check that it says **Up to 50 MB.** under the upload box.
2. Upload a small STL, adjust its scale, check the dimensions in mm, try Test print and the grey support preview when available, choose a colour, and submit it with a first name, school and staff member. Enter a class code if one is provided, or leave it blank.
3. Find it in `/teacher`, check its saved scale/colours, open the preview and download the original. Check the highlighted areas. You can also select several files to download ZIPs or change their status; large selections show separate ZIP download buttons.
4. Check that it appears under the expected school/date/class prefix in the private R2 bucket.
5. In **Find your uploads** at the bottom of the student page, select the same school and type the same first name. Open the model.
6. Try a file containing two separate objects. Choose **Split into separate files**, set different colours or copy counts, and check that both submissions retain their own settings.
7. Delete the test submission in the teacher console. Repeat the lookup; it should say no files were found.

School + first name is deliberately a simple lookup. Anyone with those details can view matching models, and students with identical first names at the same school see the same results. Staff notes, generated filenames and other submission details are not returned. Do not upload private material. The teacher console remains separately password protected.

Share the normal `workers.dev` URL with students. Keep `/teacher` and its password for staff. You can add a custom domain later without changing the storage bindings.

Before sharing widely, read [Protect the site](#6-protect-the-site).

## 6. Protect the site

The site is public, so expect automated sign-in attempts and spam uploads. These protections are built in and need no setup:

| Protection | What it does |
| --- | --- |
| Wrong-password lockout | 5 wrong passwords from one network blocks sign-in from that network for 15 minutes. 200 wrong passwords an hour across the whole site blocks all sign-ins for the rest of that hour. Correct sign-ins never count. Each wrong attempt also waits 0.4 seconds. |
| Sessions | Signed, HttpOnly, `__Host-` cookies that last 8 hours, with a CSRF token on every change. **Settings → Security → Sign out everywhere** ends every session at once. Changing `TEACHER_PASSWORD` does the same. |
| Activity log | **Settings → Security** lists sign-ins, wrong passwords, deletions, setting changes and upload pauses for 30 days. Each row shows a short network code, so you can tell whether attempts come from one place or many. Raw IP addresses and student names are never stored in it. |
| Upload limits | Each network: 400 files and 5 GB an hour, with up to 150 unfinished uploads (4 GB) at once. Whole site: 1,000 files an hour and 6 GB a day (more if you raise the storage limit). 100 students on one school internet connection sending at the same time stay inside these; see [Large classes](#7-large-classes). IPv6 addresses are grouped by /64, so one connection can't dodge the limits by changing address. Retrying or resuming an upload never counts twice. |
| Pause uploads | **Settings → Uploads → Pause uploads** stops new uploads straight away, with no save needed. Students see a clear message. |
| Class code required | **Settings → Classes → Students must enter a class code to upload**. Only people with a code from a teacher can send files. Every school needs at least one class. |
| Bulk delete | Select requests in the queue and choose **Delete** to remove spam and its files together. |
| Headers | Content Security Policy, HSTS, `X-Frame-Options: DENY`, Permissions-Policy and cross-origin isolation on every page. |

### Recommended: Cloudflare Access for staff (free)

With Access on, staff sign in with their school email (a one-time code, or Google/Microsoft sign-in) before they even see the password box. A leaked password alone is then useless, and the activity log records who signed in. Access is free for up to 50 users.

1. In the Cloudflare dashboard, open **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Add the public hostname of your site twice: once with path `teacher` and once with path `api/admin/*`. If you use a custom domain, add the same two paths for the `workers.dev` hostname too, or turn the `workers.dev` route off under **Workers → your Worker → Settings → Domains & Routes**.
3. Add a policy: **Action: Allow**, **Include: Emails ending in** `@your-school-domain` (or list each staff email).
4. Save, then copy the application's **Audience (AUD) tag**. Your team domain is shown under **Zero Trust → Settings → Custom pages**, for example `bnts.cloudflareaccess.com`.
5. In **Workers → your Worker → Settings → Variables and Secrets**, add `ACCESS_TEAM_DOMAIN` (the team domain) and `ACCESS_AUD` (the tag), then deploy.

Set up the Access application (steps 1 to 4) **before** adding the two variables. Once they're set, the Worker refuses staff pages without a valid Access token, which also protects the `workers.dev` address that Access rules on a custom domain don't cover. **Settings → Security** then shows "School account and password".

### Recommended: Turnstile robot check on uploads (free)

Turnstile is Cloudflare's CAPTCHA replacement. Most students never see it; it only asks for a click when a visitor looks automated. One check covers every file in a request for 30 minutes.

1. In the Cloudflare dashboard, open **Turnstile → Add widget**. Add your site's hostnames, including the `workers.dev` one, and choose **Managed** mode.
2. In the Worker's **Variables and Secrets**, add `TURNSTILE_SITE_KEY` (a plain variable) and `TURNSTILE_SECRET_KEY` (a **Secret**), then deploy.
3. Send a test upload. **Settings → Security** should show "Robot check: On for new uploads".

To try it without real keys, use Cloudflare's test keys: site key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA` always pass. Remove both variables to turn the check off.

### Optional: a dashboard rate-limiting rule

If the site uses a custom domain on a Cloudflare zone, **Security → WAF → Rate limiting rules** can block abusive traffic before it reaches the Worker. The free plan includes one rule. A good one: URI path equals `/api/admin/login`, more than 10 requests in 10 seconds from the same IP, block for 10 seconds. **Security → Bots → Bot Fight Mode** adds further protection. Neither is needed for the built-in limits to work.

### If the site is under attack

1. **Settings → Uploads → Pause uploads.**
2. **Settings → Security → Sign out everywhere**, then change `TEACHER_PASSWORD` in the Worker's secrets.
3. In the queue, search for the spam, select it and choose **Delete**.
4. Check **Settings → Security → Recent activity** to see what happened and from how many networks.
5. Turn on Cloudflare Access and Turnstile if they aren't already on, then resume uploads.

## 7. Large classes

The site is built and tested for **100 students on the same school network uploading at the same time**. An automated test runs this in the Workers runtime: 100 students send 150 files at once (a quarter send a ZIP of three), every upload succeeds, the teacher queue shows all 150, and then all 100 students open **Find your uploads** together without being blocked.

What makes this work:

- **Limits sized for one shared address.** A school sends everyone through one public IP address, so per-network limits leave room for a full year level (see the table above). Sign-in limits only count wrong passwords, so teachers are never affected.
- **Automatic retries.** If a request fails briefly at a busy moment (a dropped connection or a short server error), the page waits a few seconds and tries again, up to three times, with a random delay so a whole class doesn't retry at once. Every step is safe to repeat. Limits are never retried.
- **Time for slow connections.** Each file may take up to 30 minutes to send, enough for 50 MB files while 100 students share the school's connection.
- **A queue that scales.** The teacher console loads up to 5,000 requests and shows them 120 at a time, with **Show more**. The list is built without re-encoding each record, which keeps it inside the Workers free plan's 10 ms CPU limit per request.

### Cloudflare free plan

One student sending one file uses about 8 Worker requests (settings, class check, start, file, preview, finish, lookup, thumbnail). 100 students use about 1,000 of the free plan's 100,000 requests a day. The page itself is served as static files, which don't count.

### Plan your storage

Files stay for 14 days, so storage builds up. A typical school model is 1 to 15 MB. If 100 students send about 10 MB each every school day, you'll hold about 10 GB at once, more than the default 8 GB limit. When storage is full, new uploads stop until older files expire or are deleted, and teachers see a warning in the queue from 80% full.

To raise the limit, add a variable `STORAGE_LIMIT_GB` (for example `30`) in the Worker's **Variables and Secrets**. The first 10 GB of R2 storage is free; beyond that R2 charges about US$0.015 per GB a month, so 30 GB costs about US$0.30 a month. Check current [R2 pricing](https://developers.cloudflare.com/r2/pricing/). The site-wide daily data limit rises with it. You can also delete printed requests you no longer need.

### Before a big session

- Turn on **Students must enter a class code to upload**, so only your students can send files while the site is busy.
- Check **Settings → Storage** has room for the session.
- If the school's internet is slow, ask half the class to send first. Uploads still succeed when everyone sends together; they just take longer.

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
