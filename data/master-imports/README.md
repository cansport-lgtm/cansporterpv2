# Master Data Imports (v1 → v2)

These SQL files contain master data extracted from the v1 backup (`cansport_erp_backup.sql`)
and applied to the v2 Supabase project (`ojejlhnthhdvgbgpsgvi`).

Live/transactional data was intentionally excluded — only masters were imported.

## Apply Order

| File | Tables | Rows | Status |
|---|---|---|---|
| `01-crm-padel-masters.sql` | consumption_categories, crm_products, crm_marketing_kpi_targets, five_s_departments, hourly_loss_reasons, hp_materials, inventory_locations, labour_categories, online_items, padel_courts, qa_plan_templates, sales_customer_categories | 134 | Applied |
| `02-crm-fk-dependents.sql` | crm_brand_positioning, crm_competitor_attributes, crm_competitors, crm_launch_plans, crm_product_variants, crm_sample_items, hourly_loss_reason_processes | 85 | Applied |
| `03-crm-deep-dependents.sql` | crm_competitor_values, crm_launch_milestones, crm_product_roadmap_items | 45 | Applied |
| `04-extra-masters-level0.sql` | designations, grades, expense_categories, leave_types, maintenance_types, defect_reasons, scrap_reasons, downtime_reasons, fixed_asset_categories, units_of_measure, utility_types, sales_cities, sales_areas, floor_inventory_locations, production_departments, suppliers, items, planning_items (and 11 more) | ~600 | Partially applied — some tables had pre-existing v2 seed rows with different UUIDs |
| `05-extra-masters-level1.sql` | products, customers, machines, qa_processes, spare_parts, machine_monitor_machines, consumption_products, consumption_raw_materials, production_sub_departments | ~900 | Partially applied — FK orphans from level0 prevented some loads |
| `06-extra-masters-level2.sql` | qa_process_parameters, qa_process_standards, qa_process_instructions, qa_plan_template_items, labour_process_targets, capacity_master, consumption_bom, floor_inventory_bom | ~450 | Pending — depend on level1 FKs |

## Notes

- `created_by` and `created_by`-like columns referencing `app_users` were NULL'd because
  v1's user UUIDs do not exist in v2 (v2 only has `accountant` and `System Administrator`).
- v2 already had partial master data populated with different UUIDs than v1 — `ON CONFLICT DO NOTHING`
  was added to allow safe re-runs, but rows whose FK targets used v1 UUIDs (not present in v2) failed.
- For tables blocked by FK orphans, an additional UUID-remapping pass is required.
