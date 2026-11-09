# Legacy option: deploy on Render

**The current recommended deployment is Cloudflare**, with private R2 storage and no Google connection. See [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md). The instructions below are retained for the older Google Drive backend.

Use this option for **files up to 50 MB**. The Apps Script version has a 10 MB limit set by this app, and is intended for smaller uploads.

Render's **Free web-service plan** can run this site. No paid Render disk or paid Render cron job is required. Free services sleep when idle and have usage limits, so the first visit after a period of inactivity may be slower. Files and settings live in Google Drive, using that account's storage allowance. The app uses GitHub Actions for scheduled cleanup while Render is asleep. Stay within Render, Google and GitHub's free allowances.

You do not give the site your Google password, and you do not need to share any credentials in chat. You will configure the connection directly in Google and Render. A school IT administrator can handle the Google setup if needed.

## 1. Put the project on GitHub

Push the project files to `jackallen28/3D-Printing-Manager`, including `render.yaml`, `package.json`, `package-lock.json`, `server`, `shared`, `client`, and the other source/configuration files. Do not push `.env`, local student data, passwords or tokens. The GitHub repository needs the code before Render can deploy it.

## 2. Create the Google connection

This is a one-time setup. It allows the server to use a school Google account after that account approves access.

1. Open [Google Cloud Console](https://console.cloud.google.com/) using the school account. Create or select a project named **BNTS Print Studio**.
2. Enable the **Google Drive API**. This API setup does not require enabling paid Google Cloud hosting.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**). Set the app name and contact details.
4. If your Workspace organisation offers **Internal**, choose it. Only the account connecting Drive needs to approve this app; students do not use Google sign-in. Your school administrator may need to approve Drive access.
5. Create an **OAuth client** of type **Web application**. Keep its client ID and client secret for the Render settings below. These belong to the app; they are not your Google password.
6. Leave this page available. You will add the exact redirect URL after Render gives you the site's address.

If you must use an External OAuth app, follow Google's consent/verification requirements. External apps left in **Testing** can issue refresh tokens that expire after seven days. That is unsuitable for unattended term-long uploads and deletion; use the appropriate Internal or production configuration before relying on the site.

## 3. Create the free Render service

1. Sign in at [Render](https://dashboard.render.com/), connect GitHub, and choose **New → Blueprint**.
2. Select `jackallen28/3D-Printing-Manager`. Render reads the included `render.yaml`.
3. Confirm the web service's plan is **Free**. The blueprint already selects it. Do not add a paid disk or cron service.
4. Fill in these private environment values when requested:

| Setting | Value |
| --- | --- |
| `TEACHER_PASSWORD` | A unique staff password of at least 12 characters. |
| `GOOGLE_CLIENT_ID` | Client ID from Google. |
| `GOOGLE_CLIENT_SECRET` | Client secret from Google. |
| `PUBLIC_URL` | The site's HTTPS address, with no trailing slash. |

Render generates `SESSION_SECRET` and `CLEANUP_SECRET`. The blueprint sets the remaining runtime values and build/start commands. You add the Google refresh token after connecting in step 5.

If Render has not assigned the site's address yet, temporarily use `https://example.invalid` for `PUBLIC_URL`, deploy once to obtain the address, then replace it in **Environment** and redeploy. Do not connect Google until the correct address is saved.

The build command is `npm ci && npm run build`. The start command is `npm start`. The Node backend serves both the site and its private API; do not create a separate Render Static Site.

## 4. Finish the Google redirect setting

In the Google OAuth client's **Authorised redirect URIs**, add:

```text
https://YOUR-SITE.onrender.com/api/admin/google/callback
```

Replace the example domain with the exact address in Render's `PUBLIC_URL`. Save it. This is the server endpoint Google returns to after the school account approves access.

## 5. Connect the account and choose the folder

1. Open `https://YOUR-SITE.onrender.com/teacher` and sign in with `TEACHER_PASSWORD`.
2. Open **Setup & supplies → Connect Google Drive**.
3. Google opens its own sign-in/approval page. Sign into the school account that can add and delete files in the printing folder, then approve access. Google sends an authorisation code to the server, which exchanges it for access and refresh tokens.
4. Back in setup, click **Copy new refresh token**. Add it as `GOOGLE_REFRESH_TOKEN` in **Render → Environment**. Keep it private. Save and redeploy. This lets the connection survive free-service restarts; the server refreshes short-lived access tokens automatically.
5. Return to the teacher console and sign in again if necessary. The connection should show **Connected**, with no token persistence notice.
6. Paste the shared Google Drive folder link. Add schools, staff, optional classes, colours and any extra file types, then click **Save setup**.

Keep the Drive folder **Restricted**, shared only with staff. The account that approved the connection must be able to add and permanently delete its files. For a Workspace Shared Drive, use a suitable role such as Content manager. A folder link alone does not grant these permissions. The app never makes the folder public.

The refresh token allows continuing access to the connected account, so protect it like a password. Students cannot see it. To remove the connection, revoke the app in the Google account's security settings and remove its token from Render.

## 6. Enable free scheduled deletion

Render's free service sleeps, so its internal hourly timer cannot be the only cleanup mechanism.

In the GitHub repository's **Settings → Secrets and variables → Actions**:

- Add variable `ENABLE_NODE_CLEANUP` = `true`.
- Add secret `PRINT_STUDIO_URL` = your Render HTTPS address.
- Add secret `PRINT_CLEANUP_SECRET` = the value of `CLEANUP_SECRET` in Render. Do not use the teacher password.

The included **Delete expired print submissions (Node hosting only)** workflow runs hourly. Use **Actions → that workflow → Run workflow** once to check it works. It wakes the service and asks it to permanently delete expired submissions. GitHub's schedule is best effort and may be disabled for inactive repositories, so check its execution history and the cleanup status in teacher setup. Use a repository with an available free Actions allowance.

## 7. Check the site before sharing it

1. Submit a small STL from the student page and confirm its receipt.
2. Find it in the teacher console, open its preview, and download the original.
3. Confirm the file, preview and details appear under the correct school/date/class in Drive.
4. Check that the student page says **Up to 50 MB per file**.
5. Check that the GitHub cleanup workflow succeeds and teacher setup shows a successful cleanup time.

Files are accepted up to 52,428,800 bytes. Temporary disk files are removed after processing; completed originals, previews and details are stored in Drive. Files over the maximum are rejected. Complex models can exceed the preview's safety limits even if they fit within the upload size limit; detailed mesh checks above 200,000 triangles are explicitly skipped. STEP and other non-preview formats upload without model checks.

School IT may need to approve the Google connection or hosting domains. The local tests validate uploads and the storage API adapter; a real Google/Render deployment still needs the checks above.
