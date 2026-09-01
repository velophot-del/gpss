import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'src/assets/process-templates')
const target = path.join(root, 'dist/assets/process-templates')
await mkdir(path.dirname(target), { recursive: true })
await cp(source, target, { recursive: true })
