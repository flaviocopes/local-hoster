# Local Hoster

This is one of the software packages I publish with full source code. The landing page is https://flaviocopes.com/software/local-hoster/.

It is MIT licensed. You are free to use it, fork it and change it, also commercially.

There is no support. Issues are turned off and there is no roadmap. Forks are welcome.

If you point a coding agent at this repository, have it read `AGENTS.md` first.

Local Hoster is a small Node.js command-line tool that gives local development projects stable URLs such as `https://dashboard.localhost`. It registers temporary HTTP and HTTPS reverse-proxy routes through Caddy, starts the chosen development command on a deterministic port, and removes its routes when the command exits.

Current release: **1.0** (`1.0.0` in package metadata). See the [Changelog](#changelog) for release notes.

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Verify the source](#verify-the-source)
- [Project structure](#project-structure)
- [Why I built this](#why-i-built-this)
- [Architecture](#architecture)
- [How it was built](#how-it-was-built)
- [Configuration](#configuration)
- [Distribution](#distribution)
- [Customization](#customization)
- [Security](#security)
- [Decisions](#decisions)
- [Changelog](#changelog)
- [License](#license)

## Features

- Memorable `*.localhost` URLs without editing `/etc/hosts`
- Local HTTPS through Caddy's internal certificate authority
- Stable project-to-port mapping across restarts
- Runtime route registration through Caddy's local admin API
- Automatic route and TLS-policy cleanup
- Hostname validation and clear setup errors
- Zero runtime npm dependencies
- Automated tests for hostname, port, route, and cleanup behavior

## Requirements

- macOS or another Unix-like system supported by Caddy
- Node.js 18 or newer
- Caddy installed and running with its admin API on `localhost:2019`

## Quick start

Clone the repository and link the `localhoster` command:

```sh
git clone https://github.com/flaviocopes/local-hoster.git
cd local-hoster
npm link
```

Install and start Caddy, then trust its local certificate authority:

```sh
brew install caddy
touch /opt/homebrew/etc/Caddyfile
brew services start caddy
caddy trust
```

In the project you want to run, add a hostname and wrap its development command:

```json
{
  "localhost": "myapp",
  "scripts": {
    "dev": "localhoster astro dev"
  }
}
```

Then run `npm run dev` and open `https://myapp.localhost`.

## Verify the source

From the repository root:

```sh
npm run check
npm test
```

## Project structure

```text
├── index.mjs
├── package.json
├── test/localhoster.test.mjs
├── AGENTS.md
├── LICENSE
└── README.md
```

Start with the [Architecture](#architecture) section to understand the Caddy configuration flow, and read [Security](#security) before changing the admin endpoint or process behavior.

## Why I built this

I was tired of remembering port numbers. Is my blog on 4321? The API on 3001? The admin on 8080? Every project has a different port and I could never remember which was which.

I wanted to type `blog.localhost` instead of `localhost:4321`. Clean URLs that make sense, HTTPS that just works, and zero configuration. No editing `/etc/hosts`, no self-signed certificates, no Docker containers.

So I built a small CLI that coordinates Caddy as a reverse proxy. One `localhoster` command starts your dev server behind a clean `.localhost` URL with local HTTPS. The runtime has zero npm dependencies and includes tests and complete documentation.

### Why it could be useful for you

- **Stop memorizing port numbers**: `dashboard.localhost` is easier to remember than `localhost:4321`
- **Get real HTTPS on localhost**: test service workers, secure cookies, WebAuthn, and other HTTPS-only features with zero configuration
- **Run multiple projects simultaneously**: each project gets its own clean subdomain, no port conflicts
- **Works with any framework**: Astro, Next.js, Vite, Remix, and anything else with a `--port` flag
- **Zero runtime dependencies**: Node.js provides everything the command needs
- **Consistent across machines**: same project name always maps to the same port, so your URLs are identical on every machine
- **Learn how reverse proxies work**: read the source and understand Caddy's JSON admin API, deterministic port hashing, and RFC 6761 `.localhost` domains

## Architecture

Local Hoster is a zero-runtime-dependency Node.js CLI that coordinates a project command and a local Caddy reverse proxy. The executable is `localhoster`; the public product name is Local Hoster.

### System flow

```text
package.json                 Local Hoster                    Caddy
"localhost": "myapp"  ->  validate hostname         ->  register HTTP route
development command     ->  choose stable port        ->  register HTTPS route
                            start child process        ->  issue local certificate

browser                  <- https://myapp.localhost <- reverse proxy to localhost:PORT

Ctrl+C or child exit     -> remove HTTP, HTTPS, and TLS objects -> exit with child status
```

### Components

#### Command entry point

`index.mjs` parses help and version flags, reads the current project's `package.json`, validates its `localhost` field or `name`, computes a stable port, and starts the requested development command.

#### Hostname and port rules

Names are normalized to lowercase and suffixed with `.localhost`. Each label must contain letters, numbers, or internal hyphens. A deterministic string hash maps the hostname into ports 10000–59999. This makes the same project choose the same port after restarts; it does not reserve the port globally, so ordinary port-conflict handling still applies.

#### Caddy adapter

The CLI reads Caddy's JSON configuration from the local admin API, ensures HTTP and HTTPS servers exist, adds tagged reverse-proxy routes, and installs a tagged internal-TLS automation policy. It then loads the updated configuration in one request.

Every object receives a stable `@id`. Cleanup deletes all three objects by ID, avoiding stale routes and certificate policies after the development command exits.

#### Child process lifecycle

The requested command is spawned directly, without a shell, with `--port <stable-port>` appended. Standard input and output are inherited. When the child exits, Local Hoster removes its Caddy configuration and returns the child's exit status. On `SIGINT` or `SIGTERM`, it cleans up before forwarding the signal to the child.

#### Tests

`test/localhoster.test.mjs` uses Node's built-in test runner. It covers hostname validation, deterministic ports, command arguments, generated Caddy configuration, and cleanup requests without requiring a live Caddy process.

### Trust boundaries

- The project directory controls the hostname and command.
- Caddy's admin API is assumed to be local and owner-controlled.
- The spawned command is supplied by the user and is never passed through a shell.
- Local HTTPS uses a local certificate authority; it is not public TLS.

### Replaceable pieces

The hostname validator, port strategy, Caddy adapter, and child-process runner are explicit functions. You can replace Caddy with another proxy, add a port-availability check, support commands with different port flags, or port the workflow to another language while preserving the product behavior.

## How it was built

### Product shape

Local Hoster started as a compact answer to one recurring problem: remembering which local project owns which port. Caddy already solved reverse proxying and local certificates, so the software focuses on coordinating project names, stable ports, temporary routes, and the development process lifecycle.

### Implementation order

1. Read a project name from `package.json`.
2. Normalize it into a valid `.localhost` hostname.
3. Derive a stable high port from the hostname.
4. Add HTTP, HTTPS, and internal-TLS objects to Caddy.
5. Start the requested development command directly.
6. Remove all temporary Caddy objects when the process ends.
7. Cover the deterministic and configuration-building behavior with Node's test runner.

### Verify

From the repository root:

```sh
npm run check
npm test
node index.mjs --help
```

### Live smoke test

With Caddy running, create a disposable project containing a valid `package.json`, then run a development server through `localhoster`. Confirm both the HTTP and HTTPS URL reach the server, stop it with Ctrl+C, and confirm the tagged Caddy routes and TLS policy were removed.

Do not use a production Caddy admin endpoint for this check. Local Hoster is designed for an owner-controlled local development proxy.

### After changes

Run the static check and tests again. If hostname rules, Caddy configuration, process behavior, prerequisites, or command syntax change, update the matching sections of this README before tagging a new release.

## Configuration

### Project hostname

Add a `localhost` field to the project being run:

```json
{
  "localhost": "myapp"
}
```

If omitted, Local Hoster uses the package `name`. A dedicated value is recommended for scoped packages or names containing unsupported characters. Valid labels contain lowercase letters, numbers, and internal hyphens; dots may separate labels.

### Caddy admin endpoint

Local Hoster defaults to `http://localhost:2019`. For an owner-controlled alternative local configuration, set `LOCALHOSTER_CADDY_ADMIN` for the command process.

Do not point this variable at a public or untrusted admin endpoint.

### Development command

Everything after `localhoster` is spawned directly. Local Hoster appends `--port <stable-port>`, so the target command must accept that option.

```json
{
  "scripts": {
    "dev": "localhoster astro dev"
  }
}
```

There are no API keys, accounts, databases, analytics settings, or remote services.

## Distribution

Local Hoster is a local developer tool, not a hosted web service.

### Install from source

```sh
git clone https://github.com/flaviocopes/local-hoster.git
cd local-hoster
npm link
localhoster --help
```

Install and start Caddy separately, then run `caddy trust` if local HTTPS is wanted.

### Package for a team

`package.json` already exposes the `localhoster` executable. You can publish a private npm package, install from a Git repository, create a Homebrew formula, or distribute the reviewed source internally.

Before distributing a later release:

- increment the semantic version and add a dated entry to the [Changelog](#changelog);
- keep the package version, executable output, tests, and this README in sync;
- document supported Node.js, Caddy, and operating-system versions;
- verify certificate-trust instructions on every supported platform;
- keep the MIT license notice;
- run the checks, tests, and a live disposable-project smoke test;
- review Caddy release notes for admin API changes.

Do not expose the Caddy admin API to the internet or position this local certificate workflow as public production TLS.

## Customization

### Branding and command

Change the package name, executable name, help text, and console output together. Update examples and tests in the same change.

### Port strategy

Replace `portForHostname` to use a configured port range, an availability probe, or a registry. Preserve deterministic behavior when stable origins and browser storage matter.

### Proxy adapter

Replace `addRoutes` and `removeRoutes` to support another reverse proxy. Keep creation and cleanup symmetrical and give every temporary object a stable identifier.

### Framework compatibility

Add a project setting for commands that use a flag other than `--port`. Keep arguments as an array and avoid shell interpolation.

### Dashboard or status output

Build a terminal or web view over Caddy's local configuration to show active hostnames, ports, projects, and process state.

### Other operating systems

The Node.js logic is portable, but installation, certificate trust, and service management differ by system. Add platform-specific setup guides and automated checks rather than silently assuming Homebrew.

## Security

### Trust model

Local Hoster is intended for an owner-controlled development machine. It reads the current project's `package.json`, changes a local Caddy configuration, and runs a command explicitly supplied by the user.

### Important boundaries

- Keep Caddy's admin API bound to localhost and protected from untrusted users.
- Treat `caddy trust` as a meaningful change to the system trust store; run it only for a Caddy installation you control.
- Local Hoster spawns commands directly without a shell. Preserve this property when adding options.
- Validate project hostnames before sending configuration to Caddy.
- Keep route and TLS cleanup symmetrical so stale configuration does not accumulate.
- Do not run the tool with elevated privileges.

### Before distributing a customized version

- Run `npm run check` and `npm test`.
- Test startup, normal exit, Ctrl+C, Caddy-unavailable errors, invalid hostnames, and child-command failures.
- Review any new environment variables and remote endpoints.
- Pin and audit dependencies if runtime packages are added.
- Document the supported Caddy version and certificate-removal procedure.

This repository contains no credentials, personal paths, databases, telemetry, or production resource identifiers.

## Decisions

### Use `.localhost`

RFC 6761 reserves `.localhost` for loopback use, so browsers resolve names such as `api.localhost` without `/etc/hosts` edits or a local DNS service. The tradeoff is that these URLs are intentionally local-only.

### Use Caddy

Caddy provides a local JSON admin API, dynamic route changes, and an internal certificate authority in one binary. Nginx and HAProxy are excellent proxies, but would require more configuration and certificate plumbing for this software.

### Make `localhoster` the command

The command now matches the product name and reads naturally before a development command: `localhoster astro dev`. This software had not been released, so no legacy command alias is included.

### Keep zero runtime dependencies

Node provides file reading, process spawning, URL requests, and testing. Avoiding runtime packages keeps installation, auditing, and customization straightforward. The tradeoff is a deliberately small command interface rather than a larger CLI framework.

### Use a deterministic port

A stable hostname always maps to the same port, which makes debugging predictable. Hash collisions remain possible, so the product does not claim to reserve ports or eliminate every conflict. You can add active port detection when that tradeoff matters.

### Validate hostnames before touching Caddy

Package names may contain scopes or characters that are invalid in hostnames. Local Hoster fails with an actionable error instead of creating malformed routes. A dedicated `localhost` field lets the project choose a clean name.

### Tag and remove every Caddy object

HTTP routes, HTTPS routes, and TLS policies receive stable IDs. Removing all three on exit prevents configuration from accumulating across development sessions.

### Spawn directly without a shell

The user command and arguments are passed to `spawn` as an argument array. This avoids shell interpolation and keeps quoting predictable. Shell-specific expressions require an explicit shell command chosen by the user.

## Changelog

All notable changes to Local Hoster are recorded here. Versions follow semantic versioning; the public-facing release label may omit the patch number.

### 1.0.0 - 2026-08-01

Initial public release.

- Runs compatible development commands at memorable `https://project.localhost` URLs.
- Registers temporary HTTP, HTTPS, and internal-TLS configuration through Caddy's local admin API.
- Works with Caddy's origin checks by sending an explicit local admin origin.
- Resolves project-local executables such as `astro` from `node_modules/.bin`.
- Assigns stable preferred ports from validated project hostnames.
- Cleans up routes and TLS policies when the development process exits.
- Includes automated tests and complete project documentation with no runtime npm dependencies.

## License

MIT. Keep the included license notice with substantial copies of the source.
