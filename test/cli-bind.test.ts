import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { expect, test } from 'vitest'
import { freshQuizDir, start } from './support/cli-child.ts'

const LAN_DIAL_TIMEOUT_MS = 2000

function lanAddress(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address
      }
    }
  }
  return null
}

const LAN = lanAddress()

function dial(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const sock = connect({ host, port })
    sock.setTimeout(LAN_DIAL_TIMEOUT_MS)
    sock.on('connect', () => {
      sock.destroy()
      resolve('connected')
    })
    sock.on('timeout', () => {
      sock.destroy()
      resolve('timeout')
    })
    sock.on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? 'error'))
  })
}

// The banner always *prints* 127.0.0.1 regardless of what the server actually bound to,
// so no assertion on stderr can tell loopback from 0.0.0.0 -- the only way to know is to
// dial this machine's own LAN address and be refused. It matters because the quiz serves
// a submit endpoint and the grading results derived from the answer key, none of which
// should be reachable by anyone else on the network.
//
// Skipped rather than silently passed when there is no non-loopback IPv4 to dial. A host
// firewall that drops (rather than refuses) the connection surfaces as 'timeout', which
// still fails the assertion below but proves less; asserting specifically against
// 'connected' is what keeps a real 0.0.0.0 bind from passing under any of those outcomes.
test.skipIf(LAN === null)('binds loopback only, not every interface', async () => {
  const s = start([freshQuizDir()])
  const base = await s.ready
  const port = Number(new URL(base).port)

  const outcome = await dial(String(LAN), port)
  expect(outcome, `the quiz answered on ${LAN}:${port}`).not.toBe('connected')

  s.child.kill('SIGTERM')
  await s.exited
})
