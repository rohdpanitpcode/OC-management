const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('[คำเตือน] ยังไม่ได้ตั้งค่า DATABASE_URL — เชื่อมต่อฐานข้อมูลไม่ได้');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

function query(text, params) {
  return pool.query(text, params);
}

// รันหลายคำสั่งใน transaction เดียว ป้องกันข้อมูลเพี้ยนตอนมีคนใช้พร้อมกัน
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
