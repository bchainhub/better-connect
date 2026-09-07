# Release setup

CI runs formatting/linting, static checks, relevant tests and package validation. Flutter additionally builds Android and iOS simulator examples. better-connect's release also runs cross-repository Flutter interoperability.

1. Review the package version and changelog. Keep v1 protocol vectors identical across all three repositories.
2. Configure repository Actions and the registry's trusted publisher for `bchainhub/better-connect` and `release.yml`. Use npm GitHub OIDC trusted publishing and allow direct `npm publish`. Initial package creation/ownership and registry settings must be established by maintainers.
3. Ensure dependent repositories are pushed before cross-repository CI runs. For incompatible future protocol changes pin the integration checkout to a matching release rather than silently mixing versions.
4. Create and publish the GitHub Release in the app using tag `<version>` (for example, `0.1.1`, without `v`). Publishing the release triggers validation and npm publication. Saving a draft or pushing a tag alone does not publish npm. The release tag must match the package manifest exactly. The workflow uses the existing GitHub Release and never creates another one.

Only publish a version that is not already on npm. Rerunning publication for an existing npm version will fail; a GitHub Release does not make npm versions replaceable. Flutter's pub.dev workflow remains tag-triggered.

CORE License text is copied unchanged from the reference flutter_txms repository. npm metadata uses `SEE LICENSE IN LICENSE` because CORE is a custom license.

For better-connect, CI checks out the matching SDK source and runs `node scripts/prepare-sdk.mjs` before installing dependencies. The helper builds the ignored vendor tarball; `node scripts/sync-protocol.mjs` refreshes a local installation. Reference conformance fixtures live in `test/fixtures/` and remain versioned. Generated `vectors/` and `vendor/` directories are ignored. The published bundle includes the browser SDK and the plugin's patched Node Monero dependency so registry users do not need local filesystem dependencies.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [Dart publishing workflow](https://github.com/dart-lang/setup-dart/blob/main/.github/workflows/publish.yml).

Dependency lockfiles are ignored. npm workflows install from package.json with `--package-lock=false`; npm cache keys use package.json. Flutter workflows already resolve dependencies with `flutter pub get`.

The plugin bundles connect-protocol, which includes its offline Monero verifier with patched transitive dependencies. `npm run test:package` packs and installs a clean consumer application, verifies all seventeen shared proofs, checks the bundled dependency versions and audits production dependencies. CI runs this check on Node 22 and 24 before release.

## SDK source revision

`sdk-source.json` pins the Connect SDK repository, full commit SHA, npm package name and version. CI, Flutter interoperability and release publishing all resolve that pin before checking out the SDK. They never build whichever version happens to be on the SDK default branch.

When updating `dependencies.connect-protocol`, also update `sdk-source.json` to a pushed SDK commit whose package name/version match the archive dependency. Merge or push the SDK commit before running better-connect CI. Tags need not exist yet. `node scripts/prepare-sdk.mjs --ref` validates the configuration and prints the pinned SHA without installing dependencies. Local SDK preparation still allows an explicitly supplied checkout, but validates its name/version and shared fixtures; mismatches report both expected and actual versions.

The plugin release version and bundled SDK version are independent. For better-connect 0.1.2, the SDK pin remains connect-protocol 0.1.1. Local preparation must use a checkout matching `sdk-source.json`; when the sibling SDK checkout has advanced, use a separate checkout at the pinned revision.
