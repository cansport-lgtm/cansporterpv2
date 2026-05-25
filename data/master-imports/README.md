# Master Data Imports (v1 → v2)

These SQL files contain master data extracted from the v1 backup (`cansport_erp_backup.sql`)
and applied to the v2 Supabase project (`ojejlhnthhdvgbgpsgvi`).

Live/transactional data was intentionally excluded — only masters were imported.

## What's already loaded

These tables have been applied to v2 already (45 tables, ~600+ rows):

CRM/Marketing: crm_products, crm_competitors, crm_competitor_attributes, crm_competitor_values, crm_launch_plans, crm_launch_milestones, crm_brand_positioning, crm_marketing_kpi_targets, crm_product_variants, crm_product_roadmap_items, crm_sample_items

Padel/Online: padel_courts, online_items, online_platforms

Production masters: production_departments (15), planning_items (106), hp_materials, hourly_loss_reasons, hourly_loss_reason_processes, five_s_departments, inventory_locations, floor_inventory_locations, consumption_categories, labour_categories (56)

Reference/lookup: designations, grades, expense_categories, public_holidays, leave_types, maintenance_types, defect_reasons, scrap_reasons, downtime_reasons, fixed_asset_categories, units_of_measure, utility_types, sales_cities, sales_areas (19)

Finance & HR: finance_chart_of_accounts (46), salary_locks, performance_kpis (19), suppliers, sales_customer_categories, qa_plan_templates

## Tables remaining to apply

The following 22 tables still need to be loaded. Their SQL is in files 04-06.

**From `04-extra-masters-level0.sql`** (lines noted in file):
- `labour_employees` (198 rows) - line 362
- `employees` (28 rows) - line 561
- `six_sigma_tools` (1 row) - line 590

**From `05-extra-masters-level1.sql`** (in order):
- `production_sub_departments` (13 rows)
- `products` (89 rows)
- `customers` (195 rows)
- `machines` (108 rows)
- `consumption_products` (30 rows)
- `consumption_raw_materials` (44 rows)
- `qa_processes` (92 rows)
- `spare_parts` (263 rows)
- `machine_monitor_machines` (60 rows)

**From `06-extra-masters-level2.sql`** (in order):
- `qa_process_parameters` (314 rows)
- `qa_process_standards` (3 rows)
- `qa_process_instructions` (29 rows)
- `qa_plan_template_items` (6 rows)
- `labour_process_targets` (56 rows)
- `capacity_master` (3 rows)
- `consumption_bom` (29 rows)
- `floor_inventory_bom` (7 rows)

## How to apply remaining

Each file is valid PostgreSQL. To finish loading:

1. Open Supabase SQL Editor: https://supabase.com/dashboard/project/ojejlhnthhdvgbgpsgvi/sql
2. Open each file in order (04 → 05 → 06)
3. Paste contents into the SQL editor
4. Click **Run**

`ON CONFLICT DO NOTHING` is on every INSERT so re-runs are safe.

## Notes

- v2 seed data (products, customers, departments, items, etc.) was DELETED first to
  make room for v1 UUIDs. v2 transactional data (sales orders, invoices, POs, GRNs,
  accounting vouchers tied to v2 seed) was also deleted.
- `created_by` and `assigned_to` columns referencing `app_users` are NULL — v1's
  user UUIDs don't exist in v2 (only `accountant` and `System Administrator` exist).
- v2 accounting setup (chart_of_accounts, default_accounts, period_close, audit_log)
  was preserved. Only voucher entries posted from deleted v2 sales/purchase docs
  were removed.
