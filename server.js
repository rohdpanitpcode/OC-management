require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('./db');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-before-deploying';
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.warn('[คำเตือน] ยังไม่ได้ตั้งค่า JWT_SECRET — กรุณาตั้งค่าก่อน deploy จริง');
}

app.use(express.json({ limit: '10mb' })); // จำกัดใหญ่ขึ้นเผื่อรูปสลิป base64
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function apiError(msg) { return new Error(msg); }

function mapProduct(row) {
  return {
    id: row.id, name: row.name, category: row.category, sku: row.sku,
    price: Number(row.price), cost: Number(row.cost), stock: Number(row.stock),
    lowStockThreshold: Number(row.low_stock_threshold), unit: row.unit
  };
}
function mapMember(row) {
  return { id: row.id, name: row.name, phone: row.phone, email: row.email, notes: row.notes, joined: row.joined };
}
function mapSale(row) {
  return {
    id: row.id, date: row.date, items: row.items, total: Number(row.total),
    memberId: row.member_id || '', payment: row.payment, soldBy: row.sold_by,
    proofUrl: row.proof_url || '', deleted: row.deleted, deletedAt: row.deleted_at, deletedBy: row.deleted_by
  };
}
function mapPO(row) {
  return {
    id: row.id, supplier: row.supplier, date: row.date, status: row.status,
    receivedDate: row.received_date, items: row.items, total: Number(row.total),
    createdBy: row.created_by, receivedBy: row.received_by
  };
}
function mapEmployee(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role, active: row.active };
}
function mapStockLog(row) {
  return { date: row.date, productName: row.product_name, delta: Number(row.delta), reason: row.reason, by: row.by_name };
}

async function generateSaleId(client) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `S${yy}${mm}-`;
  const r = await client.query('SELECT id FROM sales WHERE id LIKE $1', [prefix + '%']);
  let maxNum = 0;
  r.rows.forEach(row => {
    const n = parseInt(String(row.id).substring(prefix.length), 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return prefix + String(maxNum + 1).padStart(5, '0');
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
function makeToken(emp) { return jwt.sign({ id: emp.id }, JWT_SECRET, { expiresIn: '30d' }); }

async function login(payload) {
  const r = await query('SELECT * FROM employees WHERE username=$1', [(payload.username || '').trim()]);
  const emp = r.rows[0];
  if (!emp || !emp.active || !bcrypt.compareSync(payload.password || '', emp.password_hash)) {
    throw apiError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  return { token: makeToken(emp), employee: mapEmployee(emp) };
}
async function authEmployee(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const r = await query('SELECT * FROM employees WHERE id=$1 AND active=true', [payload.id]);
    return r.rows[0] ? mapEmployee(r.rows[0]) : null;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------
async function getSettings() {
  const r = await query('SELECT key, value FROM settings');
  const obj = {};
  r.rows.forEach(row => { obj[row.key] = row.value; });
  return obj;
}
async function updateSettings(payload) {
  const entries = Object.entries(payload || {});
  for (const [k, v] of entries) {
    await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, String(v)]);
  }
  return getSettings();
}

async function bootstrap(emp) {
  const [products, members, sales, pos, stockLog, settings] = await Promise.all([
    query('SELECT * FROM products ORDER BY name'),
    query('SELECT * FROM members ORDER BY joined DESC'),
    query('SELECT * FROM sales WHERE deleted=false ORDER BY date DESC'),
    query('SELECT * FROM purchase_orders ORDER BY date DESC'),
    query('SELECT * FROM (SELECT * FROM stock_log ORDER BY date DESC LIMIT 40) sub ORDER BY date ASC'),
    getSettings()
  ]);
  const result = {
    products: products.rows.map(mapProduct),
    members: members.rows.map(mapMember),
    sales: sales.rows.map(mapSale),
    purchaseOrders: pos.rows.map(mapPO),
    stockLog: stockLog.rows.map(mapStockLog),
    settings
  };
  if (emp.role === 'owner') {
    const empRes = await query('SELECT * FROM employees ORDER BY username');
    result.employees = empRes.rows.map(mapEmployee);
  }
  result.me = emp;
  return result;
}

// ---------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------
async function addProduct(payload) {
  const id = uid('p');
  const r = await query(
    `INSERT INTO products (id,name,category,sku,price,cost,stock,low_stock_threshold,unit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, payload.name || '', payload.category || 'Drinks', payload.sku || '', payload.price || 0,
     payload.cost || 0, payload.stock || 0, payload.lowStockThreshold || 5, payload.unit || 'pc']
  );
  return mapProduct(r.rows[0]);
}
async function updateProduct(payload) {
  const colMap = { name: 'name', category: 'category', sku: 'sku', price: 'price', cost: 'cost', stock: 'stock', lowStockThreshold: 'low_stock_threshold', unit: 'unit' };
  const sets = []; const vals = []; let i = 1;
  Object.keys(colMap).forEach(f => {
    if (payload[f] !== undefined) { sets.push(`${colMap[f]}=$${i}`); vals.push(payload[f]); i++; }
  });
  if (!sets.length) {
    const r = await query('SELECT * FROM products WHERE id=$1', [payload.id]);
    if (!r.rows[0]) throw apiError('ไม่พบสินค้า');
    return mapProduct(r.rows[0]);
  }
  vals.push(payload.id);
  const r = await query(`UPDATE products SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals);
  if (!r.rows[0]) throw apiError('ไม่พบสินค้า');
  return mapProduct(r.rows[0]);
}
async function deleteProduct(payload) {
  await query('DELETE FROM products WHERE id=$1', [payload.id]);
  return { ok: true };
}
async function adjustStock(payload, emp) {
  return withTransaction(async (client) => {
    const r = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [payload.id]);
    const p = r.rows[0];
    if (!p) throw apiError('ไม่พบสินค้า');
    const delta = parseInt(payload.delta, 10) || 0;
    if (Number(p.stock) + delta < 0) throw apiError('สต๊อกติดลบไม่ได้');
    const upd = await client.query('UPDATE products SET stock = stock + $1 WHERE id=$2 RETURNING *', [delta, payload.id]);
    await client.query('INSERT INTO stock_log (product_name, delta, reason, by_name) VALUES ($1,$2,$3,$4)',
      [p.name, delta, payload.reason || 'Correction', emp.name]);
    return mapProduct(upd.rows[0]);
  });
}

// ---------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------
async function addMember(payload) {
  const id = uid('m');
  const r = await query(
    `INSERT INTO members (id,name,phone,email,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, payload.name || '', payload.phone || '', payload.email || '', payload.notes || '']
  );
  return mapMember(r.rows[0]);
}
async function updateMember(payload) {
  const sets = []; const vals = []; let i = 1;
  ['name', 'phone', 'email', 'notes'].forEach(f => {
    if (payload[f] !== undefined) { sets.push(`${f}=$${i}`); vals.push(payload[f]); i++; }
  });
  if (!sets.length) {
    const r = await query('SELECT * FROM members WHERE id=$1', [payload.id]);
    if (!r.rows[0]) throw apiError('ไม่พบสมาชิก');
    return mapMember(r.rows[0]);
  }
  vals.push(payload.id);
  const r = await query(`UPDATE members SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals);
  if (!r.rows[0]) throw apiError('ไม่พบสมาชิก');
  return mapMember(r.rows[0]);
}
async function deleteMember(payload) {
  // member_id ใน sales ตั้งเป็น ON DELETE SET NULL ไว้แล้ว ลบสมาชิกได้โดยประวัติการขายยังอยู่
  await query('DELETE FROM members WHERE id=$1', [payload.id]);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Sales (checkout / delete)
// ---------------------------------------------------------------------
async function checkout(payload, emp) {
  const items = payload.items || [];
  if (!items.length) throw apiError('ไม่มีสินค้าในตะกร้า');
  return withTransaction(async (client) => {
    const saleItems = [];
    for (const it of items) {
      const r = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [it.productId]);
      const p = r.rows[0];
      if (!p) throw apiError('ไม่พบสินค้าในระบบ');
      if (Number(p.stock) < Number(it.qty)) throw apiError(`สต๊อกไม่พอสำหรับ ${p.name}`);
      saleItems.push({ productId: p.id, name: p.name, qty: Number(it.qty), price: Number(p.price) });
    }
    const total = saleItems.reduce((s, it) => s + it.qty * it.price, 0);
    const id = await generateSaleId(client);
    for (const it of saleItems) {
      await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [it.qty, it.productId]);
    }
    const ins = await client.query(
      `INSERT INTO sales (id, items, total, member_id, payment, sold_by, proof_url)
       VALUES ($1,$2,$3,$4,$5,$6,'') RETURNING *`,
      [id, JSON.stringify(saleItems), total, payload.memberId || null, payload.payment || 'Cash', emp.name]
    );
    return mapSale(ins.rows[0]);
  });
}
async function deleteSale(payload, emp) {
  return withTransaction(async (client) => {
    const r = await client.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [payload.id]);
    const sale = r.rows[0];
    if (!sale) throw apiError('ไม่พบรายการขายนี้');
    if (sale.deleted) throw apiError('รายการนี้ถูกลบไปแล้ว');
    const items = sale.items || [];
    for (const it of items) {
      await client.query('UPDATE products SET stock = stock + $1 WHERE id=$2', [it.qty, it.productId]);
      await client.query('INSERT INTO stock_log (product_name, delta, reason, by_name) VALUES ($1,$2,$3,$4)',
        [it.name, it.qty, `ยกเลิกรายการขาย ${sale.id}`, emp.name]);
    }
    const upd = await client.query(
      `UPDATE sales SET deleted=true, deleted_at=now(), deleted_by=$1 WHERE id=$2 RETURNING *`,
      [emp.name, payload.id]
    );
    return mapSale(upd.rows[0]);
  });
}
async function attachSaleProof(payload) {
  if (!supabase) throw apiError('ยังไม่ได้ตั้งค่า Supabase Storage (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  const { saleId, imageBase64, mimeType } = payload;
  if (!saleId) throw apiError('ไม่พบรหัสรายการขาย');
  if (!imageBase64) throw apiError('ไม่มีข้อมูลรูปภาพ');
  const buffer = Buffer.from(imageBase64, 'base64');
  const fileName = `slip-${saleId}-${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage.from('payment-slips').upload(fileName, buffer, {
    contentType: mimeType || 'image/jpeg', upsert: true
  });
  if (upErr) throw apiError('อัปโหลดรูปไม่สำเร็จ: ' + upErr.message);
  const { data: urlData } = supabase.storage.from('payment-slips').getPublicUrl(fileName);
  const url = urlData.publicUrl;
  const res = await query('UPDATE sales SET proof_url=$1 WHERE id=$2 RETURNING id', [url, saleId]);
  if (!res.rows[0]) throw apiError('ไม่พบรายการขายนี้ในระบบ');
  return { saleId, proofUrl: url };
}
async function getSaleProof(payload) {
  const r = await query('SELECT id, proof_url FROM sales WHERE id=$1', [payload.saleId]);
  if (!r.rows[0]) throw apiError('ไม่พบรายการขายนี้');
  return { saleId: r.rows[0].id, proofUrl: r.rows[0].proof_url || '' };
}

// ---------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------
async function createPO(payload, emp) {
  const { supplier, items } = payload;
  if (!supplier || !items || !items.length) throw apiError('กรุณากรอกซัพพลายเออร์และรายการสินค้า');
  const poItems = [];
  for (const it of items) {
    const r = await query('SELECT name FROM products WHERE id=$1', [it.productId]);
    poItems.push({ productId: it.productId, name: r.rows[0] ? r.rows[0].name : 'ไม่ทราบชื่อสินค้า', qty: Number(it.qty) || 0, cost: Number(it.cost) || 0 });
  }
  const total = poItems.reduce((s, it) => s + it.qty * it.cost, 0);
  const countRes = await query('SELECT count(*) FROM purchase_orders');
  const nextNum = 1001 + parseInt(countRes.rows[0].count, 10);
  const id = 'PO-' + nextNum;
  const r = await query(
    `INSERT INTO purchase_orders (id,supplier,status,items,total,created_by) VALUES ($1,$2,'Pending',$3,$4,$5) RETURNING *`,
    [id, supplier, JSON.stringify(poItems), total, emp.name]
  );
  return mapPO(r.rows[0]);
}
async function receivePO(payload, emp) {
  return withTransaction(async (client) => {
    const r = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [payload.id]);
    const po = r.rows[0];
    if (!po) throw apiError('ไม่พบใบสั่งซื้อ');
    if (po.status === 'Received') throw apiError('ใบสั่งซื้อนี้รับของแล้ว');
    const items = po.items || [];
    const receivedMap = {};
    (payload.items || []).forEach(it => { receivedMap[it.productId] = Number(it.receivedQty); });
    for (const it of items) {
      let receivedQty = receivedMap.hasOwnProperty(it.productId) ? receivedMap[it.productId] : it.qty;
      if (isNaN(receivedQty) || receivedQty < 0) receivedQty = 0;
      it.receivedQty = receivedQty;
      if (receivedQty > 0) {
        await client.query('UPDATE products SET stock = stock + $1, cost=$2 WHERE id=$3', [receivedQty, it.cost, it.productId]);
      }
    }
    const upd = await client.query(
      `UPDATE purchase_orders SET status='Received', received_date=now(), received_by=$1, items=$2 WHERE id=$3 RETURNING *`,
      [emp.name, JSON.stringify(items), payload.id]
    );
    return mapPO(upd.rows[0]);
  });
}

// ---------------------------------------------------------------------
// Stock count
// ---------------------------------------------------------------------
async function submitStockCount(payload, emp) {
  const counts = payload.counts || [];
  if (!counts.length) throw apiError('ยังไม่ได้กรอกจำนวนนับ');
  return withTransaction(async (client) => {
    const results = [];
    for (const c of counts) {
      const r = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [c.productId]);
      const p = r.rows[0];
      if (!p) continue;
      const counted = Number(c.countedQty);
      if (isNaN(counted) || counted < 0) continue;
      const before = Number(p.stock);
      const diff = counted - before;
      results.push({ productId: p.id, name: p.name, unit: p.unit, before, counted, diff });
      if (diff !== 0) {
        await client.query('UPDATE products SET stock=$1 WHERE id=$2', [counted, p.id]);
        await client.query('INSERT INTO stock_log (product_name, delta, reason, by_name) VALUES ($1,$2,$3,$4)',
          [p.name, diff, 'นับสต๊อก (Stock Count)', emp.name]);
      }
    }
    const diffCount = results.filter(r => r.diff !== 0).length;
    const id = uid('sc');
    await client.query('INSERT INTO stock_counts (id, counted_by, items, total_diff_items) VALUES ($1,$2,$3,$4)',
      [id, emp.name, JSON.stringify(results), diffCount]);
    return { results, totalDiffItems: diffCount };
  });
}

// ---------------------------------------------------------------------
// Employees (owner only — enforced in router)
// ---------------------------------------------------------------------
async function addEmployee(payload) {
  const existing = await query('SELECT 1 FROM employees WHERE username=$1', [payload.username]);
  if (existing.rows.length) throw apiError('มีชื่อผู้ใช้นี้อยู่แล้ว');
  const id = uid('e');
  const hash = bcrypt.hashSync(payload.password, 10);
  const r = await query(
    `INSERT INTO employees (id,username,password_hash,name,role,active) VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
    [id, payload.username, hash, payload.name, payload.role === 'owner' ? 'owner' : 'staff']
  );
  return mapEmployee(r.rows[0]);
}
async function updateEmployee(payload) {
  const sets = []; const vals = []; let i = 1;
  if (payload.name !== undefined) { sets.push(`name=$${i}`); vals.push(payload.name); i++; }
  if (payload.role !== undefined) { sets.push(`role=$${i}`); vals.push(payload.role === 'owner' ? 'owner' : 'staff'); i++; }
  if (payload.active !== undefined) { sets.push(`active=$${i}`); vals.push(!!payload.active); i++; }
  if (payload.password) { sets.push(`password_hash=$${i}`); vals.push(bcrypt.hashSync(payload.password, 10)); i++; }
  if (!sets.length) {
    const r = await query('SELECT * FROM employees WHERE id=$1', [payload.id]);
    if (!r.rows[0]) throw apiError('ไม่พบพนักงาน');
    return mapEmployee(r.rows[0]);
  }
  vals.push(payload.id);
  const r = await query(`UPDATE employees SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals);
  if (!r.rows[0]) throw apiError('ไม่พบพนักงาน');
  return mapEmployee(r.rows[0]);
}
async function deleteEmployee(payload, emp) {
  if (emp.id === payload.id) throw apiError('ลบบัญชีที่ใช้งานอยู่ไม่ได้');
  await query('DELETE FROM employees WHERE id=$1', [payload.id]);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
const OWNER_ONLY_ACTIONS = ['addEmployee', 'updateEmployee', 'deleteEmployee', 'deleteSale', 'updateSettings'];

async function route(action, token, payload) {
  if (action === 'login') {
    try { return { data: await login(payload) }; }
    catch (e) { return { error: e.message }; }
  }
  const emp = await authEmployee(token);
  if (!emp) return { error: 'กรุณาล็อกอินใหม่', status: 401 };

  if (OWNER_ONLY_ACTIONS.includes(action) && emp.role !== 'owner') {
    return { error: 'ต้องเป็นบัญชีเจ้าของร้านเท่านั้น', status: 403 };
  }

  try {
    switch (action) {
      case 'bootstrap': return { data: await bootstrap(emp) };
      case 'addProduct': return { data: await addProduct(payload) };
      case 'updateProduct': return { data: await updateProduct(payload) };
      case 'deleteProduct': return { data: await deleteProduct(payload) };
      case 'adjustStock': return { data: await adjustStock(payload, emp) };
      case 'addMember': return { data: await addMember(payload) };
      case 'updateMember': return { data: await updateMember(payload) };
      case 'deleteMember': return { data: await deleteMember(payload) };
      case 'checkout': return { data: await checkout(payload, emp) };
      case 'deleteSale': return { data: await deleteSale(payload, emp) };
      case 'attachSaleProof': return { data: await attachSaleProof(payload) };
      case 'getSaleProof': return { data: await getSaleProof(payload) };
      case 'createPO': return { data: await createPO(payload, emp) };
      case 'receivePO': return { data: await receivePO(payload, emp) };
      case 'submitStockCount': return { data: await submitStockCount(payload, emp) };
      case 'addEmployee': return { data: await addEmployee(payload) };
      case 'updateEmployee': return { data: await updateEmployee(payload) };
      case 'deleteEmployee': return { data: await deleteEmployee(payload, emp) };
      case 'getSettings': return { data: await getSettings() };
      case 'updateSettings': return { data: await updateSettings(payload) };
      default: return { error: 'ไม่พบคำสั่ง: ' + action };
    }
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

app.post('/api/action', async (req, res) => {
  const { action, token, payload } = req.body || {};
  try {
    const result = await route(action, token, payload || {});
    res.json(result);
  } catch (e) {
    res.json({ error: e.message || 'เกิดข้อผิดพลาดที่ไม่คาดคิด' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Oncourt Stock Manager (Postgres) running on port ${PORT}`));
