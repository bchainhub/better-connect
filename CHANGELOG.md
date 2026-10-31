# Changelog

## 0.2.0

- Fix npm 12 publishing by removing overrides from bundled runtime dependencies; declare the compatible Bitcoin dependency directly and verify TRON messages without the TronWeb runtime.
- Validate a publish dry-run with release npm in CI and remove obsolete always-auth configuration.

- Refresh dependencies and maintain authentication schemas, canonical messages and verification profiles within this package.
- Remove the connect-protocol dependency, Git source pinning, SDK vendoring and checkout requirements; retain fixture and live Flutter interoperability checks.
- Retain the authentication-only plugin surface.

## 0.1.2

- Publish npm when a GitHub Release is published in the app.
- Remove duplicate GitHub Release creation from the publishing workflow.
- Keep the verified connect-protocol 0.1.1 source pin independent of the plugin release version.

## 0.1.1

- Update the bundled connect-protocol SDK to 0.1.1.
- Retain the CORE License.

## 0.1.0

- Add Connect v1 authentication endpoints, atomic request state transitions, wallet identities and ordinary Better Auth session cookies.
- Own the backend engine and Node Monero verifier within better-connect. Reuse browser-compatible profiles and canonical protocol definitions from the main connect.js package.
- Support all fourteen requested chains, plus Bitcoin legacy and XRP Ed25519 proof variants, with shared fixtures and live Flutter sign-in tests.
- Bundle the browser SDK and patched Node Monero dependency for registry consumers. Add security tests, typed client methods, release workflows, issue templates and CORE License.
