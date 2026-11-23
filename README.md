# Mattersync

![Mattersync icon](assets/base/branding/preview.png)

Mattersync is an independently maintained iOS and Android client for Mattermost servers, published by **Bytsolv (Bytsolv Digital Transformations Private Limited)**.

Connect to your team's server for channels, direct messages, threads, file sharing, calls, and AAC `.m4a` voice-message attachments. The message composer includes a microphone button with recording, cancellation, and attachment controls. An account on a compatible server is required.

Support and privacy contact: **support@bytsolv.com** · [Bytsolv](https://bytsolv.com)

## Distribution status

This repository is a modified client under development. Public distribution is **pending branding clearance and publisher review**: existing commercial software already uses the name MatterSync. The name and original icon in this source tree do not establish trademark availability or store approval. See [branding and release requirements](docs/branding.md).

The [privacy notice](docs/privacy.md) is a draft for publisher review. Publish the reviewed notice at a public URL before store submission. Fresh screenshots and device testing of the branded app are also required.

## Development

Use the Node/npm versions specified in `package.json`. Native builds require the platform toolchains and your own signing/provisioning configuration.

```sh
npm ci
npm start
# In another terminal:
npm run ios
# or
npm run android
```

Run `npm run check` for lint and TypeScript validation. Tests are documented in [the repository testing guide](docs/testing_guide.md). Follow `AGENTS.md` and `CLAUDE.md` for the development and device-test workflow.

## Branding assets

The editable icon is [mark.svg](assets/base/branding/mark.svg). Brand and publisher settings live in [brand.json](assets/base/branding/brand.json).

Regenerate native icons, adaptive/themed and notification icons, light/dark launch images, in-app images, and store graphics with:

```sh
python3 scripts/generate-brand-assets.py
```

The generator requires Pillow. After changing native assets, rebuild the app; a JavaScript reload does not update an installed app's launcher icon or native display name. Release builds copy the branded source assets through the existing Fastlane asset pipeline.

## Upstream attribution

This project is derived from [Mattermost Mobile](https://github.com/mattermost/mattermost-mobile). Mattermost is a trademark of Mattermost, Inc. Mattersync and Bytsolv are not affiliated with, sponsored by, or endorsed by Mattermost, Inc.

The original copyright, Apache 2.0 license, and dependency notices are retained in [LICENSE.txt](LICENSE.txt) and [NOTICE.txt](NOTICE.txt). Compatibility references and internal upstream module names remain where needed; they do not identify this app as an official upstream release.
