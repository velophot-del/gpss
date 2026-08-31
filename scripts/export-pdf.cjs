/* 使用说明 Markdown → PDF 导出脚本
 * 运行：NODE_PATH=/tmp/md2pdf/node_modules:/Users/tangwang/.npm/_npx/31e32ef8478fbf80/node_modules node scripts/export-pdf.cjs
 */
const { marked } = require('marked')
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const DOCS_DIR = path.join(__dirname, '..', 'docs')
const MD_PATH = path.join(DOCS_DIR, '系统使用说明.md')
const HTML_PATH = path.join(DOCS_DIR, '系统使用说明.html')
const PDF_PATH = path.join(DOCS_DIR, '系统使用说明.pdf')
const CHROME = '/Users/tangwang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const md = fs.readFileSync(MD_PATH, 'utf8')
const body = marked.parse(md, { gfm: true, breaks: false })

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>毕业设计管理系统 · 使用说明</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
    color: #303133;
    font-size: 13px;
    line-height: 1.75;
    margin: 0;
  }
  h1 {
    font-size: 22px;
    color: #17324d;
    text-align: center;
    margin: 0 0 8px;
  }
  h1:first-of-type { border-bottom: 3px solid #c66a32; padding-bottom: 14px; margin-bottom: 20px; }
  h2 {
    font-size: 17px;
    color: #17324d;
    border-left: 4px solid #c66a32;
    padding-left: 10px;
    margin: 26px 0 12px;
    page-break-after: avoid;
  }
  h3 {
    font-size: 15px;
    color: #409eff;
    margin: 20px 0 8px;
    page-break-after: avoid;
  }
  h4 { font-size: 13px; color: #303133; margin: 16px 0 6px; }
  p { margin: 8px 0; }
  strong { color: #17324d; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  blockquote {
    margin: 12px 0;
    padding: 8px 14px;
    border-left: 4px solid #c66a32;
    background: #fdf6f0;
    color: #7c4322;
    font-size: 12px;
  }
  code {
    font-family: "SF Mono", "Menlo", "Consolas", monospace;
    background: #f5f7fa;
    color: #c66a32;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 12px;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #dcdfe6;
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eef2f7; color: #17324d; font-weight: 600; }
  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 12px auto;
    border: 1px solid #ebeef5;
    border-radius: 4px;
    page-break-inside: avoid;
  }
  a { color: #409eff; text-decoration: none; }
  hr { border: none; border-top: 1px solid #ebeef5; margin: 20px 0; }
</style>
</head>
<body>
${body}
</body>
</html>`

fs.writeFileSync(HTML_PATH, html, 'utf8')
console.log('已生成 HTML:', HTML_PATH)

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.goto('file://' + HTML_PATH, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.pdf({
    path: PDF_PATH,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font-size:9px; color:#999; width:100%; text-align:center;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
    margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' }
  })
  await browser.close()
  console.log('已生成 PDF:', PDF_PATH)
  const stat = fs.statSync(PDF_PATH)
  console.log('文件大小:', (stat.size / 1024).toFixed(0) + ' KB')
}

main().catch(e => { console.error(e); process.exit(1) })
