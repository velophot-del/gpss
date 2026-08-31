const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function init() {
  // 先创建数据库
  const c0 = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root' });
  await c0.query("CREATE DATABASE IF NOT EXISTS gpss_db DEFAULT CHARACTER SET utf8mb4");
  await c0.end();

  // 每次都新建连接，不使用连接池
  const c = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', database: 'gpss_db' });

  // ===== 建表 =====
  await c.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL,
    real_name VARCHAR(50) NOT NULL, email VARCHAR(100),
    role ENUM('admin','teacher','student') DEFAULT 'student',
    avatar VARCHAR(255), student_id VARCHAR(30), class_name VARCHAR(50), major VARCHAR(50),
    major_code VARCHAR(20), grade VARCHAR(10), title VARCHAR(20), department VARCHAR(50), phone VARCHAR(20),
    status ENUM('active','inactive','suspended') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await c.query(`CREATE TABLE IF NOT EXISTS student_profiles (
    id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
    gpa DECIMAL(3,2) DEFAULT 0.00, ranking INT, total_students INT,
    skills JSON, interests JSON, portfolio JSON, self_intro TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await c.query(`CREATE TABLE IF NOT EXISTS cycles (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT, year VARCHAR(10),
    status ENUM('draft','active','closed') DEFAULT 'draft',
    phase ENUM('topic_submission','student_selection','adjustment','result','ended') DEFAULT 'topic_submission',
    start_date DATE, end_date DATE, phases_config JSON, created_by VARCHAR(36),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await c.query(`CREATE TABLE IF NOT EXISTS topics (
    id VARCHAR(36) PRIMARY KEY, title VARCHAR(200) NOT NULL, description TEXT, category VARCHAR(50) NOT NULL,
    difficulty ENUM('easy','medium','hard') DEFAULT 'medium', max_students TINYINT UNSIGNED DEFAULT 1,
    status ENUM('draft','pending','published','full','closed') DEFAULT 'draft',
    teacher_id VARCHAR(36) NOT NULL, cycle_id INT,
    tags JSON, requirements TEXT, view_count INT UNSIGNED DEFAULT 0, apply_count INT UNSIGNED DEFAULT 0,
    selected_student_ids JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await c.query(`CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(36) PRIMARY KEY, student_id VARCHAR(36) NOT NULL, topic_id VARCHAR(36) NOT NULL,
    priority TINYINT UNSIGNED DEFAULT 1,
    status ENUM('pending','accepted','rejected','cancelled','withdrawn') DEFAULT 'pending',
    motivation TEXT, teacher_comment TEXT, reviewed_by VARCHAR(36), reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await c.query(`CREATE TABLE IF NOT EXISTS adjustments (
    id VARCHAR(36) PRIMARY KEY, student_id VARCHAR(36) NOT NULL,
    from_topic_id VARCHAR(36), to_topic_id VARCHAR(36), reason TEXT,
    status ENUM('pending','approved','rejected') DEFAULT 'pending',
    admin_comment TEXT, processed_by VARCHAR(36), processed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  
  console.log('✅ All tables created');

  const pw = bcrypt.hashSync('123456', 10);
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Admin
  await c.query("INSERT IGNORE INTO users (id,username,password,real_name,email,role) VALUES (?,?,?,?,?,?)",
    ['admin-001', 'admin', pw, '系统管理员', 'admin@sdada.edu.cn', 'admin']);

  // Teachers
  for (const t of [
    ['t001','chen','陈教授','chen@sdada.edu.cn','教授','视觉传达设计系'],
    ['t002','lin','林副教授','lin@sdada.edu.cn','副教授','数字媒体艺术系'],
    ['t003','huang','黄讲师','huang@sdada.edu.cn','讲师','视觉传达设计系'],
    ['t004','zhou','周教授','zhou@sdada.edu.cn','教授','包装工程系'],
    ['t005','wu','吴副教授','wu@sdada.edu.cn','副教授','智能交互设计系']
  ]) {
    await c.query("INSERT IGNORE INTO users (id,username,password,real_name,email,role,title,department) VALUES (?,?,?,?,?,?,?,?)",
      [t[0], t[1], pw, t[2], t[3], 'teacher', t[4], t[5]]);
  }
  console.log('✅ 5 teachers');

  // Students + Profiles in same loop to avoid issues
  for (const s of [
    ['s001','zhangyi','张艺','130502','视觉传达设计','2025届'],
    ['s002','wanghan','王涵','130502','视觉传达设计','2025届'],
    ['s003','linsiyuan','林思远','130508','数字媒体艺术（交互方向）','2025届'],
    ['s004','liushiyu','刘诗雨','130508','数字媒体艺术（交互方向）','2025届'],
    ['s005','zhaomingzhe','赵明哲','081702','包装工程','2025届'],
    ['s006','sunxiaomeng','孙晓萌','080906T','智能交互（工科）','2025届']
  ]) {
    await c.query("INSERT INTO users (id,username,password,real_name,email,role,major,major_code,grade) VALUES (?,?,?,?,?,?,?,?,?)",
      [s[0], s[1], pw, s[2], s[1] + '@stu.sdada.edu.cn', 'student', s[4], s[3], s[5]]);
    
    try {
      await c.query("INSERT INTO student_profiles (id,user_id,gpa,skills,interests,self_intro) VALUES (?,?,?,?,?,?)",
        [uuid(), s[0], '3.65', JSON.stringify(['Photoshop','Illustrator','Figma']), JSON.stringify(['品牌形象设计','包装设计']), `我是${s[4]}专业学生`]);
    } catch(e) {
      console.error('profile err for', s[0], ':', e.message);
    }
  }
  console.log('✅ 6 students + profiles');

  // Cycle
  const cr = await c.query("INSERT INTO cycles (name,description,year,status,phase,start_date,end_date) VALUES (?,?,?,?,?,?,?)",
    ['2025届山东工艺美术学院视觉传达设计学院本科毕业设计选题',
     '涵盖视觉传达设计、数字媒体艺术、包装工程、智能交互等专业方向',
     '2025','active','student_selection','2025-01-10','2025-06-30']);
  const cycleId = cr[0].insertId;

  // Topics
  for (const t of [
    ['非遗蜀锦纹样在现代品牌VI中的创新应用研究','品牌形象设计','hard',1,'t001'],
    ['新式茶饮品牌"茶境"全案包装与空间视觉设计','包装设计','medium',2,'t001'],
    ['适老化智能家居APP交互界面设计与可用性研究','交互界面设计','hard',1,'t002'],
    ['城市记忆——济南泉水文化沉浸式动态视觉装置设计','数字媒体艺术','hard',1,'t002'],
    ['《山海经》异兽主题原创儿童绘本创作','书籍与绘本设计','medium',2,'t003'],
    ['基于情感计算的可变字体实验设计','字体与版式设计','medium',1,'t003'],
    ['基于生物降解材料的绿色食品包装结构设计','包装结构与工艺','hard',1,'t004'],
    ['生鲜冷链智能温控包装系统设计研究','智能包装系统','hard',1,'t004'],
    ['AI驱动的中国风插画生成工具设计与实现','AI创意设计','hard',1,'t005'],
    ['博物馆文物AR导览交互体验设计','跨媒介设计','medium',2,'t005'],
    ['Z世代国潮美妆品牌视觉形象升级设计','品牌形象设计','easy',2,'t001'],
    ['气候变化数据可视化动态短片创作','动态视觉与动画','medium',1,'t002']
  ]) {
    await c.query("INSERT INTO topics (id,title,description,category,difficulty,max_students,status,teacher_id,cycle_id,tags) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [uuid(), t[0], '', t[1], t[2], t[3], 'published', t[4], cycleId, '[]']);
  }
  console.log('✅ 12 topics');

  // Sample applications
  const topicList = (await c.query("SELECT id FROM topics"))[0];
  if (topicList.length >= 3) {
    await c.query("INSERT INTO applications (id,student_id,topic_id,priority,status,motivation) VALUES (?,?,?,?,?,?)",
      [uuid(), 's001', topicList[0].id, 1, 'accepted', '我对这个课题很感兴趣']);
    await c.query("INSERT INTO applications (id,student_id,topic_id,priority,status,motivation) VALUES (?,?,?,?,?,?)",
      [uuid(), 's003', topicList[2].id, 1, 'accepted', '我的毕设方向是交互设计']);
    if (topicList.length >= 11) {
      await c.query("INSERT INTO applications (id,student_id,topic_id,priority,status,motivation) VALUES (?,?,?,?,?,?)",
        [uuid(), 's001', topicList[10].id, 2, 'pending', '作为备选方向']);
    }
  }
  console.log('✅ sample data done');

  console.log('\n🎉 All ready!');
  console.log('\n演示账号: admin / chen / zhangyi  密码: 123456');
  await c.end();
}

init().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
