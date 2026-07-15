// นำเข้าข้อมูลจริงจาก Google Sheets เดิม (export เป็น CSV) เข้าสู่ Postgres
// วิธีใช้:
//   1. เปิด Google Sheet เดิม แต่ละแท็บ (Products, Members, Sales, PurchaseOrders, Employees)
//      File > Download > Comma Separated Values (.csv) ทีละแท็บ
//   2. สร้างโฟลเดอร์ ./import ในโปรเจกต์นี้ แล้ววางไฟล์ CSV ทั้งหมดไว้ในนั้น
//      ตั้งชื่อไฟล์ให้ตรงกับชื่อแท็บเดิม: Products.csv, Members.csv, Sales.csv, PurchaseOrders.csv, Employees.csv
//   3. รันคำสั่ง: npm run import
//
// หมายเหตุสำคัญเรื่องรหัสผ่านพนักงาน: รหัสผ่านเดิมใน Sheets เข้ารหัสคนละวิธีกับระบบใหม่นี้
// ย้ายมาไม่ได้ตรงๆ — พนักงานทุกคนที่ import มาจะได้รหัสผ่านชั่วคราว "reset123"
// ให้ล็อกอินแล้วรีบเปลี่ยนรหัสผ่านจริงทันทีในหน้า "พนักงาน"
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const IMPORT_DIR = path.join(__dirname, '..', 'import');

function readCsv(fileName) {
  const filePath = path.join(IMPORT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`(ข้าม) ไม่พบไฟล์ ${fileName} ในโฟลเดอร์ import/`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

function toNum(v, def) { const n = parseFloat(v); return isNaN(n) ? def : n; }
function toBool(v) { return String(v).trim().toLowerCase() === 'true'; }
function toDate(v) { const d = new Date(v); return isNaN(d.getTime()) ? new Date() : d; }
function toDateOrNull(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }

async function importProducts() {
  const rows = readCsv('Products.csv');
  for (const r of rows) {
    await pool.query(
      `INSERT INTO products (id,name,category,sku,price,cost,stock,low_stock_threshold,unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET name=$2,category=$3,sku=$4,price=$5,cost=$6,stock=$7,low_stock_threshold=$8,unit=$9`,
      [r.id, r.name, r.category, r.sku || '', toNum(r.price, 0), toNum(r.cost, 0), toNum(r.stock, 0), toNum(r.lowStockThreshold, 5), r.unit || 'pc']
    );
  }
  console.log(`นำเข้า Products: ${rows.length} แถว`);
}

async function importMembers() {
  const rows = readCsv('Members.csv');
  for (const r of rows) {
    await pool.query(
      `INSERT INTO members (id,name,phone,email,notes,joined) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=$2,phone=$3,email=$4,notes=$5`,
      [r.id, r.name, r.phone || '', r.email || '', r.notes || '', toDate(r.joined)]
    );
  }
  console.log(`นำเข้า Members: ${rows.length} แถว`);
}

async function importSales() {
  const rows = readCsv('Sales.csv');
  for (const r of rows) {
    let items = [];
    try { items = JSON.parse(r.itemsJson || '[]'); } catch (e) { console.warn(`แถว ${r.id}: itemsJson อ่านไม่ได้ ข้ามรายการสินค้า`); }
    await pool.query(
      `INSERT INTO sales (id,date,items,total,member_id,payment,sold_by,proof_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, toDate(r.date), JSON.stringify(items), toNum(r.total, 0), r.memberId || null, r.payment || 'Cash', r.soldBy || '', r.proofUrl || '']
    );
  }
  console.log(`นำเข้า Sales: ${rows.length} แถว`);
}

async function importPurchaseOrders() {
  const rows = readCsv('PurchaseOrders.csv');
  for (const r of rows) {
    let items = [];
    try { items = JSON.parse(r.itemsJson || '[]'); } catch (e) { console.warn(`แถว ${r.id}: itemsJson อ่านไม่ได้ ข้ามรายการสินค้า`); }
    await pool.query(
      `INSERT INTO purchase_orders (id,supplier,date,status,received_date,items,total,created_by,received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.supplier, toDate(r.date), r.status || 'Pending', toDateOrNull(r.receivedDate), JSON.stringify(items), toNum(r.total, 0), r.createdBy || '', r.receivedBy || '']
    );
  }
  console.log(`นำเข้า PurchaseOrders: ${rows.length} แถว`);
}

async function importEmployees() {
  const rows = readCsv('Employees.csv');
  const tempPassword = 'reset123';
  const usernames = [];
  for (const r of rows) {
    const hash = bcrypt.hashSync(tempPassword, 10);
    await pool.query(
      `INSERT INTO employees (id,username,password_hash,name,role,active) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=$4,role=$5,active=$6`,
      [r.id, r.username, hash, r.name, r.role === 'owner' ? 'owner' : 'staff', toBool(r.active)]
    );
    usernames.push(r.username);
  }
  console.log(`นำเข้า Employees: ${rows.length} แถว — ทุกบัญชีได้รหัสผ่านชั่วคราว "${tempPassword}" (${usernames.join(', ')}) กรุณาเปลี่ยนรหัสผ่านจริงทันทีหลังล็อกอิน`);
}

async function main() {
  if (!fs.existsSync(IMPORT_DIR)) {
    console.log('ไม่พบโฟลเดอร์ ./import — สร้างโฟลเดอร์นี้แล้ววาง CSV ที่ export จาก Google Sheets ก่อนรันอีกครั้ง');
    return;
  }
  await importProducts();
  await importMembers();
  await importPurchaseOrders();
  await importSales(); // ทำหลัง Members/PurchaseOrders เพราะ sales อ้างอิง memberId
  await importEmployees();
  console.log('นำเข้าข้อมูลเสร็จสมบูรณ์');
}

module.exports = { main };

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
