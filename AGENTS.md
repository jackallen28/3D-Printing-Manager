# Notes for AI coding agents

- Follow [DESIGN.md](DESIGN.md) for every interface change: tokens, components, writing style and the list of things to avoid.
- Use only the tokens in `client/styles.css`. Don't add raw colours, font sizes, spacing values or border radiuses.
- Write interface text for high school students and BNTS teachers: short, plain sentences, "your teacher" rather than "staff", sentence-case headings without full stops, and no em dashes or slogans.
- Don't change stored values in `shared/catalog.js` (they are saved with submissions). Change on-screen wording with `displayLabel` or `staffLabel`.
- Format with `npx prettier@3.3.3 --write <files>` (settings in `.prettierrc.json`).
- Before finishing: `npm test` and `npm run test:e2e`. Look at the screenshots in `test-results/` at desktop and mobile widths.
