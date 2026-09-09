#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CADDY_ADMIN = 'http://localhost:2019'
const VERSION = '1.0.0'

export function hostnameFromProjectName(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Missing "localhost" or "name" field in package.json')
  }

  const valueWithoutSuffix = value.trim().toLowerCase().replace(/\.localhost$/, '')
  const labels = valueWithoutSuffix.split('.')

  if (
    valueWithoutSuffix.length > 63 ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error(
      'The localhost name must use only lowercase letters, numbers, hyphens, and dots, with no leading or trailing hyphen.',
    )
  }

  return `${valueWithoutSuffix}.localhost`
}

export function portForHostname(host) {
  let hash = 0
  for (const character of host) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  }
  return 10000 + (Math.abs(hash) % 50000)
}

export function commandArgumentsWithPort(args, port) {
  return [...args, '--port', String(port)]
}

export function executableForCommand(command, cwd, existsImpl = existsSync) {
  const localExecutable = resolve(cwd, 'node_modules', '.bin', command)
  return existsImpl(localExecutable) ? localExecutable : command
}

export function routeIdsForHostname(host) {
  const id = host.replace(/[^a-z0-9-]/g, '-')
  return {
    http: `localhoster-${id}-http`,
    https: `localhoster-${id}-https`,
    tls: `localhoster-${id}-tls`,
  }
}

function usage() {
  return `Local Hoster ${VERSION}

Usage:
  localhoster <command> [args...]

Example:
  localhoster astro dev

Configure the hostname in your project's package.json:
  { "localhost": "myapp" }
`
}

function caddyRequestHeaders(caddyAdmin) {
  return {
    'Content-Type': 'application/json',
    Origin: new URL(caddyAdmin).origin,
  }
}

async function readCaddyConfig(caddyAdmin, fetchImpl) {
  let response
  try {
    response = await fetchImpl(`${caddyAdmin}/config/`, {
      headers: caddyRequestHeaders(caddyAdmin),
    })
  } catch {
    throw new Error('Caddy is not running. Start it first:\n\n  brew services start caddy')
  }

  if (!response.ok) {
    throw new Error(`Could not read Caddy config: ${response.status} ${await response.text()}`)
  }

  return (await response.json()) ?? {}
}

export async function addRoutes({ caddyAdmin, fetchImpl, host, port, routeIds }) {
  const config = await readCaddyConfig(caddyAdmin, fetchImpl)
  config.apps ??= {}
  config.apps.http ??= {}
  config.apps.http.servers ??= {}
  config.apps.http.servers.srv0 ??= { listen: [':80'], routes: [] }
  config.apps.http.servers.srv0.routes ??= []
  config.apps.http.servers.srv1 ??= {
    listen: [':443'],
    routes: [],
    tls_connection_policies: [{}],
  }
  config.apps.http.servers.srv1.routes ??= []
  config.apps.tls ??= {}
  config.apps.tls.automation ??= {}
  config.apps.tls.automation.policies ??= []

  const proxyHandler = {
    handler: 'reverse_proxy',
    upstreams: [{ dial: `localhost:${port}` }],
  }
  const createRoute = id => ({
    '@id': id,
    match: [{ host: [host] }],
    handle: [proxyHandler],
  })

  config.apps.http.servers.srv0.routes = config.apps.http.servers.srv0.routes.filter(
    route => route['@id'] !== routeIds.http,
  )
  config.apps.http.servers.srv0.routes.push(createRoute(routeIds.http))

  config.apps.http.servers.srv1.routes = config.apps.http.servers.srv1.routes.filter(
    route => route['@id'] !== routeIds.https,
  )
  config.apps.http.servers.srv1.routes.push(createRoute(routeIds.https))

  config.apps.tls.automation.policies = config.apps.tls.automation.policies.filter(
    policy => policy['@id'] !== routeIds.tls && !policy.subjects?.includes(host),
  )
  config.apps.tls.automation.policies.push({
    '@id': routeIds.tls,
    subjects: [host],
    issuers: [{ module: 'internal' }],
  })

  const response = await fetchImpl(`${caddyAdmin}/load`, {
    method: 'POST',
    headers: caddyRequestHeaders(caddyAdmin),
    body: JSON.stringify(config),
  })

  if (!response.ok) {
    throw new Error(`Failed to load Caddy config: ${response.status} ${await response.text()}`)
  }
}

export async function removeRoutes({ caddyAdmin, fetchImpl, routeIds }) {
  await Promise.all(
    Object.values(routeIds).map(id =>
      fetchImpl(`${caddyAdmin}/id/${id}`, {
        method: 'DELETE',
        headers: caddyRequestHeaders(caddyAdmin),
      }).catch(() => {}),
    ),
  )
}

export async function run(argv = process.argv.slice(2), options = {}) {
  const {
    cwd = process.cwd(),
    fetchImpl = fetch,
    spawnImpl = spawn,
    caddyAdmin = process.env.LOCALHOSTER_CADDY_ADMIN || DEFAULT_CADDY_ADMIN,
  } = options

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    return 0
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(VERSION)
    return 0
  }
  if (argv.length === 0) {
    console.error(usage())
    return 1
  }

  const packagePath = resolve(cwd, 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${packagePath}: ${error.message}`)
  }

  const host = hostnameFromProjectName(packageJson.localhost || packageJson.name)
  const port = portForHostname(host)
  const routeIds = routeIdsForHostname(host)
  const [command, ...commandArgs] = argv

  await addRoutes({ caddyAdmin, fetchImpl, host, port, routeIds })
  console.log(`  http://${host}  -> localhost:${port}`)
  console.log(`  https://${host} -> localhost:${port}\n`)

  const executable = executableForCommand(command, cwd)
  const child = spawnImpl(executable, commandArgumentsWithPort(commandArgs, port), {
    stdio: 'inherit',
    cwd,
  })

  let cleanupPromise
  const cleanup = () => {
    cleanupPromise ??= removeRoutes({ caddyAdmin, fetchImpl, routeIds })
    return cleanupPromise
  }

  const shutdown = signal => {
    void (async () => {
      await cleanup()
      child.kill(signal)
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })()
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  return await new Promise(resolveExitCode => {
    child.once('error', async error => {
      console.error(`Could not start ${command}: ${error.message}`)
      await cleanup()
      resolveExitCode(1)
    })
    child.once('exit', async code => {
      await cleanup()
      resolveExitCode(code ?? 1)
    })
  })
}

const entryPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : ''
const isDirectRun = entryPath === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    process.exitCode = await run()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
