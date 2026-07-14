// สคริปต์ใส่ข้อมูลตัวอย่าง — รันครั้งเดียวหลังตั้งค่า DATABASE_URL แล้ว ด้วยคำสั่ง: npm run seed
// ถ้ามีสินค้าอยู่แล้วในระบบ (เช่น import ข้อมูลจริงมาแล้ว) สคริปต์นี้จะไม่ทำอะไรเพื่อความปลอดภัย
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  ['p1', 'Bottled Water 600ml', 'Drinks', 'DR-001', 15, 8, 120, 20, 'bottle'],
  ['p2', 'Isotonic Sports Drink 350ml', 'Drinks', 'DR-002', 25, 15, 60, 15, 'bottle'],
  ['p3', 'Soft Drink Can 325ml', 'Drinks', 'DR-003', 20, 12, 48, 12, 'can'],
  ['p4', 'Energy Drink Can 250ml', 'Drinks', 'DR-004', 35, 22, 24, 10, 'can'],
  ['p5', 'Yonex Shuttlecock Tube (12pcs)', 'Equipment', 'EQ-001', 280, 200, 30, 8, 'tube'],
  ['p6', 'Overgrip Tape', 'Equipment', 'EQ-002', 45, 25, 50, 10, 'pc'],
  ['p7', 'Wristband Pair', 'Equipment', 'EQ-003', 60, 35, 20, 5, 'pair'],
  ['p8', 'Badminton String Set', 'Equipment', 'EQ-004', 150, 90, 15, 5, 'set'],
  ['p9', 'Entry-Level Racket', 'Equipment', 'EQ-005', 890, 600, 8, 3, 'pc'],
  ['p10', 'Court Feather Shuttlecock (single)', 'Equipment', 'EQ-006', 30, 18, 40, 10, 'pc'],
  ['p11', 'Shoe Rental — Size S', 'Shoe Rental', 'SR-S', 50, 0, 5, 2, 'pair'],
  ['p12', 'Shoe Rental — Size M', 'Shoe Rental', 'SR-M', 50, 0, 10, 3, 'pair'],
  ['p13', 'Shoe Rental — Size L', 'Shoe Rental', 'SR-L', 50, 0, 8, 3, 'pair'],
  ['p14', 'Shoe Rental — Size XL', 'Shoe Rental', 'SR-XL', 50, 0, 5, 2, 'pair'],
  ['p0', 'ค่าชั่วโมง Walk in', 'Fee', 'FE-001', 180, 0, 9999998, 0, 'ชั่วโมง']
];

const MEMBERS = [
  ['m1', 'Nan Srisai', '081-234-5671', 'nan.s@gmail.com', daysAgo(55)],
  ['m2', 'Ploy Wattana', '082-345-6782', 'ploy.w@gmail.com', daysAgo(50)],
  ['m3', 'Kob Anuwat', '083-456-7893', 'kob.a@gmail.com', daysAgo(40)],
  ['m4', 'Fah Chaiyasit', '084-567-8904', 'fah.c@gmail.com', daysAgo(35)],
  ['m5', 'Tar Boonmee', '085-678-9015', 'tar.b@gmail.com', daysAgo(20)],
  ['m6', 'Mint Suksawat', '086-789-0126', 'mint.s@gmail.com', daysAgo(10)]
];

async function main() {
  const existing = await pool.query('SELECT count(*) FROM products');
  if (parseInt(existing.rows[0].count, 10) > 0) {
    console.log('มีข้อมูลสินค้าอยู่แล้ว — ข้ามการใส่ข้อมูลตัวอย่างเพื่อความปลอดภัย (ไม่อยากเขียนทับข้อมูลจริง)');
    process.exit(0);
  }

  for (const p of PRODUCTS) {
    await pool.query(
      `INSERT INTO products (id,name,category,sku,price,cost,stock,low_stock_threshold,unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      p
    );
  }
  for (const m of MEMBERS) {
    await pool.query(`INSERT INTO members (id,name,phone,email,joined) VALUES ($1,$2,$3,$4,$5)`, m);
  }

  const rng = mulberry32(42);
  const sellable = PRODUCTS.filter(p => p[0] !== 'p0');
  for (let day = 45; day >= 0; day--) {
    const n = Math.floor(rng() * 4);
    for (let s = 0; s < n; s++) {
      const nItems = 1 + Math.floor(rng() * 3);
      const items = [];
      for (let k = 0; k < nItems; k++) {
        const pr = sellable[Math.floor(rng() * sellable.length)];
        const qty = 1 + Math.floor(rng() * 2);
        const existing2 = items.find(it => it.productId === pr[0]);
        if (existing2) existing2.qty += qty;
        else items.push({ productId: pr[0], name: pr[1], qty, price: pr[4] });
      }
      const total = items.reduce((s2, it) => s2 + it.qty * it.price, 0);
      const memberId = rng() < 0.35 ? MEMBERS[Math.floor(rng() * MEMBERS.length)][0] : null;
      const payment = ['Cash', 'QR'][Math.floor(rng() * 2)];
      const d = daysAgo(day);
      d.setHours(9 + Math.floor(rng() * 11), Math.floor(rng() * 60));
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const idCheck = await pool.query('SELECT id FROM sales WHERE id LIKE $1', [`S${yy}${mm}-%`]);
      let maxNum = 0;
      idCheck.rows.forEach(row => { const num = parseInt(row.id.split('-')[1], 10); if (!isNaN(num) && num > maxNum) maxNum = num; });
      const saleId = `S${yy}${mm}-${String(maxNum + 1).padStart(5, '0')}`;
      await pool.query(
        `INSERT INTO sales (id, date, items, total, member_id, payment, sold_by, proof_url) VALUES ($1,$2,$3,$4,$5,$6,$7,'')`,
        [saleId, d, JSON.stringify(items), total, memberId, payment, 'ระบบ (ตัวอย่าง)']
      );
    }
  }

  const po1 = [{ productId: 'p1', name: 'Bottled Water 600ml', qty: 100, cost: 7 }, { productId: 'p2', name: 'Isotonic Sports Drink 350ml', qty: 50, cost: 14 }];
  const po2 = [{ productId: 'p5', name: 'Yonex Shuttlecock Tube (12pcs)', qty: 20, cost: 190 }];
  const po3 = [{ productId: 'p6', name: 'Overgrip Tape', qty: 40, cost: 23 }, { productId: 'p9', name: 'Entry-Level Racket', qty: 5, cost: 580 }];
  await pool.query(`INSERT INTO purchase_orders (id,supplier,date,status,received_date,items,total,created_by,received_by) VALUES
    ('PO-1001','Chiang Mai Beverage Co.',$1,'Received',$2,$3,$4,'เจ้าของร้าน','เจ้าของร้าน')`,
    [daysAgo(25), daysAgo(24), JSON.stringify(po1), po1.reduce((s, it) => s + it.qty * it.cost, 0)]);
  await pool.query(`INSERT INTO purchase_orders (id,supplier,date,status,received_date,items,total,created_by,received_by) VALUES
    ('PO-1002','Yonex Thailand Distributor',$1,'Received',$2,$3,$4,'เจ้าของร้าน','เจ้าของร้าน')`,
    [daysAgo(15), daysAgo(13), JSON.stringify(po2), po2.reduce((s, it) => s + it.qty * it.cost, 0)]);
  await pool.query(`INSERT INTO purchase_orders (id,supplier,date,status,items,total,created_by) VALUES
    ('PO-1003','Local Sports Supply',$1,'Pending',$2,$3,'เจ้าของร้าน')`,
    [daysAgo(3), JSON.stringify(po3), po3.reduce((s, it) => s + it.qty * it.cost, 0)]);

  const employees = [
    ['e1', 'owner', 'owner123', 'เจ้าของร้าน', 'owner'],
    ['e2', 'nan', 'staff123', 'Nan Srisai', 'staff'],
    ['e3', 'tar', 'staff123', 'Tar Boonmee', 'staff']
  ];
  for (const [id, username, password, name, role] of employees) {
    const hash = bcrypt.hashSync(password, 10);
    await pool.query(`INSERT INTO employees (id,username,password_hash,name,role,active) VALUES ($1,$2,$3,$4,$5,true)`,
      [id, username, hash, name, role]);
  }

  console.log('ใส่ข้อมูลตัวอย่างเรียบร้อย! ล็อกอินทดลองด้วย owner / owner123');
}

module.exports = { main };

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
