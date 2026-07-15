-- ==========================================================================
-- Oncourt Badminton — Postgres schema (สำหรับรันใน Supabase SQL Editor)
-- วิธีใช้: เปิดโปรเจกต์ Supabase > SQL Editor > New query > วางไฟล์นี้ทั้งหมด > Run
-- ==========================================================================

create table if not exists employees (
  id text primary key,
  username text unique not null,
  password_hash text not null,
  name text not null,
  role text not null default 'staff',
  active boolean not null default true
);

create table if not exists products (
  id text primary key,
  name text not null,
  category text not null default 'Drinks',
  sku text default '',
  price numeric not null default 0,
  cost numeric not null default 0,
  stock numeric not null default 0,
  low_stock_threshold numeric not null default 5,
  unit text not null default 'pc',
  status text not null default 'active',
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text default ''
);
-- เผื่อรันกับฐานข้อมูลเดิมที่สร้างไว้ก่อนหน้านี้ (คอลัมน์ใหม่)
alter table products add column if not exists status text not null default 'active';
alter table products add column if not exists sort_order int not null default 0;
alter table products add column if not exists updated_at timestamptz not null default now();
alter table products add column if not exists updated_by text default '';

create table if not exists members (
  id text primary key,
  name text not null,
  phone text default '',
  email text default '',
  notes text default '',
  joined timestamptz not null default now()
);

create table if not exists sales (
  id text primary key,
  date timestamptz not null default now(),
  items jsonb not null,
  total numeric not null,
  member_id text references members(id) on delete set null,
  payment text not null default 'Cash',
  sold_by text,
  proof_url text default '',
  deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by text
);

create table if not exists purchase_orders (
  id text primary key,
  supplier text not null,
  date timestamptz not null default now(),
  status text not null default 'Pending',
  received_date timestamptz,
  items jsonb not null,
  total numeric not null,
  created_by text,
  received_by text,
  receipt_photo_url text default ''
);
alter table purchase_orders add column if not exists receipt_photo_url text default '';

create table if not exists stock_log (
  id serial primary key,
  date timestamptz not null default now(),
  product_name text,
  delta numeric,
  reason text,
  by_name text
);

create table if not exists stock_counts (
  id text primary key,
  date timestamptz not null default now(),
  counted_by text,
  items jsonb not null,
  total_diff_items int,
  status text not null default 'approved',
  approved_by text,
  approved_at timestamptz
);
alter table stock_counts add column if not exists status text not null default 'approved';
alter table stock_counts add column if not exists approved_by text;
alter table stock_counts add column if not exists approved_at timestamptz;

create table if not exists settings (
  key text primary key,
  value text
);

insert into settings (key, value) values ('vat_rate', '0.07') on conflict (key) do nothing;
insert into settings (key, value) values ('shop_name', 'On Court Badminton') on conflict (key) do nothing;

create index if not exists idx_sales_date on sales (date);
create index if not exists idx_stocklog_date on stock_log (date);
create index if not exists idx_po_received_date on purchase_orders (received_date);
