#!/usr/bin/env node
/**
 * 测试串行护栏（2026-11-12 retro，两仓同款）：
 * 3.7G 内存机上并发 jsdom 套件曾把 DSH 宿主挤挂（实录：dsh-stock-kanban
 * docs/verification.md §12.27 + dsh-runtime-ops skill）。三层防线：
 *   1. 机器级互斥锁（/tmp O_EXCL + 持锁 PID 探活回收）——同机第二个测试运行
 *      立即 fail-fast；env TEST_SKIP_LOCK=1 豁免。
 *   2. 内存预检：os.freemem() < 600MB 警告、< 300MB 拒跑；env TEST_ALLOW_LOW_MEM=1 豁免拒跑。
 *   3. 单用例超时 --test-timeout=15000：任何用例挂死 15s 内点名变红
 *      （两仓最长真定时器用例 ~10s），不再冻结整文件等外部 timeout。
 * 用法：npm test [args] → 本脚本透传给 node --test；退出码 = node --test 退出码。
 */
import { spawnSync } from 'node:child_process'
import { openSync, closeSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import os from 'node:os'

const LOCK_PATH = '/tmp/iasiv5-plugin-tests.lock'
const FREE_WARN = 600 * 1024 * 1024
const FREE_HARD = 300 * 1024 * 1024
const TEST_TIMEOUT_MS = 15000

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

const free = os.freemem()
if (free < FREE_HARD && process.env.TEST_ALLOW_LOW_MEM !== '1') {
  console.error(`[test-serial] 可用内存 ${(free / 1048576).toFixed(0)}MB < 300MB，拒跑（确认无其他重活后可用 TEST_ALLOW_LOW_MEM=1 豁免）`)
  process.exit(3)
}
if (free < FREE_WARN) {
  console.warn(`[test-serial] 警告：可用内存仅 ${(free / 1048576).toFixed(0)}MB（<600MB）——测试保持 solo，勿并发其他重活`)
}

let lockFd = null
if (process.env.TEST_SKIP_LOCK !== '1') {
  for (let attempt = 0; attempt < 2 && lockFd === null; attempt += 1) {
    try {
      lockFd = openSync(LOCK_PATH, 'wx')
      writeSync(lockFd, `${process.pid} ${new Date().toISOString()}`)
    } catch {
      let holderPid = Number.NaN
      try { holderPid = Number.parseInt(readFileSync(LOCK_PATH, 'utf8'), 10) } catch {}
      if (Number.isInteger(holderPid) && holderPid > 0 && pidAlive(holderPid)) {
        console.error(`[test-serial] 已有测试在跑（pid ${holderPid}，锁 ${LOCK_PATH}）——小机勿并发测试套件；TEST_SKIP_LOCK=1 豁免本护栏`)
        process.exit(4)
      }
      try { unlinkSync(LOCK_PATH) } catch {}
    }
  }
}

const extra = process.argv.slice(2)
const result = spawnSync(process.execPath, ['--test', `--test-timeout=${TEST_TIMEOUT_MS}`, ...extra], { stdio: 'inherit' })
if (lockFd !== null) { try { closeSync(lockFd); unlinkSync(LOCK_PATH) } catch {} }
process.exit(result.status ?? 1)
