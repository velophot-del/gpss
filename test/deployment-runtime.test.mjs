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

test('production deploy creates template tables before switching to the new app', async () => {
  const script = await readFile(new URL('../deployment/deploy-gpss-only.sh', import.meta.url), 'utf8')
  const migration = 'docker compose run --rm --no-deps --entrypoint node gpss-app server/dist/scripts/migrateTemplateContracts.js'
  assert.ok(script.includes(migration), 'template migration must run on the production deployment path')
  assert.ok(script.indexOf(migration) < script.indexOf('docker compose up -d --no-deps gpss-app\nlog'), 'template schema must exist before replacing the running app')
})

test('release markers use commit timestamps so equal-size revisions are transferred again', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const dir = mkdtempSync(path.join(tmpdir(), 'gpss-release-marker-'))
  try {
    const repo = path.join(dir, 'repo'); mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    writeFileSync(path.join(repo, 'scripts/package-gpss.py'), await readFile(new URL('../scripts/package-gpss.py', import.meta.url)))
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    git('init', '-q');git('config','user.name','Release Test');git('config','user.email','release-test@example.invalid')
    const markers = []
    for (let revision = 1; revision <= 2; revision++) {
      writeFileSync(path.join(repo,'README.md'),`revision ${revision}\n`);git('add','README.md','scripts/package-gpss.py')
      const stamp=`2026-11-06T00:00:0${revision}Z`
      execFileSync('git',['commit','-qm',`revision ${revision}`],{cwd:repo,env:{...process.env,GIT_AUTHOR_DATE:stamp,GIT_COMMITTER_DATE:stamp}})
      const output=path.join(dir,`release-${revision}.tar.gz`)
      execFileSync('python3',[path.join(repo,'scripts/package-gpss.py'),output],{cwd:repo})
      const marker=JSON.parse(execFileSync('python3',['-c',"import tarfile,sys,json; a=tarfile.open(sys.argv[1]); m=a.getmember('gpss-src/DEPLOY_COMMIT'); print(json.dumps({'text':a.extractfile(m).read().decode().strip(),'mtime':m.mtime,'size':m.size}))",output],{encoding:'utf8'}))
      assert.equal(marker.text,git('rev-parse','HEAD'));assert.equal(marker.mtime,Number(git('show','-s','--format=%ct','HEAD')));markers.push(marker)
    }
    assert.equal(markers[0].size,markers[1].size);assert.notEqual(markers[0].mtime,markers[1].mtime)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('deployment rejects a healthy container when its running commit is stale', async () => {
  const { mkdtempSync,writeFileSync,rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const script = await readFile(new URL('../deployment/deploy-gpss-only.sh',import.meta.url),'utf8')
  const fn = script.match(/verify_commit\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(fn,'deployment must verify the running container commit')
  assert.match(script,/\nhealth\nverify_commit\n/)
  const dir=mkdtempSync(path.join(tmpdir(),'gpss-verify-commit-'))
  try {
    const expected='a'.repeat(40);writeFileSync(path.join(dir,'DEPLOY_COMMIT'),expected+'\n')
    const code='log() { :; }\ndocker() { printf "%s\\n" "$MOCK_COMMIT"; }\n'+fn+'\nverify_commit\n'
    for(const [actual,status] of [[expected,0],['b'.repeat(40),1]]){
      const result=spawnSync('bash',['-c',code],{env:{...process.env,SOURCE:dir,MOCK_COMMIT:actual}})
      assert.equal(result.status,status)
    }
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('builds use the full commit independently of file size and timestamp', async () => {
  const { mkdtempSync,writeFileSync,rmSync,readFileSync,utimesSync,statSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const script=await readFile(new URL('../deployment/deploy-gpss-only.sh',import.meta.url),'utf8')
  const fn=script.match(/build_app\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(fn)
  const dockerfile=await readFile(new URL('../deployment/aliyun/Dockerfile',import.meta.url),'utf8')
  assert.match(dockerfile,/ARG GPSS_BUILD_COMMIT/)
  const stamp=dockerfile.split('\n').find(line=>line.startsWith('RUN if [ -n "$GPSS_BUILD_COMMIT"'))?.slice(4)
  assert.ok(stamp,'image must stamp the provided build commit rather than relying on COPY')
  const dir=mkdtempSync(path.join(tmpdir(),'gpss-build-commit-'))
  try {
    for(const revision of ['a'.repeat(40),'b'.repeat(40)]){
      writeFileSync(path.join(dir,'DEPLOY_COMMIT'),revision+'\n')
      utimesSync(path.join(dir,'DEPLOY_COMMIT'),1793923201,1793923201)
      const metadata=statSync(path.join(dir,'DEPLOY_COMMIT'))
      assert.equal(metadata.size,41);assert.equal(metadata.mtimeMs,1793923201000)
      const result=spawnSync('bash',['-c','docker() { printf "%s\\n" "$@"; }\n'+fn+'\nbuild_app'],{env:{...process.env,SOURCE:dir},encoding:'utf8'})
      assert.equal(result.status,0)
      assert.deepEqual(result.stdout.trim().split('\n'),['compose','build','--build-arg','GPSS_BUILD_COMMIT='+revision,'gpss-app'])
      const stamped=path.join(dir,'image-commit')
      const run=spawnSync('bash',['-c',stamp.replace('/app/DEPLOY_COMMIT','"$STAMP_FILE"')],{env:{...process.env,GPSS_BUILD_COMMIT:revision,STAMP_FILE:stamped}})
      assert.equal(run.status,0);assert.equal(readFileSync(stamped,'utf8').trim(),revision)
    }
    writeFileSync(path.join(dir,'DEPLOY_COMMIT'),'invalid revision\n')
    const invalid=spawnSync('bash',['-c','docker() { echo should-not-run; }\n'+fn+'\nbuild_app'],{env:{...process.env,SOURCE:dir},encoding:'utf8'})
    assert.equal(invalid.status,1);assert.equal(invalid.stdout,'')
  } finally { rmSync(dir,{recursive:true,force:true}) }
})
