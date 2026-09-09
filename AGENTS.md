# Agent guide for Local Hoster

## Objective

Help the owner install, understand, customize, or port Local Hoster while preserving safe process spawning and cleanup of temporary Caddy configuration.

## Start here

1. Read `README.md`, in particular the Architecture, Configuration, and Security sections.
2. Treat the repository root as the executable package root. `index.mjs` is the whole CLI; tests live in `test/`.
3. Ask which operating systems, development commands, and proxy setup must be supported before expanding compatibility.

## Working rules

- Keep `localhoster` as the primary command unless the owner deliberately rebrands it.
- Treat `1.0.0` as the initial public release. For every later release, update the package version, executable version output, tests, and the Changelog section of `README.md` together.
- Do not pass project-controlled values through a shell.
- Validate hostnames before changing Caddy configuration.
- Keep route creation and cleanup symmetrical.
- Preserve the child process's failure status.
- Do not expose Caddy's admin API to a public network.
- Do not claim deterministic hashing prevents every port collision.
- Update tests and documentation with behavior changes.

## Verification

From the repository root:

```sh
npm run check
npm test
node index.mjs --help
```

For lifecycle changes, also perform the disposable local smoke test described in the "How it was built" section of `README.md`.

## Useful prompts

- “Set up Local Hoster for this Astro project and use `docs.localhost`.”
- “Add a port-availability check while keeping stable preferred ports.”
- “Add Windows support behind a proxy adapter.”
- “Support a configurable port flag without invoking a shell.”
- “Show active Local Hoster routes in a small terminal dashboard.”
