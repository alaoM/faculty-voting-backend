import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INITIAL_CATEGORIES = [
  { id: 'cat-1', title: 'Facilitator of the Year', description: 'For the facilitator who consistently delivers engaging, well-prepared, and impactful training sessions that participants rate highly.', sort_order: 1 },
  { id: 'cat-2', title: 'Best Researcher (Publication)', description: "For the faculty member with the most notable research output or publication(s) this year, advancing ARMTI's knowledge base.", sort_order: 2 },
  { id: 'cat-3', title: 'Best Course Coordinator', description: 'For the coordinator who runs their course(s) with the most organization, attention to detail, and smooth execution from planning to delivery.', sort_order: 3 },
  { id: 'cat-4', title: 'Mentorship Excellence Award', description: 'For the staff member who goes out of their way to guide, coach, and develop younger or newer colleagues.', sort_order: 4 },
  { id: 'cat-5', title: 'Digital Excellence Award', description: 'For the staff member who has driven the most innovative use of technology or digital tools in the faculty.', sort_order: 5 },
  { id: 'cat-6', title: 'Excellence in Knowledge Transfer', description: 'For the faculty member most effective at translating complex expertise into practical, easy-to-apply learning for participants.', sort_order: 6 },
  { id: 'cat-7', title: "Service Excellence Award (Executive Director's Award)", description: "Special recognition, at the Executive Director's discretion, for outstanding overall service to the institute.", sort_order: 7 },
  { id: 'cat-8', title: 'ARMTI Ambassador Award', description: "For the staff member who best represents ARMTI's values and reputation, both within the institute and in the wider public/professional space.", sort_order: 8 },
  { id: 'cat-9', title: 'Community Development Impact Award', description: 'For the staff member whose work has made a measurable difference in rural/agricultural communities beyond the classroom.', sort_order: 9 },
  { id: 'cat-10', title: 'Retirement / Distinguished Service Recognition', description: "Honoring a staff member's long-term, cumulative contribution to ARMTI, typically at or near retirement.", sort_order: 10 },
  { id: 'cat-11', title: 'Most Punctual', description: 'For the staff member consistently on time — to work, meetings, and sessions — without fail.', sort_order: 11 },
  { id: 'cat-12', title: 'Most Supportive Boss', description: 'For the manager or supervisor who staff feel genuinely backs them, listens to them, and helps them grow.', sort_order: 12 },
  { id: 'cat-13a', title: 'Best Dressed (Male)', description: 'For the male staff member who consistently brings polish and professionalism to how he presents himself.', sort_order: 13 },
  { id: 'cat-13b', title: 'Best Dressed (Female)', description: 'For the female staff member who consistently brings polish and professionalism to how she presents herself.', sort_order: 14 },
  { id: 'cat-14', title: 'Most Dependable Staff', description: 'For the person colleagues can always count on to deliver, follow through, and show up when it matters.', sort_order: 15 },
  { id: 'cat-15', title: 'Most Friendly / Approachable Staff', description: "For the staff member who's easiest to talk to, warm with colleagues, and welcoming to everyone regardless of rank.", sort_order: 16 },
  { id: 'cat-16', title: 'Team Player', description: 'For the staff member who consistently puts team success above individual credit and pitches in wherever needed.', sort_order: 17 },
  { id: 'cat-17', title: 'Most Resourceful', description: 'For the staff member who consistently finds practical solutions with whatever is available, adapting quickly and getting things done even when resources, time, or information are limited.', sort_order: 18 },
  { id: 'cat-18', title: 'Most Dedicated', description: 'For the staff member who shows exceptional commitment and goes above and beyond their basic job requirements.', sort_order: 19 },
  { id: 'cat-19', title: 'Most Courteous Staff Award', description: 'For the staff member known for consistent politeness, respect, and good manners in all interactions.', sort_order: 20 },
  { id: 'cat-20', title: 'Best Support Staff', description: 'For the non-faculty staff member whose work behind the scenes keeps ARMTI running smoothly.', sort_order: 21 },
  { id: 'cat-21', title: 'Best Outstation Staff Award', description: 'For outstanding staff serving in ARMTI outstations and regional training centers across the 6 geopolitical zones.', sort_order: 22 }
];

let dbMode = 'sqlite';
let mysqlPool = null;
let sqliteDb = null;

export async function initDB() {
  const dbType = (process.env.DB_TYPE || 'mysql').toLowerCase();

  if (dbType === 'mysql') {
    try {
      console.log(`🔌 Connecting to MySQL (${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306})...`);
      
      const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || ''
      });

      const dbName = process.env.DB_NAME || 'armti_voting';
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await connection.end();

      mysqlPool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: dbName,
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0
      });

      await mysqlPool.query('SELECT 1');
      dbMode = 'mysql';
      console.log(`✅ Connected to MySQL Database: ${dbName}`);
      await createMySQLTables();
      await seedMySQLCategories();
      return { mode: 'mysql' };
    } catch (err) {
      console.warn(`⚠️ MySQL connection notice: ${err.message}. Using embedded SQLite for instant zero-lag operation.`);
      initSQLiteFallback();
      return { mode: 'sqlite', warning: err.message };
    }
  } else {
    initSQLiteFallback();
    return { mode: 'sqlite' };
  }
}

function initSQLiteFallback() {
  dbMode = 'sqlite';
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'voting.db');
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  createSQLiteTables();
  seedSQLiteCategories();
  console.log(`✅ SQLite Database active at: ${dbPath}`);
}

async function createMySQLTables() {
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS voters (
      staff_id VARCHAR(64) PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NULL,
      division VARCHAR(255) NULL,
      training_center VARCHAR(255) NULL,
      has_voted TINYINT(1) DEFAULT 0,
      voted_at DATETIME NULL,
      receipt_code VARCHAR(64) NULL,
      is_manual TINYINT(1) DEFAULT 0,
      is_eligible TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Safe Column Migrations for MySQL
  const [cols] = await mysqlPool.query('SHOW COLUMNS FROM voters');
  const colNames = cols.map(c => c.Field);
  if (!colNames.includes('receipt_code')) {
    await mysqlPool.query('ALTER TABLE voters ADD COLUMN receipt_code VARCHAR(64) NULL');
  }
  if (!colNames.includes('is_manual')) {
    await mysqlPool.query('ALTER TABLE voters ADD COLUMN is_manual TINYINT(1) DEFAULT 0');
  }
  if (!colNames.includes('is_eligible')) {
    await mysqlPool.query('ALTER TABLE voters ADD COLUMN is_eligible TINYINT(1) DEFAULT 1');
  }

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(64) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      sort_order INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS ballots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      receipt_code VARCHAR(64) NULL,
      category_id VARCHAR(64) NOT NULL,
      category_title VARCHAR(255) NOT NULL,
      nominee_staff_id VARCHAR(64) NULL,
      nominee_name VARCHAR(255) NOT NULL,
      nominee_dept VARCHAR(255) NULL,
      citations TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_receipt (receipt_code),
      INDEX idx_cat (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [ballotCols] = await mysqlPool.query('SHOW COLUMNS FROM ballots');
  const ballotColNames = ballotCols.map(c => c.Field);
  if (!ballotColNames.includes('citations')) {
    await mysqlPool.query('ALTER TABLE ballots ADD COLUMN citations TEXT NULL');
  }

  await mysqlPool.query(`
    INSERT IGNORE INTO categories (id, title, description, sort_order, is_active)
    VALUES ('cat-21', 'Best Outstation Staff Award', 'For outstanding staff serving in ARMTI outstations and regional training centers across the 6 geopolitical zones.', 22, 1);
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS researcher_submissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      staff_id VARCHAR(64) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NULL,
      publications TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_staff_pub (staff_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      action_type VARCHAR(64) NOT NULL,
      target_staff_id VARCHAR(64) NULL,
      target_name VARCHAR(255) NULL,
      reason TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(64) PRIMARY KEY,
      val TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await mysqlPool.query(`
    INSERT IGNORE INTO settings (key_name, val) VALUES ('election_status', 'OPEN');
  `);
  await mysqlPool.query(`
    INSERT IGNORE INTO settings (key_name, val) VALUES ('allow_self_voting', '0');
  `);
  await mysqlPool.query(`
    INSERT IGNORE INTO settings (key_name, val) VALUES ('voting_end_time', '');
  `);
}

function createSQLiteTables() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS voters (
      staff_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      department TEXT,
      division TEXT,
      training_center TEXT,
      has_voted INTEGER DEFAULT 0,
      voted_at TEXT,
      receipt_code TEXT,
      is_manual INTEGER DEFAULT 0,
      is_eligible INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ballots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT,
      category_id TEXT NOT NULL,
      category_title TEXT NOT NULL,
      nominee_staff_id TEXT,
      nominee_name TEXT NOT NULL,
      nominee_dept TEXT,
      citations TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS researcher_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      department TEXT,
      publications TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      target_staff_id TEXT,
      target_name TEXT,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key_name TEXT PRIMARY KEY,
      val TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key_name, val) VALUES ('election_status', 'OPEN');
    INSERT OR IGNORE INTO settings (key_name, val) VALUES ('allow_self_voting', '0');
    INSERT OR IGNORE INTO settings (key_name, val) VALUES ('voting_end_time', '');
    INSERT OR IGNORE INTO categories (id, title, description, sort_order, is_active) VALUES ('cat-21', 'Best Outstation Staff Award', 'For outstanding staff serving in ARMTI outstations and regional training centers across the 6 geopolitical zones.', 22, 1);
  `);

  // Safe Column Migrations for SQLite
  try {
    const voterCols = sqliteDb.prepare('PRAGMA table_info(voters)').all().map(c => c.name);
    if (!voterCols.includes('receipt_code')) {
      sqliteDb.exec('ALTER TABLE voters ADD COLUMN receipt_code TEXT');
    }
    if (!voterCols.includes('is_manual')) {
      sqliteDb.exec('ALTER TABLE voters ADD COLUMN is_manual INTEGER DEFAULT 0');
    }
    if (!voterCols.includes('is_eligible')) {
      sqliteDb.exec('ALTER TABLE voters ADD COLUMN is_eligible INTEGER DEFAULT 1');
    }
    sqliteDb.exec('UPDATE voters SET is_eligible = 1 WHERE is_eligible IS NULL');

    const ballotCols = sqliteDb.prepare('PRAGMA table_info(ballots)').all().map(c => c.name);
    if (!ballotCols.includes('receipt_code')) {
      sqliteDb.exec('ALTER TABLE ballots ADD COLUMN receipt_code TEXT');
    }
    if (!ballotCols.includes('citations')) {
      sqliteDb.exec('ALTER TABLE ballots ADD COLUMN citations TEXT');
    }
  } catch (err) {
    console.warn('SQLite migration notice:', err.message);
  }
}

async function seedMySQLCategories() {
  const [rows] = await mysqlPool.query('SELECT COUNT(*) as count FROM categories');
  if (rows[0].count === 0) {
    for (const cat of INITIAL_CATEGORIES) {
      await mysqlPool.query(
        'INSERT INTO categories (id, title, description, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
        [cat.id, cat.title, cat.description, cat.sort_order]
      );
    }
    console.log(`🌱 Seeded ${INITIAL_CATEGORIES.length} award categories into MySQL`);
  }
}

function seedSQLiteCategories() {
  const countRow = sqliteDb.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (countRow.count === 0) {
    const insert = sqliteDb.prepare(
      'INSERT INTO categories (id, title, description, sort_order, is_active) VALUES (?, ?, ?, ?, 1)'
    );
    const insertMany = sqliteDb.transaction((cats) => {
      for (const cat of cats) insert.run(cat.id, cat.title, cat.description, cat.sort_order);
    });
    insertMany(INITIAL_CATEGORIES);
    console.log(`🌱 Seeded ${INITIAL_CATEGORIES.length} award categories into SQLite`);
  }
}

export function getDatabaseMode() {
  return dbMode;
}

export async function getVoter(staffId) {
  const normalizedId = String(staffId).trim();
  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query(
      'SELECT * FROM voters WHERE LOWER(TRIM(staff_id)) = LOWER(?)',
      [normalizedId]
    );
    return rows[0] || null;
  } else {
    return sqliteDb.prepare(
      'SELECT * FROM voters WHERE LOWER(TRIM(staff_id)) = LOWER(?)'
    ).get(normalizedId) || null;
  }
}

export async function getAllVoters(includeIneligible = false) {
  const query = includeIneligible
    ? 'SELECT * FROM voters ORDER BY full_name ASC'
    : 'SELECT * FROM voters WHERE is_eligible = 1 ORDER BY full_name ASC';

  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query(query);
    return rows;
  } else {
    return sqliteDb.prepare(query).all();
  }
}

export async function addManualFaculty({ staff_id, full_name, department, division, training_center }) {
  const normalizedId = String(staff_id).trim();
  const cleanName = String(full_name).trim().replace(/\s+/g, ' ');

  if (!normalizedId || !cleanName) {
    throw new Error('Staff ID and Full Name are required.');
  }

  const existing = await getVoter(normalizedId);
  if (existing) {
    throw new Error(`Staff ID '${normalizedId}' already exists in the roster (${existing.full_name}).`);
  }

  if (dbMode === 'mysql') {
    await mysqlPool.query(
      `INSERT INTO voters (staff_id, full_name, department, division, training_center, is_manual, is_eligible)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [normalizedId, cleanName, department?.trim() || 'ARMTI Faculty', division?.trim() || '', training_center?.trim() || '']
    );
  } else {
    sqliteDb.prepare(
      `INSERT INTO voters (staff_id, full_name, department, division, training_center, is_manual, is_eligible)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    ).run(normalizedId, cleanName, department?.trim() || 'ARMTI Faculty', division?.trim() || '', training_center?.trim() || '');
  }

  await logAdminAction('QUICK_ADD_FACULTY', normalizedId, cleanName, 'Manually added to roster via Admin Emergency Bypass');
  return { staff_id: normalizedId, full_name: cleanName, department: department || 'ARMTI Faculty', is_manual: 1, is_eligible: 1 };
}

export async function upsertVoters(voterList) {
  let inserted = 0;
  let updated = 0;

  if (dbMode === 'mysql') {
    for (const v of voterList) {
      const [existing] = await mysqlPool.query('SELECT staff_id, has_voted, is_manual, is_eligible FROM voters WHERE staff_id = ?', [v.staff_id]);
      if (existing.length === 0) {
        await mysqlPool.query(
          `INSERT INTO voters (staff_id, full_name, department, division, training_center, is_manual, is_eligible)
           VALUES (?, ?, ?, ?, ?, 0, 1)`,
          [v.staff_id, v.full_name, v.department, v.division, v.training_center]
        );
        inserted++;
      } else {
        await mysqlPool.query(
          `UPDATE voters SET full_name = ?, department = ?, division = ?, training_center = ?
           WHERE staff_id = ?`,
          [v.full_name, v.department, v.division, v.training_center, v.staff_id]
        );
        updated++;
      }
    }
  } else {
    const checkStmt = sqliteDb.prepare('SELECT staff_id, has_voted, is_manual, is_eligible FROM voters WHERE staff_id = ?');
    const insertStmt = sqliteDb.prepare(
      `INSERT INTO voters (staff_id, full_name, department, division, training_center, is_manual, is_eligible)
       VALUES (?, ?, ?, ?, ?, 0, 1)`
    );
    const updateStmt = sqliteDb.prepare(
      `UPDATE voters SET full_name = ?, department = ?, division = ?, training_center = ?
       WHERE staff_id = ?`
    );

    const syncTransaction = sqliteDb.transaction((list) => {
      for (const v of list) {
        const exist = checkStmt.get(v.staff_id);
        if (!exist) {
          insertStmt.run(v.staff_id, v.full_name, v.department, v.division, v.training_center);
          inserted++;
        } else {
          updateStmt.run(v.full_name, v.department, v.division, v.training_center, v.staff_id);
          updated++;
        }
      }
    });
    syncTransaction(voterList);
  }

  return { inserted, updated, total: voterList.length };
}

export async function invalidateVoterBallot(staffId, reason = 'Impersonation dispute / re-vote requested') {
  const voter = await getVoter(staffId);
  if (!voter) {
    throw new Error(`Staff ID '${staffId}' not found.`);
  }

  if (!voter.has_voted) {
    throw new Error(`Staff ID '${staffId}' has not cast a vote yet.`);
  }

  const receiptCode = voter.receipt_code;

  if (dbMode === 'mysql') {
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Delete associated ballots
      if (receiptCode) {
        await connection.query('DELETE FROM ballots WHERE receipt_code = ?', [receiptCode]);
      }

      // 2. Reset voter status
      await connection.query(
        'UPDATE voters SET has_voted = 0, voted_at = NULL, receipt_code = NULL WHERE staff_id = ?',
        [voter.staff_id]
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } else {
    const deleteBallots = sqliteDb.prepare('DELETE FROM ballots WHERE receipt_code = ?');
    const resetVoter = sqliteDb.prepare(
      'UPDATE voters SET has_voted = 0, voted_at = NULL, receipt_code = NULL WHERE staff_id = ?'
    );

    const transaction = sqliteDb.transaction(() => {
      if (receiptCode) deleteBallots.run(receiptCode);
      resetVoter.run(voter.staff_id);
    });
    transaction();
  }

  await logAdminAction('INVALIDATE_BALLOT', voter.staff_id, voter.full_name, `Ballot (Ref: ${receiptCode || 'N/A'}) purged. Reason: ${reason}`);
  return { success: true, message: `Ballot for ${voter.full_name} (${voter.staff_id}) has been invalidated. They can now re-vote.` };
}

export async function revokeVoterEligibility(staffId, reason = 'Identified as non-faculty') {
  const voter = await getVoter(staffId);
  if (!voter) {
    throw new Error(`Staff ID '${staffId}' not found.`);
  }

  const receiptCode = voter.receipt_code;

  if (dbMode === 'mysql') {
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Purge votes if already voted
      if (receiptCode) {
        await connection.query('DELETE FROM ballots WHERE receipt_code = ?', [receiptCode]);
      }

      // 2. Mark ineligible & reset
      await connection.query(
        'UPDATE voters SET is_eligible = 0, has_voted = 0, voted_at = NULL, receipt_code = NULL WHERE staff_id = ?',
        [voter.staff_id]
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } else {
    const deleteBallots = sqliteDb.prepare('DELETE FROM ballots WHERE receipt_code = ?');
    const revokeVoter = sqliteDb.prepare(
      'UPDATE voters SET is_eligible = 0, has_voted = 0, voted_at = NULL, receipt_code = NULL WHERE staff_id = ?'
    );

    const transaction = sqliteDb.transaction(() => {
      if (receiptCode) deleteBallots.run(receiptCode);
      revokeVoter.run(voter.staff_id);
    });
    transaction();
  }

  await logAdminAction('REVOKE_ELIGIBILITY', voter.staff_id, voter.full_name, `Eligibility revoked. Reason: ${reason}`);
  return { success: true, message: `Eligibility for ${voter.full_name} (${voter.staff_id}) has been revoked.` };
}

export async function logAdminAction(action_type, target_staff_id, target_name, reason) {
  const now = new Date();
  if (dbMode === 'mysql') {
    await mysqlPool.query(
      `INSERT INTO audit_logs (action_type, target_staff_id, target_name, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [action_type, target_staff_id || null, target_name || null, reason || '', now]
    );
  } else {
    sqliteDb.prepare(
      `INSERT INTO audit_logs (action_type, target_staff_id, target_name, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(action_type, target_staff_id || null, target_name || null, reason || '', now.toISOString());
  }
}

export async function getAuditLogs() {
  const query = 'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200';
  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query(query);
    return rows;
  } else {
    return sqliteDb.prepare(query).all();
  }
}

export async function getCategories(includeInactive = false) {
  const query = includeInactive
    ? 'SELECT * FROM categories ORDER BY sort_order ASC'
    : 'SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC';

  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query(query);
    return rows;
  } else {
    return sqliteDb.prepare(query).all();
  }
}

export async function addCategory({ id, title, description, sort_order = 99 }) {
  const catId = id || 'cat-' + Date.now();
  if (dbMode === 'mysql') {
    await mysqlPool.query(
      'INSERT INTO categories (id, title, description, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
      [catId, title, description || '', sort_order]
    );
  } else {
    sqliteDb.prepare(
      'INSERT INTO categories (id, title, description, sort_order, is_active) VALUES (?, ?, ?, ?, 1)'
    ).run(catId, title, description || '', sort_order);
  }
  await logAdminAction('ADD_CATEGORY', catId, title, 'Added new award category');
  return { id: catId, title, description, sort_order, is_active: 1 };
}

export async function updateCategory(id, { title, description, sort_order, is_active }) {
  if (dbMode === 'mysql') {
    await mysqlPool.query(
      `UPDATE categories 
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           sort_order = COALESCE(?, sort_order),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [title, description, sort_order, is_active, id]
    );
  } else {
    const current = sqliteDb.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!current) return null;
    sqliteDb.prepare(
      `UPDATE categories 
       SET title = ?, description = ?, sort_order = ?, is_active = ?
       WHERE id = ?`
    ).run(
      title !== undefined ? title : current.title,
      description !== undefined ? description : current.description,
      sort_order !== undefined ? sort_order : current.sort_order,
      is_active !== undefined ? is_active : current.is_active,
      id
    );
  }
  await logAdminAction('UPDATE_CATEGORY', id, title || id, 'Updated award category properties');
  return true;
}

export async function deleteCategory(id) {
  let voteCount = 0;
  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query('SELECT COUNT(*) as count FROM ballots WHERE category_id = ?', [id]);
    voteCount = rows[0].count;
    if (voteCount > 0) {
      throw new Error('Cannot delete award category that has recorded votes. Please deactivate it instead.');
    }
    await mysqlPool.query('DELETE FROM categories WHERE id = ?', [id]);
  } else {
    const row = sqliteDb.prepare('SELECT COUNT(*) as count FROM ballots WHERE category_id = ?').get(id);
    voteCount = row.count;
    if (voteCount > 0) {
      throw new Error('Cannot delete award category that has recorded votes. Please deactivate it instead.');
    }
    sqliteDb.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }
  await logAdminAction('DELETE_CATEGORY', id, id, 'Deleted award category');
  return true;
}

export async function getSettings() {
  const settingsObj = {};
  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query('SELECT key_name, val FROM settings');
    rows.forEach((r) => { settingsObj[r.key_name] = r.val; });
  } else {
    const rows = sqliteDb.prepare('SELECT key_name, val FROM settings').all();
    rows.forEach((r) => { settingsObj[r.key_name] = r.val; });
  }
  return settingsObj;
}

export async function updateSetting(key, val) {
  if (dbMode === 'mysql') {
    await mysqlPool.query(
      `INSERT INTO settings (key_name, val) VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE val = VALUES(val)`,
      [key, String(val)]
    );
  } else {
    sqliteDb.prepare(
      `INSERT INTO settings (key_name, val) VALUES (?, ?)
       ON CONFLICT(key_name) DO UPDATE SET val = excluded.val`
    ).run(key, String(val));
  }
  return true;
}

export function validatePublicationYears(text) {
  if (!text || !text.trim()) {
    return { valid: true };
  }

  const cleanText = text.trim();
  const yearMatches = cleanText.match(/\b(19\d{2}|20\d{2})\b/g) || [];
  const years = yearMatches.map(Number);

  const invalidPastYears = years.filter((y) => y < 2025);
  if (invalidPastYears.length > 0) {
    const earliestInvalid = Math.min(...invalidPastYears);
    return {
      valid: false,
      error: `Invalid publication year detected (${earliestInvalid}). Only publications published in 2025 and 2026 are eligible for the 2026 Faculty Awards.`
    };
  }

  const futureYears = years.filter((y) => y > 2026);
  if (futureYears.length > 0) {
    return {
      valid: false,
      error: `Invalid publication year detected (${futureYears[0]}). Only publications from 2025 and 2026 are eligible.`
    };
  }

  const validYears = years.filter((y) => y === 2025 || y === 2026);
  if (validYears.length === 0) {
    return {
      valid: false,
      error: 'Please explicitly state the publication year (2025 or 2026) for your research output (e.g., "(2025)" or "(2026)").'
    };
  }

  return { valid: true, validYears };
}

export async function submitBallot(staffId, votesArray) {
  const normalizedId = String(staffId).trim();
  const receiptCode = 'ARMTI-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString().slice(-4);
  const now = new Date();

  if (!Array.isArray(votesArray) || votesArray.length === 0) {
    throw new Error('Ballot payload cannot be empty.');
  }

  const seenCategories = new Set();
  for (const item of votesArray) {
    if (!item.category_id || !item.category_title) {
      throw new Error('Invalid ballot format: Category ID and Title are required.');
    }
    if (seenCategories.has(item.category_id)) {
      throw new Error(`Duplicate vote submitted for category '${item.category_title}'.`);
    }
    seenCategories.add(item.category_id);
  }

  // Validate Publication Years for Best Researcher (Strict 2025 & 2026 only)
  const researcherItem = votesArray.find(
    (item) => item.category_id === 'cat-2' || item.category_title?.toLowerCase().includes('research')
  );
  if (researcherItem && researcherItem.citations && researcherItem.citations.trim()) {
    const yearValidation = validatePublicationYears(researcherItem.citations);
    if (!yearValidation.valid) {
      throw new Error(yearValidation.error);
    }
  }

  const settings = await getSettings();
  const allowSelfVoting = settings.allow_self_voting === '1' || settings.allow_self_voting === 'true';

  if (!allowSelfVoting) {
    for (const item of votesArray) {
      if (item.nominee_staff_id && String(item.nominee_staff_id).trim().toLowerCase() === normalizedId.toLowerCase()) {
        throw new Error(`Self-nomination is not permitted for award '${item.category_title}'. Please select a fellow colleague.`);
      }
    }
  }

  if (dbMode === 'mysql') {
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();

      const [voters] = await connection.query(
        'SELECT staff_id, has_voted, is_eligible, full_name FROM voters WHERE LOWER(TRIM(staff_id)) = LOWER(?) FOR UPDATE',
        [normalizedId]
      );

      if (voters.length === 0) {
        throw new Error(`Staff ID '${normalizedId}' is not recognized as an eligible ARMTI Faculty member. Please verify your Staff ID or contact the election committee.`);
      }

      const voter = voters[0];
      if (!voter.is_eligible) {
        throw new Error(`Staff ID '${normalizedId}' has been flagged as ineligible by the election committee.`);
      }
      if (voter.has_voted) {
        throw new Error('This Faculty Member has already cast a vote.');
      }

      for (const item of votesArray) {
        if (!item.nominee_name || item.nominee_name === '__ABSTAIN__') {
          continue;
        }
        await connection.query(
          `INSERT INTO ballots (receipt_code, category_id, category_title, nominee_staff_id, nominee_name, nominee_dept, citations)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [receiptCode, item.category_id, item.category_title, item.nominee_staff_id || null, item.nominee_name, item.nominee_dept || null, item.citations?.trim() || null]
        );
      }

      // Record voter's own research publication submission if provided for Best Researcher
      const researcherVote = votesArray.find((item) => item.category_id === 'cat-2' || item.category_title?.toLowerCase().includes('research'));
      const personalPubs = researcherVote?.citations?.trim();
      if (personalPubs) {
        await connection.query(
          `INSERT INTO researcher_submissions (staff_id, full_name, department, publications, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE publications = VALUES(publications), created_at = VALUES(created_at)`,
          [voter.staff_id, voter.full_name, voter.department || 'ARMTI Faculty', personalPubs, now]
        );
      }

      await connection.query(
        `UPDATE voters SET has_voted = 1, voted_at = ?, receipt_code = ? WHERE staff_id = ?`,
        [now, receiptCode, voter.staff_id]
      );

      await connection.commit();
      return { success: true, receipt_code: receiptCode, voted_at: now, full_name: voter.full_name };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } else {
    const voter = sqliteDb.prepare('SELECT * FROM voters WHERE LOWER(TRIM(staff_id)) = LOWER(?)').get(normalizedId);
    if (!voter) {
      throw new Error(`Staff ID '${normalizedId}' is not recognized as an eligible ARMTI Faculty member. Please verify your Staff ID or contact the election committee.`);
    }
    if (!voter.is_eligible) {
      throw new Error(`Staff ID '${normalizedId}' has been flagged as ineligible by the election committee.`);
    }
    if (voter.has_voted) {
      throw new Error('This Faculty Member has already cast a vote.');
    }

    const insertBallot = sqliteDb.prepare(
      `INSERT INTO ballots (receipt_code, category_id, category_title, nominee_staff_id, nominee_name, nominee_dept, citations)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const updateVoter = sqliteDb.prepare(
      `UPDATE voters SET has_voted = 1, voted_at = ?, receipt_code = ? WHERE staff_id = ?`
    );

    const insertPubStmt = sqliteDb.prepare(
      `INSERT INTO researcher_submissions (staff_id, full_name, department, publications, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(staff_id) DO UPDATE SET publications = excluded.publications, created_at = excluded.created_at`
    );

    const voteTransaction = sqliteDb.transaction(() => {
      for (const item of votesArray) {
        if (!item.nominee_name || item.nominee_name === '__ABSTAIN__') {
          continue;
        }
        insertBallot.run(receiptCode, item.category_id, item.category_title, item.nominee_staff_id || null, item.nominee_name, item.nominee_dept || null, item.citations?.trim() || null);
      }

      // Record voter's own research publication submission if provided for Best Researcher
      const researcherVote = votesArray.find((item) => item.category_id === 'cat-2' || item.category_title?.toLowerCase().includes('research'));
      const personalPubs = researcherVote?.citations?.trim();
      if (personalPubs) {
        insertPubStmt.run(voter.staff_id, voter.full_name, voter.department || 'ARMTI Faculty', personalPubs, now.toISOString());
      }

      updateVoter.run(now.toISOString(), receiptCode, voter.staff_id);
    });

    voteTransaction();
    return { success: true, receipt_code: receiptCode, voted_at: now.toISOString(), full_name: voter.full_name };
  }
}

export async function getElectionStatus() {
  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query("SELECT val FROM settings WHERE key_name = 'election_status'");
    return rows[0] ? rows[0].val : 'OPEN';
  } else {
    const row = sqliteDb.prepare("SELECT val FROM settings WHERE key_name = 'election_status'").get();
    return row ? row.val : 'OPEN';
  }
}

export async function setElectionStatus(status) {
  if (dbMode === 'mysql') {
    await mysqlPool.query("UPDATE settings SET val = ? WHERE key_name = 'election_status'", [status]);
  } else {
    sqliteDb.prepare("UPDATE settings SET val = ? WHERE key_name = 'election_status'").run(status);
  }
  await logAdminAction('CHANGE_ELECTION_STATUS', null, status, `Election phase updated to ${status}`);
  return status;
}

export async function getResults() {
  const categories = await getCategories(true);
  const results = [];

  for (const cat of categories) {
    let tallies = [];
    if (dbMode === 'mysql') {
      const [rows] = await mysqlPool.query(
        `SELECT nominee_name, nominee_dept, COUNT(*) as vote_count 
         FROM ballots 
         WHERE category_id = ? 
         GROUP BY nominee_name, nominee_dept 
         ORDER BY vote_count DESC`,
        [cat.id]
      );
      tallies = rows;
    } else {
      tallies = sqliteDb.prepare(
        `SELECT nominee_name, nominee_dept, COUNT(*) as vote_count 
         FROM ballots 
         WHERE category_id = ? 
         GROUP BY nominee_name, nominee_dept 
         ORDER BY vote_count DESC`
      ).all(cat.id);
    }

    const totalCategoryVotes = tallies.reduce((sum, item) => sum + Number(item.vote_count), 0);
    const rankedTallies = tallies.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      percentage: totalCategoryVotes > 0 ? ((item.vote_count / totalCategoryVotes) * 100).toFixed(1) : '0.0'
    }));

    results.push({
      category_id: cat.id,
      category_title: cat.title,
      category_description: cat.description,
      total_votes: totalCategoryVotes,
      tallies: rankedTallies
    });
  }

  let totalVoters = 0;
  let totalCast = 0;

  if (dbMode === 'mysql') {
    const [voterStats] = await mysqlPool.query(`
      SELECT 
        COUNT(*) as total, 
        SUM(CASE WHEN has_voted = 1 THEN 1 ELSE 0 END) as cast_count 
      FROM voters
      WHERE is_eligible = 1
    `);
    totalVoters = voterStats[0].total || 0;
    totalCast = voterStats[0].cast_count || 0;
  } else {
    const stats = sqliteDb.prepare(`
      SELECT 
        COUNT(*) as total, 
        SUM(CASE WHEN has_voted = 1 THEN 1 ELSE 0 END) as cast_count 
      FROM voters
      WHERE is_eligible = 1
    `).get();
    totalVoters = stats.total || 0;
    totalCast = stats.cast_count || 0;
  }

  return {
    turnout: {
      total_eligible: totalVoters,
      total_voted: totalCast,
      pending: totalVoters - totalCast,
      percentage: totalVoters > 0 ? ((totalCast / totalVoters) * 100).toFixed(1) : '0.0'
    },
    categories: results
  };
}

export async function resetElection() {
  if (dbMode === 'mysql') {
    await mysqlPool.query('DELETE FROM ballots');
    await mysqlPool.query('DELETE FROM researcher_submissions');
    await mysqlPool.query('UPDATE voters SET has_voted = 0, voted_at = NULL, receipt_code = NULL, is_eligible = 1');
  } else {
    sqliteDb.exec(`
      DELETE FROM ballots;
      DELETE FROM researcher_submissions;
      UPDATE voters SET has_voted = 0, voted_at = NULL, receipt_code = NULL, is_eligible = 1;
    `);
  }
  await logAdminAction('RESET_ELECTION', null, null, 'All ballots and researcher submissions were cleared and voter statuses reset.');
  return true;
}

export async function getResearchPublications() {
  const query = `
    SELECT 
      staff_id, 
      full_name, 
      department, 
      publications as citations, 
      created_at 
    FROM researcher_submissions 
    ORDER BY full_name ASC
  `;
  if (dbMode === 'mysql') {
    const [rows] = await mysqlPool.query(query);
    return rows;
  } else {
    return sqliteDb.prepare(query).all();
  }
}
