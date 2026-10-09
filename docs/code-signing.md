# Code signing and release secrets

Signed installers open with a double-click: no "cannot verify" step on macOS and a named publisher on Windows. Certificates carry the legal entity, so Windows shows **OGMA CONSULTING PRIVATE LIMITED** as the verified publisher; certificate authorities do not issue them in a brand or trading name. Builds run with **publish** ticked sign themselves as soon as the secrets below exist in the `release` environment. Until then, and in every test build, they stay ad-hoc signed (macOS) and unsigned (Windows). Nothing else changes: the same workflow, **Build beta installers**, builds both.

Never paste a certificate, password or key into an issue, chat, log or commit. Add them only as `release` environment secrets.

## Where the secrets go: the `release` environment

Together these secrets can sign any program as the company and push an update to every installed copy, so they are not repository secrets: anyone who can change a workflow could read those. They live in a GitHub environment that hands them to a job only after a reviewer approves it.

One-time setup, by a repository admin:

1. **Settings › Environments › New environment**, name it `release`.
2. Tick **Required reviewers** and add yourself (and anyone else allowed to release). Leave **Prevent self-review** off if you release alone.
3. Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main` once the release work is merged there. Until then **No restriction** lets a branch build be published.
4. Under **Environment secrets**, add each secret below. Do not add them under **Settings › Secrets and variables › Actions** as repository secrets; if any are there already, delete them.

How a release then runs: start **Build beta installers** with **publish** ticked. The three platform builds wait with **Review pending deployments**; approving once releases all three. When they pass, the publish job waits again: check the build, then approve to publish. Test builds (publish unticked) never enter the environment, never see a secret and start without approval.

Also keep two-factor sign-in on for everyone with write access, keep that list short, and protect `main`. If a secret might have leaked: revoke the certificate at the issuer, change the password, and replace `UPDATE_SIGNING_KEY` (see below).

## macOS: Apple Developer ID and notarization

Cost: Apple Developer Program, US$99 a year (or the local equivalent).

1. **D-U-N-S number.** Apple enrols companies by D-U-N-S number. Look the company up, or request a free number, at <https://developer.apple.com/enroll/duns-lookup/>. Allow up to two weeks.
2. **Enrol as an organisation** at <https://developer.apple.com/programs/enroll/> with an Apple ID that has two-factor authentication. You need the legal entity name, the D-U-N-S number, a website on the company domain (unoblox.ai) and the authority to sign for the company.
3. **Developer ID Application certificate.** On a Mac: Keychain Access › Certificate Assistant › Request a Certificate From a Certificate Authority, saved to disk. Then <https://developer.apple.com/account/resources/certificates> › **+** › **Developer ID Application**, upload the request, download the certificate and double-click it. In Keychain Access, find "Developer ID Application: …", right-click › Export as `.p12` with a strong password.
4. **Notarization key.** App Store Connect › Users and Access › Integrations › App Store Connect API › Team Keys › **+**, role **Developer**. Download the `.p8` file (only once) and note the **Key ID** and the **Issuer ID**.
5. **Secrets** in the `release` environment (macOS Terminal for the base64 step):

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | `base64 -i DeveloperID.p12 \| pbcopy`, then paste |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY` | the whole contents of `AuthKey_XXXX.p8` |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |

With these, `electron-builder.beta.cjs` signs with hardened runtime, notarizes and staples the app, and the disk image shows only "Drag unoblox works to Applications". CI checks the signature, the staple and Gatekeeper's verdict. Over-the-air updates keep working; the first update from an ad-hoc build to a signed one is a normal update. macOS may ask once more for folder permissions the app had before, because the signing identity changed.

## Windows: an OV code-signing certificate

Since 2024 EV certificates no longer skip SmartScreen's reputation check, so an OV certificate is enough. Signed installers show the company as the publisher; SmartScreen may still warn for the first few weeks while downloads build reputation. Pick one of:

### SSL.com OV with eSigner (recommended)

Works from GitHub Actions with no hardware token. Roughly US$130–250 a year plus eSigner signing.

1. Order an **OV Code Signing** certificate at ssl.com and choose **eSigner** (cloud signing) as the delivery.
2. Complete organisation validation: business registration documents, and a phone call to a listed company number. Usually 1–5 business days.
3. In the SSL.com dashboard, enrol the certificate in eSigner, set the PIN and note the **credential ID**. In the eSigner settings, show the **TOTP secret** (the QR code's text form) used for automated signing.
4. **Secrets:**

| Secret | Value |
| --- | --- |
| `ESIGNER_USERNAME` | SSL.com account user name |
| `ESIGNER_PASSWORD` | SSL.com account password |
| `ESIGNER_CREDENTIAL_ID` | the eSigner credential ID |
| `ESIGNER_TOTP_SECRET` | the eSigner TOTP secret |

eSigner bills per signature; only builds run with **publish** ticked are signed (about four signatures each), and test builds stay unsigned. CI installs SSL.com CodeSignTool, and `scripts/esigner-windows-hook.mjs` signs the app, its helpers, the uninstaller and the setup `.exe`. CI then checks every signature with `Get-AuthenticodeSignature`.

### Azure Artifact Signing (formerly Trusted Signing)

About US$10 a month and the simplest to run, but check first that Microsoft accepts organisations in your country. Create an Artifact Signing account and a public-trust certificate profile, then an app registration with the **Artifact Signing Certificate Profile Signer** role, and add:

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | the app registration |
| `AZURE_SIGNING_ENDPOINT` | the account's endpoint, for example `https://eus.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | the account name |
| `AZURE_SIGNING_PROFILE` | the certificate profile name |

eSigner wins if both sets are present.

## Linux

Nothing to buy. The `.deb` and AppImage install without prompts.

## Over-the-air update publishing

Separate from code signing, two more `release` environment secrets let **Build beta installers** with **publish** ticked release a build to installed apps (see `docs/installers.md`):

| Secret | Value |
| --- | --- |
| `UPDATE_SIGNING_KEY` | the Ed25519 private key (PEM) matching `UPDATE_PUBLIC_KEY` in `src/main/update/update-policy.ts` |
| `RELEASES_TOKEN` | a fine-grained token with **Contents: read and write** on `unoblox/unoblox-works-releases` only |

Keep an offline backup of `UPDATE_SIGNING_KEY`. Losing it means shipping a new public key in an app release and asking existing users to install that release by hand once.
