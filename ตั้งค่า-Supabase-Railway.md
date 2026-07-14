# Oncourt Badminton — เวอร์ชัน Postgres (Supabase + Railway). Pangpangandboy /. postgresql://postgres.hqlhhiyzlawstehmihgz:Pangpangandboy@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres

เวอร์ชันนี้ใช้ **Supabase** เป็นฐานข้อมูล (Postgres จริง ฟรี) และ **Railway** เป็นเซิร์ฟเวอร์รัน Express (~$5/เดือน) — เร็วกว่า, ไม่มีปัญหา CORS, ควบคุมทุกอย่างผ่านเว็บได้เต็มที่ (รวมถึงลบรายการขาย และตั้งค่า VAT/ชื่อร้านเอง)

---

## ขั้นตอนที่ 1: สร้างโปรเจกต์ Supabase (ฐานข้อมูล)

1. ไปที่ [supabase.com](https://supabase.com) สมัคร/ล็อกอิน แล้วกด **New Project**
2. ตั้งชื่อโปรเจกต์ ตั้งรหัสผ่านฐานข้อมูล (จดไว้ให้ดี จะใช้ในขั้นตอนถัดไป) เลือก Region ใกล้ไทย (เช่น Singapore)
3. รอสักครู่จนโปรเจกต์สร้างเสร็จ
4. ไปที่เมนู **SQL Editor** ทางซ้าย กด **New query** วางเนื้อหาทั้งหมดจากไฟล์ `schema.sql` ที่แนบมา แล้วกด **Run** — จะสร้างตารางทั้งหมดให้อัตโนมัติ
5. ไปที่เมนู **Project Settings > Database** เลื่อนหา **Connection string** เลือกแท็บ **Connection pooling** (สำคัญ — ต้องใช้ตัวนี้ ไม่ใช่ direct connection) โหมด **Transaction** คัดลอกลิงก์ไว้ (จะมีรูปแบบ `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-xxxx.pooler.supabase.com:6543/postgres`) แทนที่ `[YOUR-PASSWORD]` ด้วยรหัสผ่านที่ตั้งไว้ในข้อ 2
6. ไปที่เมนู **Project Settings > API** คัดลอกค่า **Project URL** และ **service_role key** (อยู่ในหัวข้อ Project API keys — เลือกอันที่เขียนว่า `service_role` ไม่ใช่ `anon`) เก็บไว้ใช้ในขั้นตอนถัดไป

### สร้างที่เก็บรูปสลิป (Storage)
1. ไปที่เมนู **Storage** ทางซ้าย กด **New bucket**
2. ตั้งชื่อ **payment-slips** (สะกดตรงตัวพิมพ์เล็กให้ตรง) เปิดสวิตช์ **Public bucket** แล้วกด Create

---

## ขั้นตอนที่ 2: เตรียมโค้ดและ push ขึ้น GitHub

1. แตกไฟล์ zip ที่แนบมา (มี server.js, db.js, public/index.html, package.json ฯลฯ)
2. สร้าง repo ใหม่บน GitHub (หรือใช้ repo เดิม `Oncourt-app` ก็ได้ แต่แนะนำสร้างใหม่แยกจากเวอร์ชัน Sheets เพื่อไม่ให้สับสน)
3. อัปโหลดไฟล์ทั้งหมด (ยกเว้น `node_modules` และ `.env` ถ้ามี — ไฟล์ `.gitignore` กันไว้ให้แล้ว) ขึ้น repo

## ขั้นตอนที่ 3: Deploy บน Railway

1. ไปที่ [railway.com](https://railway.com) สมัคร/ล็อกอินด้วย GitHub
2. กด **New Project → Deploy from GitHub repo** เลือก repo ที่เพิ่งสร้าง
3. รอ Railway ตรวจจับและ build (จะรัน `npm install` และ `npm start` ให้อัตโนมัติจาก package.json)
4. ไปแท็บ **Variables** เพิ่มตัวแปรทั้งหมดนี้:
   - `DATABASE_URL` = connection string (pooler) จากขั้นตอนที่ 1.5
   - `JWT_SECRET` = ตั้งรหัสยาวสุ่มๆ (ห้ามใช้ค่า default ในโค้ด)
   - `SUPABASE_URL` = จากขั้นตอนที่ 1.6
   - `SUPABASE_SERVICE_ROLE_KEY` = จากขั้นตอนที่ 1.6
5. ไปแท็บ **Settings → Networking** กด **Generate Domain** จะได้ลิงก์เว็บไซต์

## ขั้นตอนที่ 4: ใส่ข้อมูล

เลือกวิธีใดวิธีหนึ่ง:

**(ก) เริ่มด้วยข้อมูลตัวอย่าง (สำหรับทดสอบ)**
เปิด Terminal ในเครื่องตัวเอง ที่โฟลเดอร์โปรเจกต์นี้:
```
npm install
cp .env.example .env      # แล้วแก้ DATABASE_URL ในไฟล์ .env ให้ตรงกับ Supabase ของคุณ
npm run seed
```

**(ข) ย้ายข้อมูลจริงจาก Google Sheets เดิม**
1. เปิด Google Sheet เดิม แต่ละแท็บ (Products, Members, Sales, PurchaseOrders, Employees) กด **File > Download > Comma Separated Values (.csv)**
2. สร้างโฟลเดอร์ชื่อ `import` ในโปรเจกต์นี้ วางไฟล์ CSV ทั้งหมดไว้ในนั้น ตั้งชื่อไฟล์ให้ตรงกับชื่อแท็บ: `Products.csv`, `Members.csv`, `Sales.csv`, `PurchaseOrders.csv`, `Employees.csv`
3. รัน:
   ```
   npm install
   cp .env.example .env      # แก้ DATABASE_URL ให้ตรงกับ Supabase ของคุณ
   npm run import
   ```
4. **สำคัญ**: รหัสผ่านพนักงานเดิมย้ายมาไม่ได้ (เข้ารหัสคนละวิธี) ทุกบัญชีที่ import มาจะได้รหัสผ่านชั่วคราว `reset123` — ล็อกอินแล้วรีบเปลี่ยนรหัสผ่านจริงทันทีในหน้า "พนักงาน"

## ล็อกอินครั้งแรก (ถ้าใช้ข้อมูลตัวอย่าง)
- เจ้าของร้าน: `owner` / `owner123`
- พนักงาน: `nan` / `staff123` หรือ `tar` / `staff123`

**เปลี่ยนรหัสผ่านทันทีในหน้า "พนักงาน" หลังล็อกอินครั้งแรก**

---

## ฟีเจอร์ใหม่ในเวอร์ชันนี้ที่เวอร์ชัน Sheets ไม่มี
- **ลบรายการขาย** ได้จากหน้า "รายงาน > ยอดขายรายวัน" (เจ้าของร้านเท่านั้น) — สต๊อกจะคืนกลับอัตโนมัติ
- **หน้า "ตั้งค่า"** ปรับชื่อร้านและอัตรา VAT ได้เอง (ไม่ต้องแก้โค้ด)
- เร็วกว่าเดิมมาก (ไม่ต้องรอ Google Sheets ตอบกลับ)
- ไม่มีปัญหา CORS/Drive permission/ล็อกอินหลุดที่เคยเจอในเวอร์ชัน Sheets เลย

## ข้อจำกัด/สิ่งที่ควรรู้
- Supabase โปรเจกต์ฟรีจะ pause อัตโนมัติถ้าไม่มีการใช้งานเกิน 1 สัปดาห์ — แค่เข้าไปกดปลุกในหน้า dashboard ก็กลับมาใช้ได้ปกติ ไม่มีค่าใช้จ่าย
- Railway มีค่าใช้จ่ายตามการใช้งานจริง ประมาณ $5/เดือนสำหรับร้านขนาดนี้ (ดูราคาปัจจุบันที่ railway.com/pricing)
- สำรองข้อมูลได้ตลอดเวลาผ่าน Supabase Dashboard > Database > Backups
