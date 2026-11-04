# Contributing

Thanks for helping improve `@and-effect/ag-ui-vue`! By taking part you agree to
our [Code of Conduct](./CODE_OF_CONDUCT.md). Report security issues privately,
see [SECURITY.md](./SECURITY.md).

**Always open an issue first**, for bugs, features and docs alike. We accept
pull requests only for issues a maintainer has agreed to, and close PRs without
one. The API is still settling before 1.0, and the library is deliberately a
thin, headless adapter over `@ag-ui/client`, so we'd rather agree on the
approach before you write code.

## Setup

Requires Node.js 20.19+.

```bash
npm install
npm run typecheck
npm run test:run
npm run build
```

The playground in `examples/` runs against the library source. See
[examples/README.md](./examples/README.md).

## Pull requests

Once a maintainer has agreed to the issue, branch off `main` and open your PR
against it, linking the issue. Include tests, and make sure
`typecheck`, `test:run` and `build` pass; CI checks all three.

Add an entry under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md)
([Keep a Changelog](https://keepachangelog.com/)) for any user-facing change.
Keep it short, write it for library users, and start breaking changes with
**BREAKING:**.

Until 1.0, minor releases may break the API; patch releases don't.

By submitting a contribution, you agree that it is licensed under the project's MIT license.

## Releasing (maintainers)

1. In a release PR to `main`: `npm version x.y.z --no-git-tag-version`, and move
   the `[Unreleased]` notes into a dated `[x.y.z]` section.
2. After merging: `git tag -a vx.y.z -m "Release vx.y.z"` on `main` and push the
   tag. CI publishes to npm.
3. `gh release create vx.y.z --notes-from-tag`.
