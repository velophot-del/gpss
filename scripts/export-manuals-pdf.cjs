/* 学生/教师操作手册 Markdown → PDF 导出
 * 运行：NODE_PATH=/tmp/md2pdf/node_modules:/Users/tangwang/.npm/_npx/31e32ef8478fbf80/node_modules node scripts/export-manuals-pdf.cjs
 */
const { marked } = require('marked')
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const MANUALS_DIR = path.join(__dirname, '..', 'docs', 'manuals')
const CHROME = '/Users/tangwang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const FILES = [
  { name: '学生操作手册', title: '毕业设计管理系统 · 学生操作手册' },
  { name: '教师操作手册', title: '毕业设计管理系统 · 教师操作手册' },
]

const CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; color: #303133; font-size: 13px; line-height: 1.75; margin: 0; }
  h1 { font-size: 22px; color: #17324d; text-align: center; border-bottom: 3px solid #c66a32; padding-bottom: 14px; margin: 0 0 20px; }
  h2 { font-size: 17px; color: #17324d; border-left: 4px solid #c66a32; padding-left: 10px; margin: 24px 0 12px; page-break-after: avoid; }
  h3 { font-size: 15px; color: #409eff; margin: 18px 0 8px; page-break-after: avoid; }
  p { margin: 8px 0; }
  strong { color: #17324d; }
  ol, ul { margin: 8px 0; padding-left: 22px; }
  li { margin: 4px 0; }
  blockquote { margin: 12px 0; padding: 8px 14px; border-left: 4px solid #c66a32; background: #fdf6f0; color: #7c4322; font-size: 12px; }
  code { font-family: "SF Mono", "Menlo", "Consolas", monospace; background: #f5f7fa; color: #c66a32; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  img { display: block; max-width: 100%; height: auto; margin: 12px auto; border: 1px solid #ebeef5; border-radius: 4px; page-break-inside: avoid; }
  hr { border: none; border-top: 1px solid #ebeef5; margin: 18px 0; }
`

function renderHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>${CSS}</style></head><body>${body}</body></html>`
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  for (const f of FILES) {
    const md = fs.readFileSync(path.join(MANUALS_DIR, f.name + '.md'), 'utf8')
    const html = path.join(MANUALS_DIR, f.name + '.html')
    const pdf = path.join(MANUALS_DIR, f.name + '.pdf')
    fs.writeFileSync(html, renderHtml(f.title, marked.parse(md, { gfm: true, breaks: false })), 'utf8')
    const page = await browser.newPage()
    await page.goto('file://' + html, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    await page.pdf({
      path: pdf, format: 'A4', printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:9px;color:#999;width:100%;text-align:center;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' }
    })
    await page.close()
    console.log('已生成 PDF:', pdf, (fs.statSync(pdf).size / 1024).toFixed(0) + ' KB')
  }
  await browser.close()
}
main().catch(e => { console.error(e); process.exit(1) })
