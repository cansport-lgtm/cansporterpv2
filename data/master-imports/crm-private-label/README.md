# Private Label + CRM Module v1 → v2 Data Import

Migrated v1's private label sales module and full CRM module data into v2.

## Pre-import: replaced placeholder data
v2 had 17 placeholder customers (codes 001-017) and 27 placeholder products that were created fresh and didn't match v1's UUIDs. They had no dependent rows, so the rows were `DELETE`d before loading v1's authoritative dataset.

## Tables loaded

| Table | Rows | Notes |
|---|---|---|
| `grades` | 13 | |
| `products` | 89 | replaced 27 placeholders |
| `customers` | 195 | replaced 17 placeholders (138 private_label + 57 domestic) |
| `customer_logos` | 47 | |
| `customer_visits` | 1 654 | |
| `sales_orders` | 522 | all `quotation_id` NULL |
| `sales_order_items` | 967 | |
| `crm_products` | 4 | re-loaded (UUIDs already matched) |
| `crm_product_variants` | 5 | |
| `crm_brand_positioning` | 3 | |
| `crm_product_roadmap_items` | 13 | |
| `crm_contacts` | 2 | |
| `crm_leads` | 43 | |
| `crm_deals` | 10 | |
| `crm_activities` | 19 | |
| `crm_competitors` | 12 | |
| `crm_competitor_attributes` | 18 | |
| `crm_competitor_values` | 18 | |
| `crm_launch_plans` | 7 | |
| `crm_launch_milestones` | 14 | |
| `crm_content_assets` | 3 | |
| `crm_content_campaigns` | 1 | |
| `crm_daily_activities` | 22 | |
| `crm_daily_summaries` | 11 | |
| `crm_reactivations` | 22 | |
| `crm_reactivation_attempts` | 25 | |
| `crm_sample_items` | 3 | |
| `crm_sample_stock_movements` | 2 | |
| `crm_sample_requests` | 3 | |
| `crm_sample_request_items` | 3 | |
| `crm_marketing_kpi_targets` | 3 | |
| **Total** | **3 858** | across 31 tables |

## Notes

- All v1 user UUIDs (`created_by`, `approved_by`, `salesman_id`, `owner_id`, `assigned_to`, etc.) were NULL'd because v2's `app_users` table doesn't share v1's user IDs.
- Every SQL file uses `ON CONFLICT DO NOTHING`, safe to re-apply.
- Load order is FK-dependency safe (see commit message). If re-applying manually via Supabase SQL Editor, follow this order:
  1. `grades.sql`, `products.sql`, `customers.sql`
  2. `customer_logos.sql`, `customer_visits.sql`
  3. `sales_orders.sql`, `sales_order_items.sql`
  4. `crm_products.sql`, `crm_contacts.sql`, `crm_deals.sql`, `crm_leads.sql`, `crm_competitors.sql`
  5. `crm_product_variants.sql`, `crm_brand_positioning.sql`, `crm_competitor_attributes.sql`, `crm_product_roadmap_items.sql`
  6. `crm_competitor_values.sql`
  7. `crm_launch_plans.sql` → `crm_launch_milestones.sql`
  8. `crm_content_assets.sql`, `crm_content_campaigns.sql`
  9. `crm_activities.sql`, `crm_daily_activities.sql`, `crm_daily_summaries.sql`
  10. `crm_reactivations.sql` → `crm_reactivation_attempts.sql`
  11. `crm_sample_items.sql` → `crm_sample_stock_movements.sql`, `crm_sample_requests.sql` → `crm_sample_request_items.sql`
  12. `crm_marketing_kpi_targets.sql`
