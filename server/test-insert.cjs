const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
async function test() {
  const c = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', database: 'gpss_db' });
  const pw = bcrypt.hashSync('123456', 10);

  // Test with role as parameter
  try {
    await c.query("INSERT INTO users (id,username,password,real_name,email,role,major,major_code,grade) VALUES (?,?,?,?,?,?,?,?,?)",
      ['s001','zhangyi',pw,'张艺','zhangyi@stu.sdada.edu.cn','student','视觉传达设计','130502','2025届']);
    console.log('✅ student OK - all params');
  } catch(e) { console.error('❌ student error:', e.message); }

  await c.end();
}
test();
