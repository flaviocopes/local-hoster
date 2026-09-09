import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  addRoutes,
  commandArgumentsWithPort,
  executableForCommand,
  hostnameFromProjectName,
  portForHostname,
  removeRoutes,
  routeIdsForHostname,
} from '../index.mjs'

test('normalizes a project name into a localhost hostname', () => {
  assert.equal(hostnameFromProjectName('My-App'), 'my-app.localhost')
  assert.equal(hostnameFromProjectName('api.internal.localhost'), 'api.internal.localhost')
})

test('rejects names that cannot be safe hostnames', () => {
  assert.throws(() => hostnameFromProjectName('@team/app'), /must use only/)
  assert.throws(() => hostnameFromProjectName('-broken'), /must use only/)
  assert.throws(() => hostnameFromProjectName(''), /Missing/)
})

test('assigns stable ports in the documented range', () => {
  const port = portForHostname('my-app.localhost')
  assert.equal(port, portForHostname('my-app.localhost'))
  assert.ok(port >= 10000 && port <= 59999)
})

test('appends the assigned port to the child command', () => {
  assert.deepEqual(commandArgumentsWithPort(['dev'], 43210), ['dev', '--port', '43210'])
})

test('prefers a project-local command when one is installed', () => {
  assert.equal(
    executableForCommand('astro', '/projects/example', path => path.endsWith('/node_modules/.bin/astro')),
    '/projects/example/node_modules/.bin/astro',
  )
  assert.equal(executableForCommand('astro', '/projects/example', () => false), 'astro')
})

test('runs normally when installed through a command symlink', t => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'localhoster-test-'))
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }))

  const entrypoint = fileURLToPath(new URL('../index.mjs', import.meta.url))
  const linkedEntrypoint = join(temporaryDirectory, 'localhoster')
  symlinkSync(entrypoint, linkedEntrypoint)

  const result = spawnSync(process.execPath, [linkedEntrypoint, '--version'], {
    encoding: 'utf8',
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), '1.0.0')
})

test('creates HTTP, HTTPS, and internal-TLS configuration', async () => {
  const routeIds = routeIdsForHostname('my-app.localhost')
  let loadedConfig
  const requestHeaders = []
  const fetchImpl = async (url, init = {}) => {
    requestHeaders.push(init.headers)
    if (url.endsWith('/config/')) {
      return new Response(JSON.stringify({}), { status: 200 })
    }
    if (url.endsWith('/load') && init.method === 'POST') {
      loadedConfig = JSON.parse(init.body)
      return new Response('', { status: 200 })
    }
    return new Response('', { status: 404 })
  }

  await addRoutes({
    caddyAdmin: 'http://localhost:2019',
    fetchImpl,
    host: 'my-app.localhost',
    port: 43210,
    routeIds,
  })

  assert.equal(loadedConfig.apps.http.servers.srv0.routes[0]['@id'], routeIds.http)
  assert.equal(loadedConfig.apps.http.servers.srv1.routes[0]['@id'], routeIds.https)
  assert.equal(loadedConfig.apps.tls.automation.policies[0]['@id'], routeIds.tls)
  assert.equal(
    loadedConfig.apps.http.servers.srv0.routes[0].handle[0].upstreams[0].dial,
    'localhost:43210',
  )
  assert.deepEqual(
    requestHeaders.map(headers => headers.Origin),
    ['http://localhost:2019', 'http://localhost:2019'],
  )
})

test('removes every temporary Caddy object on cleanup', async () => {
  const requested = []
  const routeIds = routeIdsForHostname('my-app.localhost')
  await removeRoutes({
    caddyAdmin: 'http://localhost:2019',
    routeIds,
    fetchImpl: async (url, init) => {
      requested.push([url, init.method, init.headers.Origin])
      return new Response('', { status: 200 })
    },
  })

  assert.deepEqual(
    requested,
    Object.values(routeIds).map(id => [
      `http://localhost:2019/id/${id}`,
      'DELETE',
      'http://localhost:2019',
    ]),
  )
})
