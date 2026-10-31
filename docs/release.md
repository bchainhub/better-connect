# Release setup

CI runs formatting/linting, static checks, relevant tests and package validation. Flutter additionally builds Android and iOS simulator examples. better-connect has an optional, separate Flutter interoperability workflow; its release only requires its own package checks.

1. Review the package version and changelog. Keep v1 protocol vectors identical across all three repositories.
2. Configure repository Actions and the registry's trusted publisher for `bchainhub/better-connect` and `release.yml`. Use npm GitHub OIDC trusted publishing and allow direct `npm publish`. Initial package creation/ownership and registry settings must be established by maintainers.
3. Ensure the Flutter integration checkout is available before cross-repository CI runs. For incompatible future protocol changes update the shared fixtures and explicitly verify integration compatibility.
4. Create and publish the GitHub Release in the app using tag `<version>` (for example, `0.1.1`, without `v`). Publishing the release triggers validation and npm publication. Saving a draft or pushing a tag alone does not publish npm. The release tag must match the package manifest exactly. The workflow uses the existing GitHub Release and never creates another one.

Only publish a version that is not already on npm. Rerunning publication for an existing npm version will fail; a GitHub Release does not make npm versions replaceable. Flutter's pub.dev workflow remains tag-triggered.

CORE License text is copied unchanged from the reference flutter_txms repository. npm metadata uses `SEE LICENSE IN LICENSE` because CORE is a custom license.

CI and release jobs install this package's npm dependencies directly. No SDK source
checkout, Git pin, vendored SDK archive or connect-protocol release is needed.
Authentication schemas, canonical messages, Core helpers and verifiers are maintained
in `src/protocol`. Shared fixtures and live Flutter integration check wire compatibility
without creating a runtime dependency on either other library.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [Dart publishing workflow](https://github.com/dart-lang/setup-dart/blob/main/.github/workflows/publish.yml).

Dependency lockfiles are ignored. npm workflows install from package.json with `--package-lock=false`; npm cache keys use package.json. Flutter workflows already resolve dependencies with `flutter pub get`.

The plugin bundles Node Monero and BIP-322 dependencies. CI upgrades npm before package validation so its publish checks match release npm.
Package checks include a publish dry-run and install
the tarball in a clean application, verify all seventeen proofs, assert that
connect-protocol is absent, and audit runtime dependencies. The BIP-322 dependency uses
bitcoinjs-lib 7.0.1 because later versions reject its synthetic signing transaction;
that version is a direct dependency and bundled so consumer installation preserves compatibility. No override modifies a bundled dependency.

## Independent releases

better-connect 0.2.0 can be built, tested and published independently of connect.js
0.2.0 and flutter_connect 0.2.0. No coordinated release order is required. Keep the
versioned protocol fixtures compatible when evolving authentication behavior. The
optional live Flutter integration job checks a sibling checkout only for interoperability;
the normal build, unit tests and package checks do not require it.
