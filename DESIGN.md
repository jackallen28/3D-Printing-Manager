# Design rules

These rules keep BNTS 3D Print Studio clear, calm and consistent. Read them before changing the interface. If a change needs a new colour, size or spacing value, add it as a token in `client/styles.css` and record it here first.

## Who it's for

- **Students** (mostly high school) upload a file, check it, choose a colour and send it. Many use it once. They should never need to read instructions twice.
- **BNTS teachers** check requests, change their status and download files. They come back every day and want to see what's waiting straight away.

Design for a student on a school laptop with a short attention span, and for a busy teacher between classes.

## Tokens

All values live as CSS custom properties at the top of `client/styles.css`. Don't use raw values in components.

| Area | Rule |
| --- | --- |
| Spacing | 4 point scale only: 4, 8, 12, 16, 24, 32, 48, 64 (`--s1` to `--s8`). |
| Radius | `--radius` (8px) for every card, panel, button, input and badge. `--radius-inner` (4px) only for an element nested inside another rounded element. Circles only for colour swatches, step numbers and spinners. |
| Type | One family: Atkinson Hyperlegible Next, self-hosted. It was designed by the Braille Institute for legibility, which suits a school audience. Sizes: 13, 14, 16, 18, 26, 32px. Nothing smaller than 13px. Body text is 16px. Weights: 400 for text, 600 for labels and headings, 700 for page titles only. |
| Colour | Dark surfaces (`--bg`, `--surface`, `--surface-2`), one accent (BNTS teal `--accent`), and three status colours (success, warning, danger). Purple appears only in the BNTS logo, the drifting background squares, and as the preview colour for special filament, where it carries meaning. |
| Depth | Panels are flat with a 1px border. The only shadow is `--shadow-overlay`, used for modals and the sticky save bar. |
| Motion | Hover changes colour or border only, never position or size. The only animations are spinners, skeleton loaders, the progress bar and the background squares. Everything respects `prefers-reduced-motion`. |
| 3D viewer motion | Rotating and zooming ease to a stop (light damping). Reset view and Show supports glide the camera over 550 ms with an ease-in-out curve; when the device has reduce motion turned on, they jump instead. The test print always plays, because it shows the student what will happen. It must hold 60 fps: compile shaders before it starts, never change a material's shader mid-animation, and never allocate per vertex in a frame or a colour change. There is no in-app motion toggle; the device setting decides. |
| Background | Flat `--bg` with slow drifting squares behind the content (`.sky` in `Layout.tsx`). They echo the BNTS pixel mark, use the logo colours at 11% opacity, and stay behind solid panels so they never reduce readability. This is a deliberate brand element: keep it subtle, and don't add more background effects. |
| Layout | Content width is 1080px; the student landing and success pages use 720px. Text is left-aligned. Forms use a two-column grid on desktop and one column on phones. Every page must work at 320px wide with no sideways scrolling. |

## Components

- **Buttons:** one primary button per step, on the right. Secondary actions use `.button.secondary` or `.text-button`. Buttons are at least 44px tall.
- **Fields:** use the `Field` component when a control has a hint or is optional. It keeps the label short and links the hint with `aria-describedby`. Mark optional fields, not required ones.
- **Loading:** every action that waits on the network shows a spinner in its button and changes its label ("Sending…", "Saving…"). Lists and thumbnails show skeletons, and fall back to an icon if loading fails.
- **Empty states:** say what's missing and what to do next, with a working button where possible.
- **Errors:** say what went wrong and how to fix it, in one or two short sentences.

## Writing

- Use plain words a Year 7 student understands. Say "your teacher", not "staff" or "the printing team".
- Headings are sentence case, with no full stop and no gradient or highlighted words.
- One instruction per sentence. Lead with the action: "Choose a file", "Send for printing".
- No taglines, slogans or filler. Say what the page does.
- No em dashes in interface text. Use a full stop or a comma.
- Don't use "it's not X, it's Y" constructions.
- Stored values (such as `Advanced filament — request only`) are part of saved data and validation. Change what people see with `displayLabel` or `staffLabel` in `shared/catalog.js`, not the stored value.

## Things to avoid

These are common signs of a rushed, "vibe-coded" interface. Don't add them.

### Colour and visual effects

- Purple or indigo gradients, purple glows, purple hover fills or purple text shadows when purple isn't part of the brand.
- Dark-mode glows, meaningless radial orbs or blurred colour blobs behind content.
- Neon palettes or several competing saturated colours with no clear hierarchy.
- Gradient text in headings.
- Pure white backgrounds, heavy drop shadows, dot grids, or glass and blur effects on everything.
- Semi-transparent headers with blur that clash with scrolling content.
- Many different border radiuses on the same page.

### Layout and components

- Predictable rows of three feature cards, three-tier pricing tables and bento grids.
- Cards nested inside cards.
- Huge icons with tiny text.
- Components that change size, padding or alignment from page to page.
- Misaligned grids, uneven spacing or sticky elements that drift.
- Hero sections overloaded with a badge, gradient, two buttons, an animation and a background image.
- Floating builder badges ("Made with…", "Edit with…") or default builder domains.

### Decoration

- Sparkle icons or sparkle emoji, especially in headings and buttons.
- Emoji used as icons, bullets or in headings.
- Random decorative status dots (such as a "live" dot that means nothing).
- Extra floating shapes, orbs or looping animations beyond the single drifting-squares background described above.
- Hover effects that lift, rotate, bounce or scale cards and buttons.
- Animations that wiggle, overshoot, stutter or start too early, and scroll-jacking.

### Typography

- Overused fonts chosen by default, such as Inter, Poppins, Montserrat, Roboto, Fraunces or Space Grotesk.
- Very heavy headings paired with thin, light body text.
- Oversized headings with small body text.
- Inconsistent line heights or spacing between text blocks.
- All-caps headings and wide letter-spaced labels used for style.

### Copy

- Generic inspirational lines such as "Launch faster", "Build your dreams", "Create without limits" or "The future of…".
- Buzzword stacking, and no clear statement of what the page does.
- Excessive em dashes, and repeated "it's not X, it's Y" statements.
- Fake testimonials with generic names, missing details or repeated AI-generated portraits.
- Slightly wrong footer text ("All right reversed", "Made by Me").
- Placeholder or test text left in the final interface.

### Interaction and technical

- Buttons, toggles, tabs, accordions, carousels or modals that don't work.
- Social icons that link to `#` or a home page.
- Missing loading states: buttons that don't respond while waiting, no skeletons, blank gaps while data loads.
- Selected states that are hard to see (tabs, filters, chosen colours).
- Slow or frozen actions with no feedback.
- Missing page title, description or favicon.
- Layouts that break on mobile: overflowing text, buttons wider than the screen, sideways scrolling.
- Leftover builder scripts, watermarks or badges in the source.

## How to keep it this way

- Change tokens, not one-off values. If something needs a new value, question it first.
- Before shipping, check every screen at 390px and 1440px wide, and test every button, link and form.
- Run `npm run test:e2e`. The browser tests walk the full student and teacher flows, including mobile widths.
- Compare against real, well-made products rather than inventing new patterns.
- Prefer removing an element to adding a new one.
