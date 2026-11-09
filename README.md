# BNTS 3D Print Studio

A student file uploader and teacher console for Banyule Nillumbik Tech School. The site uses the supplied BNTS pixel mark and the teal accent from [Circuit Pathways](https://github.com/jackallen28/BNTS_Circuit_Pathways). Interface and writing rules, including what to avoid, are in [DESIGN.md](DESIGN.md).

**Deploy on Cloudflare Workers with private R2 storage. No Google account, Drive folder, OAuth client or Google tokens are needed.**

[Cloudflare deployment instructions](DEPLOY-CLOUDFLARE.md)

## Student site

- Drag and drop or choose a file, up to **50 MB** (52,428,800 bytes).
- Preview STL, OBJ and 3MF in 3D; PLY previews can also be enabled by staff.
- Scale the model up or down (1–1000%) in the viewer. Dimensions and the 10 mm reference grid always use millimetres.
- Select a model part or joined colour **section** and choose **one** colour. A new choice replaces its previous choice; tried colours are not kept as additional selections. Students select a part in the list, or click it on the model, then choose its colour. OBJ objects, material groups and small disconnected mesh components can be coloured separately. Multi-colour 3MF colour areas are selectable too. Most prints use one colour unless arranged otherwise.
- Ask for a **special filament** (stored as `Advanced filament — request only`), describe it, and see a speckled purple preview. This is a visual placeholder, not a promise that a particular filament is stocked.
- Review warnings about possible floating parts, disconnected parts, mesh errors and model size. Floating areas are red, thin areas are yellow, possible support areas are grey, separate pieces have outlines, and open/problem edges have red lines. These highlights are also available in teacher and home previews.
- Click the grey **About supports** card to **Show supports**. Temporary grey pillars show how an overhang could be held up, and speckled contact patches illustrate a potentially rough underside after removal. The viewer moves to a lower angle to show these surfaces. Supports are information and do not count as a failed test; the preview can be toggled from student, teacher and home viewers.
- Files with multiple imported objects or disconnected pieces offer **Split into separate files** or **Keep as one file**. Converted objects are reviewed one at a time, each with its own scale, colour, supports, printer, quality, copies, notes and design link. First name, school, staff and class code are entered once for the batch. Up to 20 files can be reviewed together.
- Use **Test print** to watch a trial layer preview. Clearly floating pieces turn red and fall away. Possible failures show no more than three short action points, including consulting a teacher. Stop/replay is available; changing the model, scale or colours clears the old result.
- If the model check finds problems, the student ticks one box to confirm they've read them before continuing. Clean models need no checkbox.
- Enter first name, school, BNTS teacher and an optional class code. Entering a valid code joins the selected school’s class; blank means no class. Codes are case-insensitive and are validated on the server.
- Choose the number of copies and add notes. Supports, printer, quality and a design link are under **More options**, since most students leave them as they are.
- Review and select **Send for printing**. A receipt appears only after both the model and thumbnail are stored and the submission is complete.

STL, OBJ, STEP (`.step` / `.stp`), 3MF and ZIP archives are always accepted. Staff can enable PLY, OFF, IGES, BREP, Fusion 360, Blender and G-code. ZIP archives are extracted in the browser: only enabled CAD formats are kept; images, documents, scripts, system files, nested ZIPs and G-code are ignored. Up to 20 CAD files and 50 MB of extracted CAD data are allowed. Each model is reviewed with its own scale, colour and print settings, then one student form submits the batch as individual files. ZIP archives themselves are rejected by the upload API and are never stored. Types without a viewer display **“Preview not supported for this file type.”** and still upload normally.

The original file is preserved when submitted without conversion. When students choose to split objects, only the new separate files are submitted. STL objects remain STL; OBJ, PLY and 3MF objects become separate 3MF files to retain colour sections. Each object is centred in X/Y and placed at Z=0. Splitting does not repair or join surfaces. Supports and rough contact patches are educational previews; they are not written into the CAD files or final slicer settings. Chosen scale, dimensions, colours and print settings are saved as requests for staff to apply in the slicer; the app does not modify, repair, slice or execute the file. Slicer-specific 3MF painted facets and textures may not render accurately; detected unsupported features are explained. STL, OBJ and PLY assume millimetres and Z-up. Separate OBJ material files are not loaded.

Model checks run in the browser and are advisory. OBJ checks allow normal separate colour sections, shared interfaces and small seams; substantial openings and clearly detached sections still warn. Touching bounds are treated conservatively as potential support for OBJ, and the UI makes clear that staff must check the result. STL/3MF thickness checks sample up to 2,000 surface points with inward rays and inspect separate-part dimensions; areas below **0.8 mm at the requested scale** are highlighted. Small or complex features can be missed, and printability also depends on nozzle, settings and supports. The Test print animation illustrates layer order and detected loose parts; it does not generate toolpaths or simulate material strength, extrusion or full slicer support planning. The trial animation is limited to models with completed checks and at most 64 components. A clear message directs students to staff when it is unavailable. Detailed topology checks are skipped above 200,000 triangles with an explicit notice. The Cloudflare server validates allowed types, declared/actual byte lengths, preview signature and form options; it streams originals to private storage without parsing large CAD files on the server. Staff must check originals in an appropriate CAD app/slicer.

## Find your uploads

A section at the bottom of the student page lets students choose their school and enter their first name. Matching models and their upload dates appear. A model opens in the 3D viewer when supported. If nothing matches, the page says no files were found and suggests checking the spelling, since files are removed after 14 days. An expired or removed model shows **“This file has been deleted.”** if an old view is opened.

**School and first name are a lookup, not authentication.** Anyone who knows these details can find matching models. Students with the same first name at the same school see the same matches. The UI explains this. Results contain original file names, dates and numeric preview settings (scale, colour swatches and glitter areas); staff details, notes, design links, generated filenames and other form information are not returned. A browser that can render a model can obtain its original bytes, so this is not a way to keep model content secret from someone who knows the lookup details.

Lookups are rate limited, and short-lived view tokens restrict access to the matching school/name. A live database check blocks expired/deleted files even before scheduled cleanup runs. The teacher console remains password protected. For stricter privacy, a receipt code would be needed in addition to the requested school/name fields.

## Teacher console

Open `/teacher` and sign in with the staff password configured in Cloudflare. No teacher link appears in the student navigation.

- Add/remove schools, staff and school-specific classes. Choose any printable class code up to 80 characters; codes must be unique within a school. Existing classes have an editable code field and need a code before setup is saved. Codes are not included in the public configuration.
- Select available PLA colours, allow custom requests and enable extra formats.
- All requests show as soon as you sign in. Filter by status (All, Queued, Printing, Printed, each with a count), school, class (including **No class**) and colour; search by name, file or note; sort by date, name, colour or size.
- Open a request to see a larger preview and every setting with a clear label, download the original and change its status.
- Select multiple files to change their status in bulk or download them as a ZIP. Bulk exports contain original CAD files plus **Print settings.csv**, with scales, mm dimensions, per-part colours and staff notes. Exports use normal browser downloads, without requesting file-editing access. Large selections are divided into ZIPs containing up to 150 MB of original model data each; teachers download each ZIP from the download dialog. Files with identical names remain separate in archive folders.
- Delete a request permanently, view storage use and run clean-up manually.
- Settings shows **You have unsaved changes** in a save bar that stays on screen until you save or discard.
- Download the example test files from **Settings → Test files** to try the student page.

There is no Google connection screen on the Cloudflare deployment. Student uploads become available after the teacher has added at least one school and teacher and saved settings.

## Storage and retention

Cloudflare provides the site/worker, a private **R2** bucket for originals/thumbnails, and a private **D1** database for settings, submission details, upload reservations and short-lived security records. Bindings are provisioned automatically on deployment. Database tables initialise automatically. No separate storage access keys are needed.

Object keys group files by school, Melbourne date and optional class:

```text
submissions/
  School-name--school-id/
    YYYY-MM-DD/
      submission-id/School_WHITE_Date_FirstName.stl
      ...stl.preview.png
      Class-name--class-id/
        submission-id/School_WHITE_BLUE_Date_FirstName.3mf
        ...3mf.preview.png
```

No class folder or “no class” text is added when no class is selected. Download filenames contain only **School_COLOUR1_COLOUR2_Date_FirstName.ext** (one or more colour labels), for example `School_WHITE_2026-11-09_Mia.stl`. Colours use short uppercase labels: Jade White becomes WHITE, Bambu Green becomes GREEN, and multiple requested colours are listed in order, for example `School_WHITE_BLUE_2026-11-09_Mia.obj`. Repeated colour labels appear once, and colours that were replaced are omitted. Very long school/student labels are shortened to keep the filename within 240 UTF-8 bytes while retaining every colour label. Class, staff, supports, printer, scale and notes are not added to filenames. R2 uses a separate submission ID folder to prevent collisions without changing the download name. Full settings and comments are stored in D1 and shown to staff; bulk exports also include the print-settings CSV.

An atomic **8 GB cap** counts completed and pending uploads, including thumbnail allowance. New submissions stop when capacity is reached. Model uploads stream directly into R2 instead of retaining a 50 MB file in worker memory. Tickets are scoped to one submission, retries reuse the request ID, and originals are conditionally created to prevent overwriting completed content.

Files expire after 14 days, regardless of print status. Every **10 minutes**, a Cloudflare Cron Trigger removes expired originals, thumbnails and submission rows. Incomplete uploads expire after one hour and are also cleaned up. Each cleanup processes up to 50 submissions to bound work on the free Workers plan; further batches run on subsequent checks. Expired files are hidden immediately. Cleanup is retried after failures and its status is visible to teachers. Configure the documented R2 lifecycle rule as a backup. Deletion is scheduled, not guaranteed at the exact second of expiry.

Keep the bucket private and dedicated to this app. Do not use `r2.dev` public access or a public bucket domain. Do not manually delete/edit the D1 rows, reset the database, change storage bindings, or copy files into the bucket without updating accounting: those changes bypass quota/retention tracking. Files exported outside the app are outside its deletion controls.

## Free-tier costs

Use the **Workers Free** plan and **R2 Standard** storage. Cloudflare's published R2 free allowance includes 10 GB-month of storage plus request allowances; D1 and Workers also have free limits. The app's 8 GB cap leaves storage headroom but does **not** guarantee the whole Cloudflare account will have no charges: R2 is a billing-enabled service, request usage and other buckets/apps count, and allowances can change. Cloudflare may require billing/payment details to activate R2. Review the account's usage and alerts. No paid Worker subscription is required by this design.

See [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Development and checks

Use Node 22 or newer:

```sh
npm ci
cp .dev.vars.example .dev.vars
# Set a unique local TEACHER_PASSWORD (12+ characters) in .dev.vars.
npm run dev:cloudflare
```

Wrangler runs local R2 and D1 emulators; this does not connect to production storage. Open the address Wrangler prints, then `/teacher` to add local school/staff options. Real student files should not be used in development. `.dev.vars` and `.wrangler/` are ignored by Git.

```sh
npm run build:cloudflare   # Type check, client build and offline Worker bundle validation
npm test                  # Build + domain/geometry/API/Cloudflare/legacy service tests
npm run test:e2e           # Build + real Chromium student/teacher/home-view flows
npm run deploy            # Deploy to the authenticated Cloudflare account
```

Cloudflare tests run against the actual local Workers runtime with R2/D1 emulators, including a 50 MB upload, concurrent quota reservations, private downloads, scoped home viewing, expiry and scheduled cleanup. They do not establish that a live Cloudflare account is configured. Complete the live smoke test in the deployment guide before sharing the site.

The repository retains the older Node/Google Drive and Apps Script implementations for reference. Their setup is in [legacy hosting documentation](docs/LEGACY-HOSTING.md); the Node option's `.env.example`, Render blueprint and GitHub cleanup workflow are not needed for Cloudflare. Existing Drive submissions are not automatically migrated to R2. Existing stored submissions keep their original names and class assignments; the new filename pattern applies to new submissions.
