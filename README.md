# ShiJi

ShiJi is a personal records PWA built with React, TypeScript, and Vite. Records are stored in the browser on the current device. Use the in-app export and import options to move a backup between devices.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the app and deploys it to GitHub Pages when changes are pushed to `main`. It sets the Vite base path from the repository name, so project sites such as `https://OWNER.github.io/REPOSITORY/` load their assets and PWA icons correctly. The `OWNER.github.io` user site uses the domain root.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The deployed URL appears in the workflow run and in the repository's Pages settings.

The web app manifest supports adding ShiJi to an iPhone Home Screen. The current app does not cache pages for offline use, and records remain local to each device/browser unless exported and imported.

## Contributors

- **Mingyu Hu** — Creator, design, development, and testing.
- **OpenAI Codex** — AI-assisted development, implementation,
  debugging, and documentation.
