import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  isDemoLoginEnabled,
  resolveDatabaseConfig,
  resolveUploadDir,
} from '../server/dist/config/runtime.js'
import { validateInitialAdminPassword } from '../server/dist/scripts/adminBootstrap.js'

test('database config uses TCP by default on Linux and in containers', () => {
  const config = resolveDatabaseConfig({
    DB_HOST: 'mysql',
    DB_PORT: '3307',
    DB_USER: 'gpss',
    DB_PASSWORD: 'secret',
    DB_NAME: 'gpss',
  })

  assert.deepEqual(config, {
    host: 'mysql',
    port: 3307,
    user: 'gpss',
    password: 'secret',
    database: 'gpss',
    charset: 'utf8mb4',
  })
})

test('database config uses a Unix socket only when explicitly enabled', () => {
  const config = resolveDatabaseConfig({
    USE_SOCKET: 'true',
    DB_SOCKET_PATH: '/custom/mysql.sock',
    DB_USER: 'root',
    DB_NAME: 'gpss_local',
  })

  assert.deepEqual(config, {
    socketPath: '/custom/mysql.sock',
    user: 'root',
    password: '',
    database: 'gpss_local',
    charset: 'utf8mb4',
  })
})

test('database config can omit the database for schema creation', () => {
  const config = resolveDatabaseConfig({ DB_HOST: '127.0.0.1', DB_NAME: 'gpss' }, false)
  assert.equal('database' in config, false)
})

test('upload directory accepts absolute and working-directory-relative paths', () => {
  assert.equal(resolveUploadDir({ UPLOAD_DIR: '/var/lib/gpss/uploads' }, '/opt/gpss/server'), '/var/lib/gpss/uploads')
  assert.equal(resolveUploadDir({ UPLOAD_DIR: './data/uploads' }, '/opt/gpss/server'), '/opt/gpss/server/data/uploads')
  assert.equal(resolveUploadDir({}, '/opt/gpss/server'), '/opt/gpss/server/uploads')
})

test('demo login is disabled unless explicitly enabled', () => {
  assert.equal(isDemoLoginEnabled({}), false)
  assert.equal(isDemoLoginEnabled({ ENABLE_DEMO_LOGIN: 'false' }), false)
  assert.equal(isDemoLoginEnabled({ ENABLE_DEMO_LOGIN: 'true' }), true)
})

test('initial administrator password must be at least 12 characters', () => {
  assert.throws(() => validateInitialAdminPassword(''), /不能为空/)
  assert.throws(() => validateInitialAdminPassword('short-pass'), /至少 12 位/)
  assert.equal(validateInitialAdminPassword('Admin-2026!Strong'), 'Admin-2026!Strong')
})

test('backup avoids requiring MySQL PROCESS privilege for tablespaces', async () => {
  const deployScript = await readFile(new URL('../deployment/deploy.sh', import.meta.url), 'utf8')
  assert.match(deployScript, /mysqldump[^\n]*--no-tablespaces/)
})

test('native installer only reveals a password when it creates the administrator', async () => {
  const installScript = await readFile(new URL('../deployment/native/install.sh', import.meta.url), 'utf8')
  assert.match(installScript, /admin_count=.*SELECT COUNT\(\*\).*username='admin'/)
  assert.match(installScript, /if \[ -n "\$admin_password" \]/)
})

test('deployment runs the idempotent cycle phase migration after schema initialization', async () => {
  const deployScript = await readFile(new URL('../deployment/deploy.sh', import.meta.url), 'utf8')
  const nativeInstaller = await readFile(new URL('../deployment/native/install.sh', import.meta.url), 'utf8')
  const processSchema = await readFile(new URL('../server/src/scripts/processSchema.ts', import.meta.url), 'utf8')
  const legacyInit = await readFile(new URL('../server/init-db.cjs', import.meta.url), 'utf8')
  const importSeed = await readFile(new URL('../server/scripts/import-seed.cjs', import.meta.url), 'utf8')

  for (const script of [deployScript, nativeInstaller]) {
    assert.match(script, /initDb\.js[\s\S]*migrateAddProcessStages\.js/)
  }
  for (const phase of ['topic_publish', 'student_apply', 'teacher_review', 'result_announce']) {
    assert.match(processSchema, new RegExp(`'${phase}'`))
    assert.match(legacyInit, new RegExp(`'${phase}'`))
    assert.match(importSeed, new RegExp(`'${phase}'`))
  }
  assert.match(processSchema, /CREATE TABLE IF NOT EXISTS document_templates/)
  assert.match(processSchema, /main_content TEXT/)
  assert.match(processSchema, /specific_requirements TEXT/)
  assert.match(processSchema, /'submitted', 'need_revision', 'confirmed'/)
  assert.match(await readFile(new URL('../server/src/routes/taskBooks.ts', import.meta.url), 'utf8'), /requireRole\(\['student'\]\)/)
  assert.match(await readFile(new URL('../server/src/routes/taskBooks.ts', import.meta.url), 'utf8'), /task_book_submitted/)
})

test('HTTPS template uses the current Nginx HTTP/2 directive', async () => {
  const nginxConfig = await readFile(new URL('../deployment/nginx/https.conf.example', import.meta.url), 'utf8')
  assert.doesNotMatch(nginxConfig, /listen\s+443\s+ssl\s+http2/)
  assert.match(nginxConfig, /http2\s+on;/)
})
