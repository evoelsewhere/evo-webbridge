# Chrome Web Store release pipeline

The release workflow packages this Manifest V3 extension, optionally uploads a
draft, and can submit it for review. A pushed version tag also creates a GitHub
release containing the exact ZIP sent to the store.

## One-time Chrome Web Store setup

1. Enable two-step verification on the Google account that owns the extension.
2. Create the item in the Chrome Web Store Developer Dashboard and complete its
   Store listing and Privacy tabs. The API only updates an existing item. Use a
   ZIP created by `scripts/package-extension.sh`; it omits the development-only
   `key` because Chrome Web Store rejects that manifest field.
3. Copy the item ID assigned by the Developer Dashboard. If it differs from the
   development ID `lghglpnddenmebbhkfachafichhglafi`, retrieve the Store public
   key from the item's **Package** section and reconcile `manifest.json` and the
   Native Messaging allowed origin before shipping the Store build. Store and
   unpacked builds must ultimately use the same ID for Native Messaging to work.
4. In a Google Cloud project, enable **Chrome Web Store API**, configure an OAuth
   consent screen, and create a Web application OAuth client. Add
   `https://developers.google.com/oauthplayground` as an authorized redirect URI.
5. In [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), use
   that client ID and secret, authorize the
   `https://www.googleapis.com/auth/chromewebstore` scope with the account that
   owns the item, then exchange the authorization code for a refresh token.
   OAuth apps left in Testing mode can issue refresh tokens that expire after
   seven days; move the consent screen to Production before relying on the CI
   pipeline, subject to your Google Cloud project's verification requirements.
6. In the GitHub repository, create an environment named `chrome-web-store`.
   Adding required reviewers to this environment is recommended because a tag
   release submits the package for review after the environment is approved.

Configure these GitHub environment variables:

- `CHROME_PUBLISHER_ID`: shown under **Publisher > Settings** in the Developer
  Dashboard.
- `CHROME_EXTENSION_ID`: the 32-character item ID assigned by the Developer
  Dashboard.

Configure these GitHub environment secrets:

- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

Do not commit any of the OAuth values to this repository.

## Run the pipeline

From **Actions > Release Chrome extension > Run workflow**, choose one mode:

- `package`: validate and create a downloadable ZIP without contacting the store.
- `upload`: upload the ZIP as a draft without submitting it for review.
- `publish`: upload, submit for review, and publish automatically after approval.

For a normal release, update `version` in `manifest.json`, commit the change, and
push a matching tag:

```bash
git tag v2.10.0
git push origin v2.10.0
```

A tag must exactly match `v<manifest.version>`. Tag runs use `publish` mode and
also create a GitHub release. Chrome Web Store review is asynchronous; a
successful pipeline means the submission was accepted, not necessarily that it
is already visible in the store.

## Local packaging

Create the same ZIP locally with:

```bash
./scripts/package-extension.sh
```

The generated file is written to `dist/` and is ignored by Git.
Its packaged manifest does not contain `key`; the source manifest is unchanged
so local unpacked development retains its stable extension ID.
