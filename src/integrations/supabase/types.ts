export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounting_audit_log: {
        Row: {
          after_data: Json | null
          before_data: Json | null
          changed_at: string
          changed_by: string | null
          id: string
          operation: string
          row_id: string
          table_name: string
        }
        Insert: {
          after_data?: Json | null
          before_data?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          operation: string
          row_id: string
          table_name: string
        }
        Update: {
          after_data?: Json | null
          before_data?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          operation?: string
          row_id?: string
          table_name?: string
        }
        Relationships: []
      }
      accounting_chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["accounting_account_type"]
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_bank_account: boolean | null
          is_cash_account: boolean | null
          is_control_account: boolean | null
          name: string
          parent_id: string | null
          sort_order: number | null
          sub_category: string | null
          updated_at: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["accounting_account_type"]
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_bank_account?: boolean | null
          is_cash_account?: boolean | null
          is_control_account?: boolean | null
          name: string
          parent_id?: string | null
          sort_order?: number | null
          sub_category?: string | null
          updated_at?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["accounting_account_type"]
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_bank_account?: boolean | null
          is_cash_account?: boolean | null
          is_control_account?: boolean | null
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          sub_category?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounting_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_default_accounts: {
        Row: {
          account_id: string | null
          description: string | null
          key: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          description?: string | null
          key: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          description?: string | null
          key?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_default_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounting_chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_default_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_parties: {
        Row: {
          address: string | null
          code: string | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          ntn: string | null
          party_type: Database["public"]["Enums"]["accounting_party_type"]
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          ntn?: string | null
          party_type: Database["public"]["Enums"]["accounting_party_type"]
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          ntn?: string | null
          party_type?: Database["public"]["Enums"]["accounting_party_type"]
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      accounting_period_close: {
        Row: {
          closed_through_date: string | null
          id: number
          last_closed_at: string | null
          last_closed_by: string | null
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          closed_through_date?: string | null
          id?: number
          last_closed_at?: string | null
          last_closed_by?: string | null
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          closed_through_date?: string | null
          id?: number
          last_closed_at?: string | null
          last_closed_by?: string | null
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_period_close_last_closed_by_fkey"
            columns: ["last_closed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_voucher_lines: {
        Row: {
          account_id: string
          created_at: string | null
          credit_amount: number
          debit_amount: number
          id: string
          line_narration: string | null
          line_order: number | null
          party_id: string | null
          voucher_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          credit_amount?: number
          debit_amount?: number
          id?: string
          line_narration?: string | null
          line_order?: number | null
          party_id?: string | null
          voucher_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          credit_amount?: number
          debit_amount?: number
          id?: string
          line_narration?: string | null
          line_order?: number | null
          party_id?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_voucher_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounting_chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_voucher_lines_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "accounting_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_voucher_lines_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "accounting_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_vouchers: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          narration: string | null
          party_id: string | null
          reverses_voucher_id: string | null
          source_module: string | null
          source_reference_id: string | null
          status: string
          total_amount: number
          updated_at: string | null
          voucher_date: string
          voucher_number: string
          voucher_type: Database["public"]["Enums"]["accounting_voucher_type"]
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          narration?: string | null
          party_id?: string | null
          reverses_voucher_id?: string | null
          source_module?: string | null
          source_reference_id?: string | null
          status?: string
          total_amount?: number
          updated_at?: string | null
          voucher_date?: string
          voucher_number: string
          voucher_type: Database["public"]["Enums"]["accounting_voucher_type"]
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          narration?: string | null
          party_id?: string | null
          reverses_voucher_id?: string | null
          source_module?: string | null
          source_reference_id?: string | null
          status?: string
          total_amount?: number
          updated_at?: string | null
          voucher_date?: string
          voucher_number?: string
          voucher_type?: Database["public"]["Enums"]["accounting_voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "accounting_vouchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_vouchers_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "accounting_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_vouchers_reverses_voucher_id_fkey"
            columns: ["reverses_voucher_id"]
            isOneToOne: false
            referencedRelation: "accounting_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string | null
          department_id: string | null
          designation: string | null
          distributor_id: string | null
          full_name: string
          id: string
          is_active: boolean | null
          last_login: string | null
          password_hash: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          designation?: string | null
          distributor_id?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          password_hash: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          designation?: string | null
          distributor_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          password_hash?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_users_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_payment_imports: {
        Row: {
          created_at: string | null
          created_by: string | null
          customer_name: string
          id: string
          notes: string | null
          payment_amount: number
          payment_date: string | null
          payment_mode: string | null
          reference_number: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          customer_name: string
          id?: string
          notes?: string | null
          payment_amount?: number
          payment_date?: string | null
          payment_mode?: string | null
          reference_number?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          customer_name?: string
          id?: string
          notes?: string | null
          payment_amount?: number
          payment_date?: string | null
          payment_mode?: string | null
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_payment_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_sales_imports: {
        Row: {
          created_at: string | null
          created_by: string | null
          customer_name: string
          id: string
          invoice_amount: number
          invoice_date: string | null
          invoice_number: string | null
          notes: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          customer_name: string
          id?: string
          invoice_amount?: number
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          customer_name?: string
          id?: string
          invoice_amount?: number
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_sales_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_reconciliation_items: {
        Row: {
          asset_id: string
          book_value: number | null
          created_at: string | null
          id: string
          physical_condition: string | null
          physical_location: string | null
          physical_status: string
          reconciliation_id: string
          remarks: string | null
          verified_at: string | null
        }
        Insert: {
          asset_id: string
          book_value?: number | null
          created_at?: string | null
          id?: string
          physical_condition?: string | null
          physical_location?: string | null
          physical_status?: string
          reconciliation_id: string
          remarks?: string | null
          verified_at?: string | null
        }
        Update: {
          asset_id?: string
          book_value?: number | null
          created_at?: string | null
          id?: string
          physical_condition?: string | null
          physical_location?: string | null
          physical_status?: string
          reconciliation_id?: string
          remarks?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_reconciliation_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "asset_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_reconciliations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          asset_category: string | null
          conducted_by: string | null
          created_at: string | null
          discrepancy_count: number | null
          id: string
          reconciliation_date: string
          reconciliation_number: string
          remarks: string | null
          status: string
          title: string
          total_assets: number | null
          updated_at: string | null
          verified_count: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          asset_category?: string | null
          conducted_by?: string | null
          created_at?: string | null
          discrepancy_count?: number | null
          id?: string
          reconciliation_date?: string
          reconciliation_number: string
          remarks?: string | null
          status?: string
          title: string
          total_assets?: number | null
          updated_at?: string | null
          verified_count?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          asset_category?: string | null
          conducted_by?: string | null
          created_at?: string | null
          discrepancy_count?: number | null
          id?: string
          reconciliation_date?: string
          reconciliation_number?: string
          remarks?: string | null
          status?: string
          title?: string
          total_assets?: number | null
          updated_at?: string | null
          verified_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_reconciliations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_reconciliations_conducted_by_fkey"
            columns: ["conducted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_valuations: {
        Row: {
          asset_id: string
          created_at: string | null
          id: string
          new_value: number
          previous_value: number | null
          reason: string | null
          valuation_date: string
          valued_by: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          id?: string
          new_value: number
          previous_value?: number | null
          reason?: string | null
          valuation_date?: string
          valued_by?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          id?: string
          new_value?: number
          previous_value?: number | null
          reason?: string | null
          valuation_date?: string
          valued_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_valuations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_valuations_valued_by_fkey"
            columns: ["valued_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          attendance_date: string
          check_in: string | null
          check_out: string | null
          created_at: string
          employee_id: string
          id: string
          remarks: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attendance_date?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          employee_id: string
          id?: string
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attendance_date?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          ip_address: string | null
          module: string
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          record_type: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          module: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          record_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          module?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          record_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      breakdown_logs: {
        Row: {
          breakdown_end: string | null
          breakdown_number: string
          breakdown_start: string
          created_at: string | null
          description: string
          downtime_minutes: number | null
          downtime_reason_id: string | null
          id: string
          immediate_action: string | null
          machine_id: string
          priority: Database["public"]["Enums"]["priority_level"] | null
          reported_by: string | null
          resolved_by: string | null
          root_cause: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          technician_name: string | null
          updated_at: string | null
          work_order_id: string | null
        }
        Insert: {
          breakdown_end?: string | null
          breakdown_number: string
          breakdown_start: string
          created_at?: string | null
          description: string
          downtime_minutes?: number | null
          downtime_reason_id?: string | null
          id?: string
          immediate_action?: string | null
          machine_id: string
          priority?: Database["public"]["Enums"]["priority_level"] | null
          reported_by?: string | null
          resolved_by?: string | null
          root_cause?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          technician_name?: string | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Update: {
          breakdown_end?: string | null
          breakdown_number?: string
          breakdown_start?: string
          created_at?: string | null
          description?: string
          downtime_minutes?: number | null
          downtime_reason_id?: string | null
          id?: string
          immediate_action?: string | null
          machine_id?: string
          priority?: Database["public"]["Enums"]["priority_level"] | null
          reported_by?: string | null
          resolved_by?: string | null
          root_cause?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          technician_name?: string | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breakdown_logs_downtime_reason_id_fkey"
            columns: ["downtime_reason_id"]
            isOneToOne: false
            referencedRelation: "downtime_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breakdown_logs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breakdown_logs_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breakdown_logs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breakdown_logs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_amount: number | null
          alert_date: string | null
          alert_type: string
          budget_amount: number | null
          budget_id: string | null
          created_at: string | null
          id: string
          is_acknowledged: boolean | null
          percentage_used: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_amount?: number | null
          alert_date?: string | null
          alert_type: string
          budget_amount?: number | null
          budget_id?: string | null
          created_at?: string | null
          id?: string
          is_acknowledged?: boolean | null
          percentage_used?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_amount?: number | null
          alert_date?: string | null
          alert_type?: string
          budget_amount?: number | null
          budget_id?: string | null
          created_at?: string | null
          id?: string
          is_acknowledged?: boolean | null
          percentage_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_alerts_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "expense_budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_master: {
        Row: {
          capacity_per_day: number
          capacity_per_hour: number
          created_at: string | null
          department_id: string | null
          id: string
          is_active: boolean | null
          machine_id: string | null
          product_id: string | null
          remarks: string | null
          updated_at: string | null
          working_hours_per_day: number | null
        }
        Insert: {
          capacity_per_day?: number
          capacity_per_hour?: number
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          machine_id?: string | null
          product_id?: string | null
          remarks?: string | null
          updated_at?: string | null
          working_hours_per_day?: number | null
        }
        Update: {
          capacity_per_day?: number
          capacity_per_hour?: number
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          machine_id?: string | null
          product_id?: string | null
          remarks?: string | null
          updated_at?: string | null
          working_hours_per_day?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "capacity_master_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacity_master_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacity_master_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      consumption_bom: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          product_id: string
          raw_material_id: string
          remarks: string | null
          standard_quantity: number
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          product_id: string
          raw_material_id: string
          remarks?: string | null
          standard_quantity?: number
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          product_id?: string
          raw_material_id?: string
          remarks?: string | null
          standard_quantity?: number
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumption_bom_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "consumption_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumption_bom_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "consumption_raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      consumption_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      consumption_production_entry: {
        Row: {
          created_at: string | null
          created_by: string | null
          entry_date: string
          id: string
          product_id: string
          quantity_produced: number
          remarks: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          entry_date: string
          id?: string
          product_id: string
          quantity_produced?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          entry_date?: string
          id?: string
          product_id?: string
          quantity_produced?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumption_production_entry_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumption_production_entry_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "consumption_products"
            referencedColumns: ["id"]
          },
        ]
      }
      consumption_products: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      consumption_raw_materials: {
        Row: {
          category: string | null
          code: string
          cost_value: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: string | null
          threshold: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          cost_value?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: string | null
          threshold?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          cost_value?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: string | null
          threshold?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      consumption_stock_closing: {
        Row: {
          actual_consumption: number | null
          closing_date: string
          closing_quantity: number
          created_at: string | null
          created_by: string | null
          id: string
          opening_quantity: number | null
          raw_material_id: string
          receipt_quantity: number | null
          remarks: string | null
          updated_at: string | null
        }
        Insert: {
          actual_consumption?: number | null
          closing_date: string
          closing_quantity?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          opening_quantity?: number | null
          raw_material_id: string
          receipt_quantity?: number | null
          remarks?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_consumption?: number | null
          closing_date?: string
          closing_quantity?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          opening_quantity?: number | null
          raw_material_id?: string
          receipt_quantity?: number | null
          remarks?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumption_stock_closing_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumption_stock_closing_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "consumption_raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_partners: {
        Row: {
          api_base_url: string | null
          code: string
          config: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          api_base_url?: string | null
          code: string
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          api_base_url?: string | null
          code?: string
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_activities: {
        Row: {
          activity_type: string
          completed: boolean
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          owner_id: string | null
          related_id: string | null
          related_to: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          activity_type?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          related_id?: string | null
          related_to?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          activity_type?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          related_id?: string | null
          related_to?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_brand_positioning: {
        Row: {
          brand_pillars: string[] | null
          created_at: string
          id: string
          key_messaging: string | null
          product_id: string
          tagline: string | null
          target_segment: string | null
          tone_of_voice: string | null
          updated_at: string
          usps: string[] | null
          value_proposition: string | null
        }
        Insert: {
          brand_pillars?: string[] | null
          created_at?: string
          id?: string
          key_messaging?: string | null
          product_id: string
          tagline?: string | null
          target_segment?: string | null
          tone_of_voice?: string | null
          updated_at?: string
          usps?: string[] | null
          value_proposition?: string | null
        }
        Update: {
          brand_pillars?: string[] | null
          created_at?: string
          id?: string
          key_messaging?: string | null
          product_id?: string
          tagline?: string | null
          target_segment?: string | null
          tone_of_voice?: string | null
          updated_at?: string
          usps?: string[] | null
          value_proposition?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_brand_positioning_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_competitor_attributes: {
        Row: {
          attribute_name: string
          created_at: string
          id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          attribute_name: string
          created_at?: string
          id?: string
          product_id: string
          sort_order?: number
        }
        Update: {
          attribute_name?: string
          created_at?: string
          id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_competitor_attributes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_competitor_values: {
        Row: {
          attribute_id: string
          competitor_id: string | null
          created_at: string
          id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          attribute_id: string
          competitor_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          attribute_id?: string
          competitor_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_competitor_values_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "crm_competitor_attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_competitor_values_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "crm_competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_competitors: {
        Row: {
          competitor_name: string
          created_at: string
          id: string
          logo_url: string | null
          product_id: string
          sort_order: number
          source_url: string | null
        }
        Insert: {
          competitor_name: string
          created_at?: string
          id?: string
          logo_url?: string | null
          product_id: string
          sort_order?: number
          source_url?: string | null
        }
        Update: {
          competitor_name?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          product_id?: string
          sort_order?: number
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_competitors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          company: string | null
          created_at: string
          customer_id: string | null
          designation: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          customer_id?: string | null
          designation?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          customer_id?: string | null
          designation?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_content_assets: {
        Row: {
          asset_type: string
          body_text: string | null
          created_at: string
          external_url: string | null
          file_url: string | null
          id: string
          notes: string | null
          owner_id: string | null
          status: string
          tags: string[] | null
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          asset_type?: string
          body_text?: string | null
          created_at?: string
          external_url?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          asset_type?: string
          body_text?: string | null
          created_at?: string
          external_url?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_content_assets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_content_campaign_assets: {
        Row: {
          asset_id: string
          campaign_id: string
          created_at: string
          id: string
          position: number | null
          published_at: string | null
          scheduled_date: string | null
        }
        Insert: {
          asset_id: string
          campaign_id: string
          created_at?: string
          id?: string
          position?: number | null
          published_at?: string | null
          scheduled_date?: string | null
        }
        Update: {
          asset_id?: string
          campaign_id?: string
          created_at?: string
          id?: string
          position?: number | null
          published_at?: string | null
          scheduled_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_content_campaign_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "crm_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_content_campaign_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_content_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_content_campaigns: {
        Row: {
          channel: string
          created_at: string
          end_date: string | null
          id: string
          linked_deal_id: string | null
          linked_lead_id: string | null
          name: string
          notes: string | null
          objective: string | null
          owner_id: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          end_date?: string | null
          id?: string
          linked_deal_id?: string | null
          linked_lead_id?: string | null
          name: string
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          end_date?: string | null
          id?: string
          linked_deal_id?: string | null
          linked_lead_id?: string | null
          name?: string
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_content_campaigns_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_content_campaigns_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_content_campaigns_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_daily_activities: {
        Row: {
          activity_date: string
          activity_time: string
          activity_type: string
          channel: string | null
          created_at: string
          customer_name: string | null
          id: string
          metadata: Json | null
          notes: string | null
          outcome: string | null
          related_deal_id: string | null
          related_lead_id: string | null
          title: string
          updated_at: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          activity_date?: string
          activity_time?: string
          activity_type: string
          channel?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          outcome?: string | null
          related_deal_id?: string | null
          related_lead_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          activity_date?: string
          activity_time?: string
          activity_type?: string
          channel?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          outcome?: string | null
          related_deal_id?: string | null
          related_lead_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      crm_daily_summaries: {
        Row: {
          accomplishments: string | null
          created_at: string
          id: string
          issues_feedback: string | null
          summary_date: string
          tomorrow_plan: string | null
          updated_at: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          accomplishments?: string | null
          created_at?: string
          id?: string
          issues_feedback?: string | null
          summary_date?: string
          tomorrow_plan?: string | null
          updated_at?: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          accomplishments?: string | null
          created_at?: string
          id?: string
          issues_feedback?: string | null
          summary_date?: string
          tomorrow_plan?: string | null
          updated_at?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      crm_deals: {
        Row: {
          contact_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          deal_number: string
          expected_close_date: string | null
          id: string
          lost_reason: string | null
          notes: string | null
          owner_id: string | null
          probability: number | null
          stage: string
          title: string
          updated_at: string
          value: number
          won_at: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          deal_number: string
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          owner_id?: string | null
          probability?: number | null
          stage?: string
          title: string
          updated_at?: string
          value?: number
          won_at?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          deal_number?: string
          expected_close_date?: string | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          owner_id?: string | null
          probability?: number | null
          stage?: string
          title?: string
          updated_at?: string
          value?: number
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_launch_milestones: {
        Row: {
          attachments: Json
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          owner: string | null
          plan_id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          owner?: string | null
          plan_id: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          owner?: string | null
          plan_id?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_launch_milestones_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "crm_launch_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_launch_plans: {
        Row: {
          budget: number | null
          channels: string[] | null
          created_at: string
          id: string
          launch_date: string | null
          name: string
          notes: string | null
          owner: string | null
          product_id: string
          status: string
          updated_at: string
        }
        Insert: {
          budget?: number | null
          channels?: string[] | null
          created_at?: string
          id?: string
          launch_date?: string | null
          name: string
          notes?: string | null
          owner?: string | null
          product_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          budget?: number | null
          channels?: string[] | null
          created_at?: string
          id?: string
          launch_date?: string | null
          name?: string
          notes?: string | null
          owner?: string | null
          product_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_launch_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          assigned_to: string | null
          company: string | null
          converted_deal_id: string | null
          created_at: string
          email: string | null
          id: string
          lead_number: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          company?: string | null
          converted_deal_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lead_number: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          company?: string | null
          converted_deal_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lead_number?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_converted_deal_id_fkey"
            columns: ["converted_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_marketing_kpi_targets: {
        Row: {
          created_at: string
          id: string
          kpi_key: string
          month: string
          notes: string | null
          target_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kpi_key: string
          month: string
          notes?: string | null
          target_value?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kpi_key?: string
          month?: string
          notes?: string | null
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      crm_product_packaging: {
        Row: {
          barcode: string | null
          created_at: string
          height_cm: number | null
          id: string
          image_url: string | null
          length_cm: number | null
          pack_type: string
          product_id: string
          units_per_pack: number | null
          updated_at: string
          weight_g: number | null
          width_cm: number | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          pack_type: string
          product_id: string
          units_per_pack?: number | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          pack_type?: string
          product_id?: string
          units_per_pack?: number | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_product_packaging_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_product_roadmap_items: {
        Row: {
          created_at: string
          description: string | null
          end_date: string
          id: string
          launch_plan_id: string | null
          owner_name: string | null
          priority: string
          product_id: string
          progress_pct: number
          start_date: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          launch_plan_id?: string | null
          owner_name?: string | null
          priority?: string
          product_id: string
          progress_pct?: number
          start_date?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          launch_plan_id?: string | null
          owner_name?: string | null
          priority?: string
          product_id?: string
          progress_pct?: number
          start_date?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_product_roadmap_items_launch_plan_id_fkey"
            columns: ["launch_plan_id"]
            isOneToOne: false
            referencedRelation: "crm_launch_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_product_roadmap_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_product_variants: {
        Row: {
          color: string | null
          created_at: string
          id: string
          mrp: number | null
          product_id: string
          size: string | null
          sku: string | null
          status: string
          updated_at: string
          variant_name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          mrp?: number | null
          product_id: string
          size?: string | null
          sku?: string | null
          status?: string
          updated_at?: string
          variant_name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          mrp?: number | null
          product_id?: string
          size?: string | null
          sku?: string | null
          status?: string
          updated_at?: string
          variant_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_products: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          description: string | null
          hero_image_url: string | null
          id: string
          name: string
          sku_prefix: string | null
          status: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          hero_image_url?: string | null
          id?: string
          name: string
          sku_prefix?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          hero_image_url?: string | null
          id?: string
          name?: string
          sku_prefix?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_reactivation_attempts: {
        Row: {
          attempt_date: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          outcome: string | null
          reactivation_id: string
        }
        Insert: {
          attempt_date?: string
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          outcome?: string | null
          reactivation_id: string
        }
        Update: {
          attempt_date?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          outcome?: string | null
          reactivation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reactivation_attempts_reactivation_id_fkey"
            columns: ["reactivation_id"]
            isOneToOne: false
            referencedRelation: "crm_reactivations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_reactivations: {
        Row: {
          assigned_to: string | null
          converted_lead_id: string | null
          created_at: string
          customer_id: string
          id: string
          notes: string | null
          reactivated_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          converted_lead_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          notes?: string | null
          reactivated_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          converted_lead_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string | null
          reactivated_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_reactivations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reactivations_converted_lead_id_fkey"
            columns: ["converted_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_reactivations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sample_items: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          product_id: string
          reorder_level: number
          sku: string | null
          unit: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          product_id: string
          reorder_level?: number
          sku?: string | null
          unit?: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          product_id?: string
          reorder_level?: number
          sku?: string | null
          unit?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_sample_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sample_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "crm_product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sample_request_items: {
        Row: {
          created_at: string
          id: string
          quantity: number
          remarks: string | null
          request_id: string
          sample_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          quantity?: number
          remarks?: string | null
          request_id: string
          sample_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          quantity?: number
          remarks?: string | null
          request_id?: string
          sample_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sample_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "crm_sample_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sample_request_items_sample_item_id_fkey"
            columns: ["sample_item_id"]
            isOneToOne: false
            referencedRelation: "crm_sample_items"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sample_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          contact_id: string | null
          courier_name: string | null
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          delivery_remarks: string | null
          expected_delivery_date: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          lead_id: string | null
          notes: string | null
          purpose: string | null
          recipient_address: string | null
          recipient_area: string | null
          recipient_city: string | null
          recipient_company: string | null
          recipient_name: string | null
          recipient_phone: string | null
          recipient_type: string
          rejection_reason: string | null
          request_date: string
          request_number: string | null
          requested_by: string | null
          requested_by_user_id: string | null
          status: string
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          contact_id?: string | null
          courier_name?: string | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          delivery_remarks?: string | null
          expected_delivery_date?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          lead_id?: string | null
          notes?: string | null
          purpose?: string | null
          recipient_address?: string | null
          recipient_area?: string | null
          recipient_city?: string | null
          recipient_company?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_type: string
          rejection_reason?: string | null
          request_date?: string
          request_number?: string | null
          requested_by?: string | null
          requested_by_user_id?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          contact_id?: string | null
          courier_name?: string | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          delivery_remarks?: string | null
          expected_delivery_date?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          lead_id?: string | null
          notes?: string | null
          purpose?: string | null
          recipient_address?: string | null
          recipient_area?: string | null
          recipient_city?: string | null
          recipient_company?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_type?: string
          rejection_reason?: string | null
          request_date?: string
          request_number?: string | null
          requested_by?: string | null
          requested_by_user_id?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sample_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sample_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sample_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sample_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          movement_date: string
          movement_type: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          remarks: string | null
          sample_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_date?: string
          movement_type: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          remarks?: string | null
          sample_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_date?: string
          movement_type?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          remarks?: string | null
          sample_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sample_stock_movements_sample_item_id_fkey"
            columns: ["sample_item_id"]
            isOneToOne: false
            referencedRelation: "crm_sample_items"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_logos: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_primary: boolean | null
          label: string | null
          logo_url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_primary?: boolean | null
          label?: string | null
          logo_url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_primary?: boolean | null
          label?: string | null
          logo_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_logos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_logos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_pricing: {
        Row: {
          created_at: string | null
          customer_id: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean | null
          min_quantity_dozens: number | null
          price_per_dozen: number
          product_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          min_quantity_dozens?: number | null
          price_per_dozen: number
          product_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          min_quantity_dozens?: number | null
          price_per_dozen?: number
          product_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_pricing_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_pricing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_visits: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          customer_id: string
          duration_minutes: number | null
          feedback: string | null
          follow_up_date: string | null
          follow_up_required: boolean | null
          id: string
          latitude: number | null
          longitude: number | null
          next_action: string | null
          order_taken: boolean | null
          order_value: number | null
          outcome: string | null
          purpose: string | null
          salesman_id: string | null
          status: string
          updated_at: string
          visit_date: string
          visit_number: string
          visit_type: string
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          customer_id: string
          duration_minutes?: number | null
          feedback?: string | null
          follow_up_date?: string | null
          follow_up_required?: boolean | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          next_action?: string | null
          order_taken?: boolean | null
          order_value?: number | null
          outcome?: string | null
          purpose?: string | null
          salesman_id?: string | null
          status?: string
          updated_at?: string
          visit_date?: string
          visit_number: string
          visit_type?: string
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          customer_id?: string
          duration_minutes?: number | null
          feedback?: string | null
          follow_up_date?: string | null
          follow_up_required?: boolean | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          next_action?: string | null
          order_taken?: boolean | null
          order_value?: number | null
          outcome?: string | null
          purpose?: string | null
          salesman_id?: string | null
          status?: string
          updated_at?: string
          visit_date?: string
          visit_number?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_visits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_visits_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          accounting_party_id: string | null
          address: string | null
          area: string | null
          billing_customer: string | null
          city: string | null
          code: string
          contact_person: string | null
          country: string | null
          created_at: string | null
          credit_limit: number | null
          customer_category: string | null
          email: string | null
          gst_number: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          payment_terms: number | null
          phone: string | null
          sales_segment: Database["public"]["Enums"]["sales_segment"]
          state: string | null
          updated_at: string | null
        }
        Insert: {
          accounting_party_id?: string | null
          address?: string | null
          area?: string | null
          billing_customer?: string | null
          city?: string | null
          code: string
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          credit_limit?: number | null
          customer_category?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          payment_terms?: number | null
          phone?: string | null
          sales_segment?: Database["public"]["Enums"]["sales_segment"]
          state?: string | null
          updated_at?: string | null
        }
        Update: {
          accounting_party_id?: string | null
          address?: string | null
          area?: string | null
          billing_customer?: string | null
          city?: string | null
          code?: string
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          credit_limit?: number | null
          customer_category?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          payment_terms?: number | null
          phone?: string | null
          sales_segment?: Database["public"]["Enums"]["sales_segment"]
          state?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_accounting_party_id_fkey"
            columns: ["accounting_party_id"]
            isOneToOne: false
            referencedRelation: "accounting_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_stock_closing: {
        Row: {
          closing_date: string
          closing_quantity: number
          created_at: string | null
          created_by: string | null
          department_id: string | null
          entered_quantity: number | null
          id: string
          multiplier: number | null
          opening_quantity: number
          planning_item_id: string
          remarks: string | null
          updated_at: string | null
        }
        Insert: {
          closing_date?: string
          closing_quantity?: number
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          entered_quantity?: number | null
          id?: string
          multiplier?: number | null
          opening_quantity?: number
          planning_item_id: string
          remarks?: string | null
          updated_at?: string | null
        }
        Update: {
          closing_date?: string
          closing_quantity?: number
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          entered_quantity?: number | null
          id?: string
          multiplier?: number | null
          opening_quantity?: number
          planning_item_id?: string
          remarks?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_stock_closing_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_stock_closing_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_stock_closing_planning_item_id_fkey"
            columns: ["planning_item_id"]
            isOneToOne: false
            referencedRelation: "planning_items"
            referencedColumns: ["id"]
          },
        ]
      }
      deadline_change_requests: {
        Row: {
          created_at: string | null
          current_deadline: string
          id: string
          order_id: string
          reason: string
          requested_by: string | null
          requested_deadline: string
          review_notes: string | null
          reviewed_by: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_deadline: string
          id?: string
          order_id: string
          reason: string
          requested_by?: string | null
          requested_deadline: string
          review_notes?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_deadline?: string
          id?: string
          order_id?: string
          reason?: string
          requested_by?: string | null
          requested_deadline?: string
          review_notes?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deadline_change_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadline_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadline_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      defect_reasons: {
        Row: {
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          severity: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          severity?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          severity?: string | null
        }
        Relationships: []
      }
      designations: {
        Row: {
          created_at: string | null
          department_id: string | null
          id: string
          is_active: boolean | null
          level: number | null
          name: string
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          level?: number | null
          name: string
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          level?: number | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "designations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      development_tasks: {
        Row: {
          actual_hours: number | null
          assigned_to: string | null
          completed_date: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          estimated_hours: number | null
          id: string
          module: string | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          remarks: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          target_date: string | null
          task_number: string
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_hours?: number | null
          assigned_to?: string | null
          completed_date?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_hours?: number | null
          id?: string
          module?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          remarks?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          target_date?: string | null
          task_number: string
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_hours?: number | null
          assigned_to?: string | null
          completed_date?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_hours?: number | null
          id?: string
          module?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          remarks?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          target_date?: string | null
          task_number?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "development_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "development_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_customers: {
        Row: {
          address: string | null
          area: string | null
          city: string | null
          code: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          distributor_id: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          distributor_id: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          distributor_id?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_customers_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_order_items: {
        Row: {
          amount: number
          company_product_id: string | null
          created_at: string
          distributor_product_id: string | null
          id: string
          order_id: string
          price: number
          product_name: string
          quantity: number
          quantity_dispatched: number
          remarks: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          company_product_id?: string | null
          created_at?: string
          distributor_product_id?: string | null
          id?: string
          order_id: string
          price?: number
          product_name: string
          quantity?: number
          quantity_dispatched?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          company_product_id?: string | null
          created_at?: string
          distributor_product_id?: string | null
          id?: string
          order_id?: string
          price?: number
          product_name?: string
          quantity?: number
          quantity_dispatched?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_order_items_company_product_id_fkey"
            columns: ["company_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_order_items_distributor_product_id_fkey"
            columns: ["distributor_product_id"]
            isOneToOne: false
            referencedRelation: "distributor_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "distributor_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          delivered_at: string | null
          dispatch_notes: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          distributor_id: string
          id: string
          notes: string | null
          order_date: string
          order_number: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          required_date: string | null
          status: string
          submitted_at: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivered_at?: string | null
          dispatch_notes?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          distributor_id: string
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          required_date?: string | null
          status?: string
          submitted_at?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivered_at?: string | null
          dispatch_notes?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          distributor_id?: string
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          required_date?: string | null
          status?: string
          submitted_at?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "distributor_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_orders_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_orders_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_orders_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_products: {
        Row: {
          code: string | null
          company_product_id: string | null
          created_at: string
          distributor_id: string
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          notes: string | null
          price: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          company_product_id?: string | null
          created_at?: string
          distributor_id: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          notes?: string | null
          price?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          company_product_id?: string | null
          created_at?: string
          distributor_id?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          notes?: string | null
          price?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_products_company_product_id_fkey"
            columns: ["company_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_products_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      distributors: {
        Row: {
          address: string | null
          area: string | null
          city: string | null
          code: string
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
          code: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      domestic_invoice_items: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          details: string | null
          dispatch_item_id: string | null
          grade_name: string | null
          id: string
          invoice_id: string
          line_order: number
          packing_type: string | null
          price_per_dozen: number
          product_id: string | null
          quantity_dozens: number
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string | null
          details?: string | null
          dispatch_item_id?: string | null
          grade_name?: string | null
          id?: string
          invoice_id: string
          line_order?: number
          packing_type?: string | null
          price_per_dozen?: number
          product_id?: string | null
          quantity_dozens?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          details?: string | null
          dispatch_item_id?: string | null
          grade_name?: string | null
          id?: string
          invoice_id?: string
          line_order?: number
          packing_type?: string | null
          price_per_dozen?: number
          product_id?: string | null
          quantity_dozens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domestic_invoice_items_dispatch_item_id_fkey"
            columns: ["dispatch_item_id"]
            isOneToOne: false
            referencedRelation: "sales_dispatch_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domestic_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "domestic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domestic_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      domestic_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number
          dispatch_id: string | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          notes: string | null
          payment_terms: string | null
          status: string
          subtotal: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          dispatch_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          notes?: string | null
          payment_terms?: string | null
          status?: string
          subtotal?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number
          dispatch_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          notes?: string | null
          payment_terms?: string | null
          status?: string
          subtotal?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domestic_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domestic_invoices_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "sales_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_reasons: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_planned: boolean | null
          name: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_planned?: boolean | null
          name: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_planned?: boolean | null
          name?: string
        }
        Relationships: []
      }
      employee_leave_balances: {
        Row: {
          created_at: string
          employee_id: string
          half_day_allocated: number | null
          half_day_remaining: number | null
          half_day_used: number | null
          id: string
          remaining: number
          total_allocated: number
          total_used: number
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          employee_id: string
          half_day_allocated?: number | null
          half_day_remaining?: number | null
          half_day_used?: number | null
          id?: string
          remaining?: number
          total_allocated?: number
          total_used?: number
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          employee_id?: string
          half_day_allocated?: number | null
          half_day_remaining?: number | null
          half_day_used?: number | null
          id?: string
          remaining?: number
          total_allocated?: number
          total_used?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_loans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          id: string
          interest_rate: number | null
          loan_amount: number
          loan_date: string
          monthly_installment: number
          paid_installments: number | null
          purpose: string | null
          remaining_amount: number
          remarks: string | null
          repayment_start_date: string | null
          status: string | null
          total_installments: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id: string
          id?: string
          interest_rate?: number | null
          loan_amount: number
          loan_date?: string
          monthly_installment: number
          paid_installments?: number | null
          purpose?: string | null
          remaining_amount: number
          remarks?: string | null
          repayment_start_date?: string | null
          status?: string | null
          total_installments: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          interest_rate?: number | null
          loan_amount?: number
          loan_date?: string
          monthly_installment?: number
          paid_installments?: number | null
          purpose?: string | null
          remaining_amount?: number
          remarks?: string | null
          repayment_start_date?: string | null
          status?: string | null
          total_installments?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_loans_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_loans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          allowances: number | null
          annual_leaves: number | null
          app_user_id: string | null
          attendance_allowance: number | null
          basic_salary: number | null
          contact_number: string | null
          created_at: string | null
          department_id: string | null
          designation_id: string | null
          duty_end_time: string | null
          duty_hours: number | null
          duty_start_time: string | null
          emergency_contact: string | null
          employee_code: string
          full_name: string
          half_day_leaves: number | null
          id: string
          is_active: boolean | null
          joining_date: string | null
          leave_quota_type: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          allowances?: number | null
          annual_leaves?: number | null
          app_user_id?: string | null
          attendance_allowance?: number | null
          basic_salary?: number | null
          contact_number?: string | null
          created_at?: string | null
          department_id?: string | null
          designation_id?: string | null
          duty_end_time?: string | null
          duty_hours?: number | null
          duty_start_time?: string | null
          emergency_contact?: string | null
          employee_code: string
          full_name: string
          half_day_leaves?: number | null
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          leave_quota_type?: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          allowances?: number | null
          annual_leaves?: number | null
          app_user_id?: string | null
          attendance_allowance?: number | null
          basic_salary?: number | null
          contact_number?: string | null
          created_at?: string | null
          department_id?: string | null
          designation_id?: string | null
          duty_end_time?: string | null
          duty_hours?: number | null
          duty_start_time?: string | null
          emergency_contact?: string | null
          employee_code?: string
          full_name?: string
          half_day_leaves?: number | null
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          leave_quota_type?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_app_user_id_fkey"
            columns: ["app_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_budgets: {
        Row: {
          budget_amount: number
          budget_month: number
          budget_year: number
          category_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          id: string
          updated_at: string | null
          utility_type_id: string | null
        }
        Insert: {
          budget_amount?: number
          budget_month: number
          budget_year: number
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          updated_at?: string | null
          utility_type_id?: string | null
        }
        Update: {
          budget_amount?: number
          budget_month?: number
          budget_year?: number
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          updated_at?: string | null
          utility_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_budgets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_budgets_utility_type_id_fkey"
            columns: ["utility_type_id"]
            isOneToOne: false
            referencedRelation: "utility_types"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          category_type: string
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          category_type: string
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          category_type?: string
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      finance_chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["finance_account_type"]
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_cash_account: boolean | null
          name: string
          parent_id: string | null
          sort_order: number | null
          sub_category: string | null
          updated_at: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["finance_account_type"]
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_cash_account?: boolean | null
          name: string
          parent_id?: string | null
          sort_order?: number | null
          sub_category?: string | null
          updated_at?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["finance_account_type"]
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_cash_account?: boolean | null
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          sub_category?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "finance_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_journal_entries: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          period_id: string
          status: string | null
          total_credit: number | null
          total_debit: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number: string
          id?: string
          period_id: string
          status?: string | null
          total_credit?: number | null
          total_debit?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          period_id?: string
          status?: string | null
          total_credit?: number | null
          total_debit?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "finance_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string | null
          credit_amount: number | null
          debit_amount: number | null
          description: string | null
          id: string
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          description?: string | null
          id?: string
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          description?: string | null
          id?: string
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_periods: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string
          id: string
          is_closed: boolean | null
          month: number
          period_name: string
          start_date: string
          status: Database["public"]["Enums"]["finance_period_status"] | null
          updated_at: string | null
          year: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          id?: string
          is_closed?: boolean | null
          month: number
          period_name: string
          start_date: string
          status?: Database["public"]["Enums"]["finance_period_status"] | null
          updated_at?: string | null
          year: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          id?: string
          is_closed?: boolean | null
          month?: number
          period_name?: string
          start_date?: string
          status?: Database["public"]["Enums"]["finance_period_status"] | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_trial_balance_entries: {
        Row: {
          account_id: string
          created_at: string | null
          created_by: string | null
          credit_amount: number | null
          debit_amount: number | null
          id: string
          period_id: string
          remarks: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          created_by?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          id?: string
          period_id: string
          remarks?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          created_by?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          id?: string
          period_id?: string
          remarks?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_trial_balance_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_trial_balance_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_trial_balance_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "finance_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      five_s_action_items: {
        Row: {
          assigned_to: string | null
          audit_id: string
          completed_date: string | null
          corrective_action: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string
          due_date: string | null
          id: string
          priority: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          audit_id: string
          completed_date?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description: string
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          audit_id?: string
          completed_date?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "five_s_action_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "five_s_action_items_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "five_s_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "five_s_action_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "five_s_action_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "five_s_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      five_s_audit_responses: {
        Row: {
          audit_id: string
          checkpoint_id: string
          created_at: string
          id: string
          remarks: string | null
          response: string
        }
        Insert: {
          audit_id: string
          checkpoint_id: string
          created_at?: string
          id?: string
          remarks?: string | null
          response?: string
        }
        Update: {
          audit_id?: string
          checkpoint_id?: string
          created_at?: string
          id?: string
          remarks?: string | null
          response?: string
        }
        Relationships: [
          {
            foreignKeyName: "five_s_audit_responses_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "five_s_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "five_s_audit_responses_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "five_s_checkpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      five_s_audits: {
        Row: {
          audit_date: string
          audit_number: string
          auditor_id: string | null
          compliant_count: number | null
          created_at: string
          department_id: string | null
          id: string
          non_compliant_count: number | null
          overall_score: number | null
          partial_count: number | null
          remarks: string | null
          status: string
          total_checkpoints: number | null
          updated_at: string
        }
        Insert: {
          audit_date?: string
          audit_number: string
          auditor_id?: string | null
          compliant_count?: number | null
          created_at?: string
          department_id?: string | null
          id?: string
          non_compliant_count?: number | null
          overall_score?: number | null
          partial_count?: number | null
          remarks?: string | null
          status?: string
          total_checkpoints?: number | null
          updated_at?: string
        }
        Update: {
          audit_date?: string
          audit_number?: string
          auditor_id?: string | null
          compliant_count?: number | null
          created_at?: string
          department_id?: string | null
          id?: string
          non_compliant_count?: number | null
          overall_score?: number | null
          partial_count?: number | null
          remarks?: string | null
          status?: string
          total_checkpoints?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "five_s_audits_auditor_id_fkey"
            columns: ["auditor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "five_s_audits_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "five_s_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      five_s_checkpoints: {
        Row: {
          category: string
          checkpoint_text: string
          checkpoint_text_urdu: string | null
          created_at: string
          id: string
          is_active: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          checkpoint_text: string
          checkpoint_text_urdu?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          checkpoint_text?: string
          checkpoint_text_urdu?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      five_s_departments: {
        Row: {
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          sequence_order: number | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sequence_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sequence_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fixed_asset_categories: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      fixed_assets: {
        Row: {
          asset_code: string
          category: Database["public"]["Enums"]["asset_category"]
          created_at: string | null
          created_by: string | null
          current_value: number | null
          custom_category: string | null
          department_id: string | null
          description: string | null
          disposal_date: string | null
          disposal_reason: string | null
          disposal_value: number | null
          id: string
          invoice_number: string | null
          last_valuation_date: string | null
          location_description: string | null
          manufacturer: string | null
          model: string | null
          name: string
          purchase_date: string | null
          purchase_price: number | null
          responsible_person: string | null
          serial_number: string | null
          specifications: Json | null
          status: Database["public"]["Enums"]["asset_status"]
          supplier_name: string | null
          updated_at: string | null
          warranty_expiry: string | null
        }
        Insert: {
          asset_code: string
          category: Database["public"]["Enums"]["asset_category"]
          created_at?: string | null
          created_by?: string | null
          current_value?: number | null
          custom_category?: string | null
          department_id?: string | null
          description?: string | null
          disposal_date?: string | null
          disposal_reason?: string | null
          disposal_value?: number | null
          id?: string
          invoice_number?: string | null
          last_valuation_date?: string | null
          location_description?: string | null
          manufacturer?: string | null
          model?: string | null
          name: string
          purchase_date?: string | null
          purchase_price?: number | null
          responsible_person?: string | null
          serial_number?: string | null
          specifications?: Json | null
          status?: Database["public"]["Enums"]["asset_status"]
          supplier_name?: string | null
          updated_at?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          asset_code?: string
          category?: Database["public"]["Enums"]["asset_category"]
          created_at?: string | null
          created_by?: string | null
          current_value?: number | null
          custom_category?: string | null
          department_id?: string | null
          description?: string | null
          disposal_date?: string | null
          disposal_reason?: string | null
          disposal_value?: number | null
          id?: string
          invoice_number?: string | null
          last_valuation_date?: string | null
          location_description?: string | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          purchase_date?: string | null
          purchase_price?: number | null
          responsible_person?: string | null
          serial_number?: string | null
          specifications?: Json | null
          status?: Database["public"]["Enums"]["asset_status"]
          supplier_name?: string | null
          updated_at?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_inventory_bom: {
        Row: {
          created_at: string | null
          id: string
          input_item_name: string
          input_quantity: number
          input_unit: string | null
          is_active: boolean | null
          notes: string | null
          output_item_name: string
          output_quantity: number
          output_unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          input_item_name: string
          input_quantity?: number
          input_unit?: string | null
          is_active?: boolean | null
          notes?: string | null
          output_item_name: string
          output_quantity?: number
          output_unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          input_item_name?: string
          input_quantity?: number
          input_unit?: string | null
          is_active?: boolean | null
          notes?: string | null
          output_item_name?: string
          output_quantity?: number
          output_unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      floor_inventory_ledger: {
        Row: {
          balance_quantity: number
          created_at: string | null
          id: string
          item_name: string
          ledger_date: string
          location_id: string | null
          movement_id: string | null
          quantity_in: number | null
          quantity_out: number | null
          reference_number: string | null
          remarks: string | null
          transaction_type: string
          unit: string | null
        }
        Insert: {
          balance_quantity: number
          created_at?: string | null
          id?: string
          item_name: string
          ledger_date?: string
          location_id?: string | null
          movement_id?: string | null
          quantity_in?: number | null
          quantity_out?: number | null
          reference_number?: string | null
          remarks?: string | null
          transaction_type: string
          unit?: string | null
        }
        Update: {
          balance_quantity?: number
          created_at?: string | null
          id?: string
          item_name?: string
          ledger_date?: string
          location_id?: string | null
          movement_id?: string | null
          quantity_in?: number | null
          quantity_out?: number | null
          reference_number?: string | null
          remarks?: string | null
          transaction_type?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floor_inventory_ledger_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "floor_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_inventory_ledger_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "floor_inventory_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_inventory_locations: {
        Row: {
          code: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      floor_inventory_movements: {
        Row: {
          created_at: string | null
          created_by: string | null
          from_location_id: string | null
          id: string
          item_name: string
          movement_date: string
          movement_number: string | null
          movement_type: string
          quantity: number
          reference_number: string | null
          reference_type: string | null
          remarks: string | null
          status: string | null
          to_location_id: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          item_name: string
          movement_date?: string
          movement_number?: string | null
          movement_type: string
          quantity: number
          reference_number?: string | null
          reference_type?: string | null
          remarks?: string | null
          status?: string | null
          to_location_id?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          item_name?: string
          movement_date?: string
          movement_number?: string | null
          movement_type?: string
          quantity?: number
          reference_number?: string | null
          reference_type?: string | null
          remarks?: string | null
          status?: string | null
          to_location_id?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floor_inventory_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_inventory_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "floor_inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_inventory_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "floor_inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_inventory_stock: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          item_code: string | null
          item_name: string
          location_id: string | null
          production_floor: string | null
          quantity: number
          remarks: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          item_code?: string | null
          item_name: string
          location_id?: string | null
          production_floor?: string | null
          quantity?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          item_code?: string | null
          item_name?: string
          location_id?: string | null
          production_floor?: string | null
          quantity?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floor_inventory_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "floor_inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      general_expenses: {
        Row: {
          amount: number
          approval_remarks: string | null
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          attachment_url: string | null
          category_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string
          expense_date: string
          expense_number: string
          id: string
          invoice_date: string | null
          invoice_number: string | null
          payment_date: string | null
          payment_mode: string | null
          payment_reference: string | null
          payment_status: string | null
          submitted_at: string | null
          submitted_by: string | null
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          vendor_gstin: string | null
          vendor_name: string | null
        }
        Insert: {
          amount: number
          approval_remarks?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description: string
          expense_date?: string
          expense_number: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
          vendor_gstin?: string | null
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          approval_remarks?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string
          expense_date?: string
          expense_number?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          vendor_gstin?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "general_expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_expenses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_expenses_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_notes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          grn_number: string
          id: string
          invoice_amount: number | null
          invoice_date: string | null
          invoice_number: string | null
          notes: string | null
          purchase_order_id: string
          receipt_date: string
          received_by: string | null
          status: string
          supplier_id: string
          total_amount: number | null
          transportation_cost: number
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          grn_number: string
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          purchase_order_id: string
          receipt_date?: string
          received_by?: string | null
          status?: string
          supplier_id: string
          total_amount?: number | null
          transportation_cost?: number
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          grn_number?: string
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          purchase_order_id?: string
          receipt_date?: string
          received_by?: string | null
          status?: string
          supplier_id?: string
          total_amount?: number | null
          transportation_cost?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_notes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      grn_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          grn_id: string
          id: string
          kind: string
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          grn_id: string
          id?: string
          kind: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          grn_id?: string
          id?: string
          kind?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_attachments_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      grn_items: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          grn_id: string
          id: string
          item_id: string | null
          po_item_id: string | null
          quantity_ordered: number | null
          quantity_received: number
          remarks: string | null
          unit_price: number
        }
        Insert: {
          amount?: number
          created_at?: string | null
          description?: string | null
          grn_id: string
          id?: string
          item_id?: string | null
          po_item_id?: string | null
          quantity_ordered?: number | null
          quantity_received?: number
          remarks?: string | null
          unit_price?: number
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          grn_id?: string
          id?: string
          item_id?: string | null
          po_item_id?: string | null
          quantity_ordered?: number | null
          quantity_received?: number
          remarks?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "grn_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_loss_reason_processes: {
        Row: {
          created_at: string
          id: string
          process_name: string
          reason_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          process_name: string
          reason_id: string
        }
        Update: {
          created_at?: string
          id?: string
          process_name?: string
          reason_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hourly_loss_reason_processes_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "hourly_loss_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_loss_reasons: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      hourly_production_daily_targets: {
        Row: {
          created_at: string
          entry_date: string
          id: string
          process_id: string
          target_per_hour: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: string
          process_id: string
          target_per_hour: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          process_id?: string
          target_per_hour?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hourly_production_daily_targets_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_production_entries: {
        Row: {
          created_at: string | null
          created_by: string | null
          entry_date: string
          hour_slot: number
          id: string
          process_name: string
          quantity: number
          remarks: string | null
          unit: string | null
          updated_at: string | null
          worker_name: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          entry_date: string
          hour_slot: number
          id?: string
          process_name: string
          quantity?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string | null
          worker_name?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          entry_date?: string
          hour_slot?: number
          id?: string
          process_name?: string
          quantity?: number
          remarks?: string | null
          unit?: string | null
          updated_at?: string | null
          worker_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hourly_production_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_production_losses: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          entry_date: string
          hour_slot: number
          id: string
          loss_reason_id: string | null
          lost_minutes: number
          lost_quantity: number
          process_name: string
          reason_id: string | null
          remarks: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          entry_date: string
          hour_slot: number
          id?: string
          loss_reason_id?: string | null
          lost_minutes?: number
          lost_quantity?: number
          process_name: string
          reason_id?: string | null
          remarks?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          entry_date?: string
          hour_slot?: number
          id?: string
          loss_reason_id?: string | null
          lost_minutes?: number
          lost_quantity?: number
          process_name?: string
          reason_id?: string | null
          remarks?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hourly_production_losses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_production_losses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_production_losses_loss_reason_id_fkey"
            columns: ["loss_reason_id"]
            isOneToOne: false
            referencedRelation: "hourly_loss_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_production_losses_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "downtime_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_production_processes: {
        Row: {
          created_at: string | null
          department_id: string | null
          id: string
          is_active: boolean | null
          name: string
          target_per_hour: number | null
          unit: string | null
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          target_per_hour?: number | null
          unit?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          target_per_hour?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hourly_production_processes_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      hp_material_consumption_log: {
        Row: {
          consumed_qty: number
          created_at: string
          department_id: string
          entered_at: string
          entered_by: string | null
          entry_date: string
          id: string
          issuance_item_id: string
          material_id: string
          remarks: string | null
        }
        Insert: {
          consumed_qty: number
          created_at?: string
          department_id: string
          entered_at?: string
          entered_by?: string | null
          entry_date?: string
          id?: string
          issuance_item_id: string
          material_id: string
          remarks?: string | null
        }
        Update: {
          consumed_qty?: number
          created_at?: string
          department_id?: string
          entered_at?: string
          entered_by?: string | null
          entry_date?: string
          id?: string
          issuance_item_id?: string
          material_id?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hp_material_consumption_log_issuance_item_id_fkey"
            columns: ["issuance_item_id"]
            isOneToOne: false
            referencedRelation: "hp_material_issuance_items"
            referencedColumns: ["id"]
          },
        ]
      }
      hp_material_issuance: {
        Row: {
          created_at: string
          department_id: string
          id: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          issue_date: string
          issued_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hp_material_issuance_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      hp_material_issuance_items: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          closed_at: string | null
          consumed_qty: number | null
          created_at: string
          id: string
          issuance_id: string
          issued_qty: number
          material_id: string
          receiver_user_id: string
          remarks: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          closed_at?: string | null
          consumed_qty?: number | null
          created_at?: string
          id?: string
          issuance_id: string
          issued_qty?: number
          material_id: string
          receiver_user_id: string
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          closed_at?: string | null
          consumed_qty?: number | null
          created_at?: string
          id?: string
          issuance_id?: string
          issued_qty?: number
          material_id?: string
          receiver_user_id?: string
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hp_material_issuance_items_issuance_id_fkey"
            columns: ["issuance_id"]
            isOneToOne: false
            referencedRelation: "hp_material_issuance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hp_material_issuance_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "hp_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      hp_materials: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      hr_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string | null
          created_by: string | null
          employee_id: string
          id: string
          is_deducted: boolean | null
          remarks: string | null
        }
        Insert: {
          advance_date?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          id?: string
          is_deducted?: boolean | null
          remarks?: string | null
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          id?: string
          is_deducted?: boolean | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_advances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_overtime: {
        Row: {
          amount: number
          created_at: string
          employee_id: string
          hours: number
          id: string
          overtime_date: string
          remarks: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          employee_id: string
          hours?: number
          id?: string
          overtime_date: string
          remarks?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          employee_id?: string
          hours?: number
          id?: string
          overtime_date?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_overtime_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      inventory_ledger: {
        Row: {
          balance_quantity: number
          balance_value: number
          created_at: string | null
          id: string
          item_id: string
          item_type: string
          ledger_date: string
          location_id: string | null
          movement_id: string | null
          quantity_in: number | null
          quantity_out: number | null
          reference_number: string | null
          remarks: string | null
          transaction_type: string
          unit_cost: number | null
          value_in: number | null
          value_out: number | null
        }
        Insert: {
          balance_quantity: number
          balance_value: number
          created_at?: string | null
          id?: string
          item_id: string
          item_type: string
          ledger_date?: string
          location_id?: string | null
          movement_id?: string | null
          quantity_in?: number | null
          quantity_out?: number | null
          reference_number?: string | null
          remarks?: string | null
          transaction_type: string
          unit_cost?: number | null
          value_in?: number | null
          value_out?: number | null
        }
        Update: {
          balance_quantity?: number
          balance_value?: number
          created_at?: string | null
          id?: string
          item_id?: string
          item_type?: string
          ledger_date?: string
          location_id?: string | null
          movement_id?: string | null
          quantity_in?: number | null
          quantity_out?: number | null
          reference_number?: string | null
          remarks?: string | null
          transaction_type?: string
          unit_cost?: number | null
          value_in?: number | null
          value_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_ledger_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_ledger_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          location_type: string
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          location_type?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          location_type?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_stock: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          item_type: string
          last_movement_date: string | null
          location_id: string | null
          max_stock: number | null
          min_stock: number | null
          quantity: number
          reorder_level: number | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          item_type: string
          last_movement_date?: string | null
          location_id?: string | null
          max_stock?: number | null
          min_stock?: number | null
          quantity?: number
          reorder_level?: number | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          item_type?: string
          last_movement_date?: string | null
          location_id?: string | null
          max_stock?: number | null
          min_stock?: number | null
          quantity?: number
          reorder_level?: number | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          category: Database["public"]["Enums"]["purchase_category"] | null
          code: string
          consumption_raw_material_id: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_inventory_item: boolean | null
          max_stock: number | null
          min_stock: number | null
          name: string
          reorder_level: number | null
          unit_price: number | null
          uom_id: string | null
          updated_at: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["purchase_category"] | null
          code: string
          consumption_raw_material_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_inventory_item?: boolean | null
          max_stock?: number | null
          min_stock?: number | null
          name: string
          reorder_level?: number | null
          unit_price?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["purchase_category"] | null
          code?: string
          consumption_raw_material_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_inventory_item?: boolean | null
          max_stock?: number | null
          min_stock?: number | null
          name?: string
          reorder_level?: number | null
          unit_price?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_consumption_raw_material_id_fkey"
            columns: ["consumption_raw_material_id"]
            isOneToOne: false
            referencedRelation: "consumption_raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      job_candidates: {
        Row: {
          candidate_name: string
          created_at: string
          current_salary: number | null
          email: string | null
          expected_salary: number | null
          experience_years: number | null
          id: string
          interview_date: string | null
          interview_notes: string | null
          job_posting_id: string
          phone: string | null
          rating: number | null
          remarks: string | null
          resume_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          candidate_name: string
          created_at?: string
          current_salary?: number | null
          email?: string | null
          expected_salary?: number | null
          experience_years?: number | null
          id?: string
          interview_date?: string | null
          interview_notes?: string | null
          job_posting_id: string
          phone?: string | null
          rating?: number | null
          remarks?: string | null
          resume_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          candidate_name?: string
          created_at?: string
          current_salary?: number | null
          email?: string | null
          expected_salary?: number | null
          experience_years?: number | null
          id?: string
          interview_date?: string | null
          interview_notes?: string | null
          job_posting_id?: string
          phone?: string | null
          rating?: number | null
          remarks?: string | null
          resume_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_candidates_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_order_eligible_departments: {
        Row: {
          created_at: string
          department_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_order_eligible_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      job_order_items: {
        Row: {
          created_at: string
          id: string
          item_detail: string | null
          job_order_id: string
          planning_item_id: string
          quantity: number
          remarks: string | null
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_detail?: string | null
          job_order_id: string
          planning_item_id: string
          quantity?: number
          remarks?: string | null
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_detail?: string | null
          job_order_id?: string
          planning_item_id?: string
          quantity?: number
          remarks?: string | null
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_order_items_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_items_planning_item_id_fkey"
            columns: ["planning_item_id"]
            isOneToOne: false
            referencedRelation: "planning_items"
            referencedColumns: ["id"]
          },
        ]
      }
      job_orders: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          issued_at: string | null
          issued_by: string | null
          job_order_number: string
          order_date: string
          priority: string
          remarks: string | null
          required_by_date: string | null
          status: string
          sub_department_id: string | null
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          job_order_number: string
          order_date?: string
          priority?: string
          remarks?: string | null
          required_by_date?: string | null
          status?: string
          sub_department_id?: string | null
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          job_order_number?: string
          order_date?: string
          priority?: string
          remarks?: string | null
          required_by_date?: string | null
          status?: string
          sub_department_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "production_sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      job_postings: {
        Row: {
          closing_date: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          designation_id: string | null
          id: string
          job_code: string
          positions: number | null
          posted_date: string | null
          requirements: string | null
          salary_range_max: number | null
          salary_range_min: number | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          closing_date?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          designation_id?: string | null
          id?: string
          job_code: string
          positions?: number | null
          posted_date?: string | null
          requirements?: string | null
          salary_range_max?: number | null
          salary_range_min?: number | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          closing_date?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          designation_id?: string | null
          id?: string
          job_code?: string
          positions?: number | null
          posted_date?: string | null
          requirements?: string | null
          salary_range_max?: number | null
          salary_range_min?: number | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_postings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string | null
          created_by: string | null
          employee_id: string
          id: string
          remarks: string | null
        }
        Insert: {
          advance_date?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          id?: string
          remarks?: string | null
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          id?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_advances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "labour_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_attendance_allowances: {
        Row: {
          allowance_date: string
          amount: number
          created_at: string | null
          created_by: string | null
          employee_id: string
          id: string
          remarks: string | null
        }
        Insert: {
          allowance_date?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          id?: string
          remarks?: string | null
        }
        Update: {
          allowance_date?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          id?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_attendance_allowances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_attendance_allowances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "labour_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_categories: {
        Row: {
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      labour_employees: {
        Row: {
          attendance_allowance: number | null
          category: string | null
          contact_number: string | null
          created_at: string | null
          department_id: string | null
          employee_code: string
          employee_type: string
          full_name: string
          id: string
          is_active: boolean | null
          joining_date: string | null
          monthly_salary: number | null
          per_day_wages: number | null
          photo_url: string | null
          updated_at: string | null
        }
        Insert: {
          attendance_allowance?: number | null
          category?: string | null
          contact_number?: string | null
          created_at?: string | null
          department_id?: string | null
          employee_code: string
          employee_type?: string
          full_name: string
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          monthly_salary?: number | null
          per_day_wages?: number | null
          photo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          attendance_allowance?: number | null
          category?: string | null
          contact_number?: string | null
          created_at?: string | null
          department_id?: string | null
          employee_code?: string
          employee_type?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          monthly_salary?: number | null
          per_day_wages?: number | null
          photo_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_mph_authorized: {
        Row: {
          action_taken: string | null
          authorized_mph: number
          created_at: string | null
          department_id: string
          entry_date: string
          id: string
          reason_for_loss: string | null
          updated_at: string | null
        }
        Insert: {
          action_taken?: string | null
          authorized_mph?: number
          created_at?: string | null
          department_id: string
          entry_date?: string
          id?: string
          reason_for_loss?: string | null
          updated_at?: string | null
        }
        Update: {
          action_taken?: string | null
          authorized_mph?: number
          created_at?: string | null
          department_id?: string
          entry_date?: string
          id?: string
          reason_for_loss?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_mph_authorized_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_process_targets: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string | null
          effective_from: string
          effective_to: string | null
          full_day_target: number
          half_day_target: number | null
          id: string
          is_active: boolean | null
          process_id: string
          remarks: string | null
          target_unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          effective_from?: string
          effective_to?: string | null
          full_day_target?: number
          half_day_target?: number | null
          id?: string
          is_active?: boolean | null
          process_id: string
          remarks?: string | null
          target_unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          effective_from?: string
          effective_to?: string | null
          full_day_target?: number
          half_day_target?: number | null
          id?: string
          is_active?: boolean | null
          process_id?: string
          remarks?: string | null
          target_unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_process_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_process_targets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_process_targets_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_productivity_edit_requests: {
        Row: {
          created_at: string
          current_actual_quantity: number | null
          current_department_id: string | null
          current_employee_id: string | null
          current_entry_date: string | null
          current_mph: number | null
          current_process_id: string | null
          current_remarks: string | null
          current_standard_target: number | null
          entry_id: string
          id: string
          reason: string
          requested_actual_quantity: number | null
          requested_by: string | null
          requested_department_id: string | null
          requested_employee_id: string | null
          requested_entry_date: string | null
          requested_mph: number | null
          requested_process_id: string | null
          requested_remarks: string | null
          requested_standard_target: number | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_actual_quantity?: number | null
          current_department_id?: string | null
          current_employee_id?: string | null
          current_entry_date?: string | null
          current_mph?: number | null
          current_process_id?: string | null
          current_remarks?: string | null
          current_standard_target?: number | null
          entry_id: string
          id?: string
          reason: string
          requested_actual_quantity?: number | null
          requested_by?: string | null
          requested_department_id?: string | null
          requested_employee_id?: string | null
          requested_entry_date?: string | null
          requested_mph?: number | null
          requested_process_id?: string | null
          requested_remarks?: string | null
          requested_standard_target?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_actual_quantity?: number | null
          current_department_id?: string | null
          current_employee_id?: string | null
          current_entry_date?: string | null
          current_mph?: number | null
          current_process_id?: string | null
          current_remarks?: string | null
          current_standard_target?: number | null
          entry_id?: string
          id?: string
          reason?: string
          requested_actual_quantity?: number | null
          requested_by?: string | null
          requested_department_id?: string | null
          requested_employee_id?: string | null
          requested_entry_date?: string | null
          requested_mph?: number | null
          requested_process_id?: string | null
          requested_remarks?: string | null
          requested_standard_target?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "labour_productivity_edit_requests_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "labour_productivity_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_productivity_targets: {
        Row: {
          actual_quantity: number
          approved_at: string | null
          approved_by: string | null
          check_in: string | null
          check_out: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          efficiency_percentage: number | null
          employee_id: string
          id: string
          mph: number | null
          overtime_amount: number | null
          process_id: string | null
          remarks: string | null
          shift: string | null
          status: string
          target_date: string
          target_quantity: number
          todays_target: number | null
          uom_id: string | null
          updated_at: string | null
          work_type: string
        }
        Insert: {
          actual_quantity?: number
          approved_at?: string | null
          approved_by?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id: string
          efficiency_percentage?: number | null
          employee_id: string
          id?: string
          mph?: number | null
          overtime_amount?: number | null
          process_id?: string | null
          remarks?: string | null
          shift?: string | null
          status?: string
          target_date?: string
          target_quantity?: number
          todays_target?: number | null
          uom_id?: string | null
          updated_at?: string | null
          work_type?: string
        }
        Update: {
          actual_quantity?: number
          approved_at?: string | null
          approved_by?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string
          efficiency_percentage?: number | null
          employee_id?: string
          id?: string
          mph?: number | null
          overtime_amount?: number | null
          process_id?: string | null
          remarks?: string | null
          shift?: string | null
          status?: string
          target_date?: string
          target_quantity?: number
          todays_target?: number | null
          uom_id?: string | null
          updated_at?: string | null
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "labour_productivity_targets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_targets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_targets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "labour_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_targets_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_productivity_targets_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_salary_snapshots: {
        Row: {
          absent_days: number | null
          category: string | null
          created_at: string | null
          days_worked: number | null
          department_name: string | null
          earned_salary: number | null
          employee_code: string
          employee_id: string
          employee_type: string
          full_days: number | null
          full_name: string
          gross_salary: number | null
          half_days: number | null
          id: string
          lock_id: string
          monthly_salary: number | null
          paid_sundays: number | null
          per_day_wages: number | null
          total_advance: number | null
          total_att_allowance: number | null
          total_mph: number | null
          total_overtime: number | null
          total_travel_advance: number | null
        }
        Insert: {
          absent_days?: number | null
          category?: string | null
          created_at?: string | null
          days_worked?: number | null
          department_name?: string | null
          earned_salary?: number | null
          employee_code: string
          employee_id: string
          employee_type: string
          full_days?: number | null
          full_name: string
          gross_salary?: number | null
          half_days?: number | null
          id?: string
          lock_id: string
          monthly_salary?: number | null
          paid_sundays?: number | null
          per_day_wages?: number | null
          total_advance?: number | null
          total_att_allowance?: number | null
          total_mph?: number | null
          total_overtime?: number | null
          total_travel_advance?: number | null
        }
        Update: {
          absent_days?: number | null
          category?: string | null
          created_at?: string | null
          days_worked?: number | null
          department_name?: string | null
          earned_salary?: number | null
          employee_code?: string
          employee_id?: string
          employee_type?: string
          full_days?: number | null
          full_name?: string
          gross_salary?: number | null
          half_days?: number | null
          id?: string
          lock_id?: string
          monthly_salary?: number | null
          paid_sundays?: number | null
          per_day_wages?: number | null
          total_advance?: number | null
          total_att_allowance?: number | null
          total_mph?: number | null
          total_overtime?: number | null
          total_travel_advance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_salary_snapshots_lock_id_fkey"
            columns: ["lock_id"]
            isOneToOne: false
            referencedRelation: "salary_locks"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_travel_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          remarks: string | null
        }
        Insert: {
          advance_date?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          remarks?: string | null
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labour_travel_advances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_travel_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "labour_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          applied_at: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          end_date: string
          id: string
          leave_type_id: string
          reason: string | null
          remarks: string | null
          start_date: string
          status: string
          total_days: number
          updated_at: string
        }
        Insert: {
          applied_at?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id: string
          end_date: string
          id?: string
          leave_type_id: string
          reason?: string | null
          remarks?: string | null
          start_date: string
          status?: string
          total_days: number
          updated_at?: string
        }
        Update: {
          applied_at?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id?: string
          end_date?: string
          id?: string
          leave_type_id?: string
          reason?: string | null
          remarks?: string | null
          start_date?: string
          status?: string
          total_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          code: string
          created_at: string
          days_per_year: number | null
          description: string | null
          id: string
          is_active: boolean | null
          is_paid: boolean | null
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          days_per_year?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          days_per_year?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          name?: string
        }
        Relationships: []
      }
      loan_payment_history: {
        Row: {
          amount: number
          created_at: string
          employee_id: string
          id: string
          loan_id: string
          payment_month: number
          payment_year: number
        }
        Insert: {
          amount: number
          created_at?: string
          employee_id: string
          id?: string
          loan_id: string
          payment_month: number
          payment_year: number
        }
        Update: {
          amount?: number
          created_at?: string
          employee_id?: string
          id?: string
          loan_id?: string
          payment_month?: number
          payment_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "loan_payment_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_payment_history_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "employee_loans"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_monitor_breakdowns: {
        Row: {
          breakdown_ended_at: string | null
          breakdown_ended_by: string | null
          breakdown_remarks: string | null
          breakdown_started_at: string
          breakdown_started_by: string | null
          created_at: string
          downtime_minutes: number | null
          id: string
          machine_id: string
          recovered_to_status: string | null
          recovery_remarks: string | null
          status: string
          updated_at: string
        }
        Insert: {
          breakdown_ended_at?: string | null
          breakdown_ended_by?: string | null
          breakdown_remarks?: string | null
          breakdown_started_at?: string
          breakdown_started_by?: string | null
          created_at?: string
          downtime_minutes?: number | null
          id?: string
          machine_id: string
          recovered_to_status?: string | null
          recovery_remarks?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          breakdown_ended_at?: string | null
          breakdown_ended_by?: string | null
          breakdown_remarks?: string | null
          breakdown_started_at?: string
          breakdown_started_by?: string | null
          created_at?: string
          downtime_minutes?: number | null
          id?: string
          machine_id?: string
          recovered_to_status?: string | null
          recovery_remarks?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_monitor_breakdowns_breakdown_ended_by_fkey"
            columns: ["breakdown_ended_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_monitor_breakdowns_breakdown_started_by_fkey"
            columns: ["breakdown_started_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_monitor_breakdowns_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machine_monitor_machines"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_monitor_machines: {
        Row: {
          code: string
          created_at: string
          current_remarks: string | null
          current_status: string
          current_status_since: string
          custom_statuses: string[]
          department: string | null
          id: string
          is_active: boolean
          location: string | null
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          current_remarks?: string | null
          current_status?: string
          current_status_since?: string
          custom_statuses?: string[]
          department?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          current_remarks?: string | null
          current_status?: string
          current_status_since?: string
          custom_statuses?: string[]
          department?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      machine_monitor_performance_issues: {
        Row: {
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          ended_by: string | null
          id: string
          machine_id: string
          recovered_to_status: string | null
          recovery_remarks: string | null
          start_reason: string | null
          start_remarks: string | null
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          machine_id: string
          recovered_to_status?: string | null
          recovery_remarks?: string | null
          start_reason?: string | null
          start_remarks?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          machine_id?: string
          recovered_to_status?: string | null
          recovery_remarks?: string | null
          start_reason?: string | null
          start_remarks?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      machine_monitor_status_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          machine_id: string
          remarks: string | null
          status: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          machine_id: string
          remarks?: string | null
          status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          machine_id?: string
          remarks?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_monitor_status_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_monitor_status_log_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machine_monitor_machines"
            referencedColumns: ["id"]
          },
        ]
      }
      machines: {
        Row: {
          code: string
          created_at: string | null
          department_id: string | null
          id: string
          installation_date: string | null
          is_active: boolean | null
          machine_type: string | null
          manufacturer: string | null
          model: string | null
          name: string
          notes: string | null
          serial_number: string | null
          specifications: Json | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          department_id?: string | null
          id?: string
          installation_date?: string | null
          is_active?: boolean | null
          machine_type?: string | null
          manufacturer?: string | null
          model?: string | null
          name: string
          notes?: string | null
          serial_number?: string | null
          specifications?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          department_id?: string | null
          id?: string
          installation_date?: string | null
          is_active?: boolean | null
          machine_type?: string | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          serial_number?: string | null
          specifications?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machines_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedules: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          estimated_duration_hours: number | null
          frequency_days: number
          id: string
          instructions: string | null
          is_active: boolean | null
          last_performed_date: string | null
          machine_id: string | null
          maintenance_type_id: string | null
          next_due_date: string
          priority: Database["public"]["Enums"]["priority_level"] | null
          schedule_number: string
          technician_name: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_duration_hours?: number | null
          frequency_days: number
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          last_performed_date?: string | null
          machine_id?: string | null
          maintenance_type_id?: string | null
          next_due_date: string
          priority?: Database["public"]["Enums"]["priority_level"] | null
          schedule_number: string
          technician_name?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_duration_hours?: number | null
          frequency_days?: number
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          last_performed_date?: string | null
          machine_id?: string | null
          maintenance_type_id?: string | null
          next_due_date?: string
          priority?: Database["public"]["Enums"]["priority_level"] | null
          schedule_number?: string
          technician_name?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_maintenance_type_id_fkey"
            columns: ["maintenance_type_id"]
            isOneToOne: false
            referencedRelation: "maintenance_types"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_types: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      maintenance_work_orders: {
        Row: {
          action_taken: string | null
          actual_hours: number | null
          approved_at: string | null
          approved_by: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          downtime_reason_id: string | null
          estimated_hours: number | null
          id: string
          machine_id: string | null
          maintenance_type_id: string | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          remarks: string | null
          requested_by: string | null
          requested_date: string
          root_cause: string | null
          schedule_id: string | null
          scheduled_date: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          technician_name: string | null
          title: string
          updated_at: string | null
          work_order_number: string
        }
        Insert: {
          action_taken?: string | null
          actual_hours?: number | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          downtime_reason_id?: string | null
          estimated_hours?: number | null
          id?: string
          machine_id?: string | null
          maintenance_type_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          remarks?: string | null
          requested_by?: string | null
          requested_date?: string
          root_cause?: string | null
          schedule_id?: string | null
          scheduled_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          technician_name?: string | null
          title: string
          updated_at?: string | null
          work_order_number: string
        }
        Update: {
          action_taken?: string | null
          actual_hours?: number | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          downtime_reason_id?: string | null
          estimated_hours?: number | null
          id?: string
          machine_id?: string | null
          maintenance_type_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          remarks?: string | null
          requested_by?: string | null
          requested_date?: string
          root_cause?: string | null
          schedule_id?: string | null
          scheduled_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          technician_name?: string | null
          title?: string
          updated_at?: string | null
          work_order_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_work_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_work_orders_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_work_orders_downtime_reason_id_fkey"
            columns: ["downtime_reason_id"]
            isOneToOne: false
            referencedRelation: "downtime_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_work_orders_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_work_orders_maintenance_type_id_fkey"
            columns: ["maintenance_type_id"]
            isOneToOne: false
            referencedRelation: "maintenance_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_work_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_work_orders_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "maintenance_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          budget: number
          campaign_number: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          owner_user_id: string | null
          planned_end: string | null
          planned_start: string | null
          remarks: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          budget?: number
          campaign_number: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          owner_user_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          budget?: number
          campaign_number?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_user_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_channels: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_deliverable_types: {
        Row: {
          created_at: string
          default_template_id: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_template_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_template_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_deliverable_types_default_template_id_fkey"
            columns: ["default_template_id"]
            isOneToOne: false
            referencedRelation: "marketing_milestone_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_deliverables: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          approver_user_id: string | null
          attachment_url: string | null
          campaign_id: string | null
          channel_id: string | null
          created_at: string
          created_by: string | null
          deliverable_number: string
          deliverable_type_id: string | null
          description: string | null
          event_id: string | null
          id: string
          meeting_id: string | null
          owner_user_id: string | null
          planned_end: string | null
          planned_start: string | null
          priority: string
          publish_date: string | null
          remarks: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          approver_user_id?: string | null
          attachment_url?: string | null
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_number: string
          deliverable_type_id?: string | null
          description?: string | null
          event_id?: string | null
          id?: string
          meeting_id?: string | null
          owner_user_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: string
          publish_date?: string | null
          remarks?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          approver_user_id?: string | null
          attachment_url?: string | null
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_number?: string
          deliverable_type_id?: string | null
          description?: string | null
          event_id?: string | null
          id?: string
          meeting_id?: string | null
          owner_user_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          priority?: string
          publish_date?: string | null
          remarks?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_deliverables_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_deliverables_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "marketing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_deliverables_deliverable_type_id_fkey"
            columns: ["deliverable_type_id"]
            isOneToOne: false
            referencedRelation: "marketing_deliverable_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_deliverables_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "marketing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_deliverables_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "marketing_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_events: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          budget: number
          created_at: string
          created_by: string | null
          event_number: string
          event_type: string | null
          id: string
          name: string
          owner_user_id: string | null
          planned_end: string | null
          planned_start: string | null
          remarks: string | null
          status: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          budget?: number
          created_at?: string
          created_by?: string | null
          event_number: string
          event_type?: string | null
          id?: string
          name: string
          owner_user_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          budget?: number
          created_at?: string
          created_by?: string | null
          event_number?: string
          event_type?: string | null
          id?: string
          name?: string
          owner_user_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      marketing_meeting_actions: {
        Row: {
          action_text: string
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          meeting_id: string
          owner_user_id: string | null
          remarks: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_text: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          meeting_id: string
          owner_user_id?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_text?: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          meeting_id?: string
          owner_user_id?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_meeting_actions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "marketing_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_meetings: {
        Row: {
          agenda: string | null
          attendees: string | null
          created_at: string
          created_by: string | null
          id: string
          meeting_date: string
          meeting_number: string
          minutes: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agenda?: string | null
          attendees?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_date?: string
          meeting_number: string
          minutes?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agenda?: string | null
          attendees?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_date?: string
          meeting_number?: string
          minutes?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_milestone_template_stages: {
        Row: {
          created_at: string
          default_offset_days: number
          id: string
          sort_order: number
          stage_name: string
          template_id: string
        }
        Insert: {
          created_at?: string
          default_offset_days?: number
          id?: string
          sort_order?: number
          stage_name: string
          template_id: string
        }
        Update: {
          created_at?: string
          default_offset_days?: number
          id?: string
          sort_order?: number
          stage_name?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_milestone_template_stages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "marketing_milestone_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_milestone_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_milestones: {
        Row: {
          actual_date: string | null
          completed_by: string | null
          created_at: string
          deliverable_id: string
          id: string
          planned_date: string | null
          remarks: string | null
          sort_order: number
          stage_name: string
          updated_at: string
        }
        Insert: {
          actual_date?: string | null
          completed_by?: string | null
          created_at?: string
          deliverable_id: string
          id?: string
          planned_date?: string | null
          remarks?: string | null
          sort_order?: number
          stage_name: string
          updated_at?: string
        }
        Update: {
          actual_date?: string | null
          completed_by?: string | null
          created_at?: string
          deliverable_id?: string
          id?: string
          planned_date?: string | null
          remarks?: string | null
          sort_order?: number
          stage_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_milestones_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "marketing_deliverables"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_spend: {
        Row: {
          amount: number
          campaign: string | null
          created_at: string | null
          created_by: string | null
          external_id: string | null
          id: string
          platform: string
          source: string
          spend_date: string
        }
        Insert: {
          amount?: number
          campaign?: string | null
          created_at?: string | null
          created_by?: string | null
          external_id?: string | null
          id?: string
          platform?: string
          source?: string
          spend_date?: string
        }
        Update: {
          amount?: number
          campaign?: string | null
          created_at?: string | null
          created_by?: string | null
          external_id?: string | null
          id?: string
          platform?: string
          source?: string
          spend_date?: string
        }
        Relationships: []
      }
      module_permissions: {
        Row: {
          can_approve: boolean | null
          can_create: boolean | null
          can_delete: boolean | null
          can_edit: boolean | null
          can_view: boolean | null
          created_at: string | null
          id: string
          module_name: string
          user_id: string
        }
        Insert: {
          can_approve?: boolean | null
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          id?: string
          module_name: string
          user_id: string
        }
        Update: {
          can_approve?: boolean | null
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          id?: string
          module_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      mph_calculating_numbers: {
        Row: {
          created_at: string | null
          department_id: string
          id: string
          is_active: boolean | null
          mph_number: number
          sub_department_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department_id: string
          id?: string
          is_active?: boolean | null
          mph_number?: number
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string
          id?: string
          is_active?: boolean | null
          mph_number?: number
          sub_department_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mph_calculating_numbers_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mph_calculating_numbers_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "production_sub_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      online_dispatches: {
        Row: {
          awb_number: string | null
          courier_partner: string | null
          created_at: string | null
          delivered_at: string | null
          dispatch_date: string
          dispatch_number: string
          dispatched_by: string | null
          id: string
          load_sheet_id: string | null
          order_id: string
          remarks: string | null
          status: string | null
          updated_at: string | null
          weight_grams: number | null
        }
        Insert: {
          awb_number?: string | null
          courier_partner?: string | null
          created_at?: string | null
          delivered_at?: string | null
          dispatch_date?: string
          dispatch_number: string
          dispatched_by?: string | null
          id?: string
          load_sheet_id?: string | null
          order_id: string
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Update: {
          awb_number?: string | null
          courier_partner?: string | null
          created_at?: string | null
          delivered_at?: string | null
          dispatch_date?: string
          dispatch_number?: string
          dispatched_by?: string | null
          id?: string
          load_sheet_id?: string | null
          order_id?: string
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "online_dispatches_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_dispatches_load_sheet_id_fkey"
            columns: ["load_sheet_id"]
            isOneToOne: false
            referencedRelation: "online_load_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      online_items: {
        Row: {
          code: string | null
          cost_price: number
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          cost_price?: number
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price?: number
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          cost_price?: number
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      online_load_sheets: {
        Row: {
          created_at: string | null
          id: string
          prepared_by: string | null
          remarks: string | null
          sheet_date: string
          sheet_number: string
          status: string | null
          total_parcels: number | null
          total_weight_grams: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          prepared_by?: string | null
          remarks?: string | null
          sheet_date?: string
          sheet_number: string
          status?: string | null
          total_parcels?: number | null
          total_weight_grams?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          prepared_by?: string | null
          remarks?: string | null
          sheet_date?: string
          sheet_number?: string
          status?: string | null
          total_parcels?: number | null
          total_weight_grams?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_load_sheets_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      online_order_items: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          item_name: string
          order_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          item_name: string
          order_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          item_name?: string
          order_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "online_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "online_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      online_orders: {
        Row: {
          actual_weight: number | null
          booked_at: string | null
          booking_weight: number | null
          city: string | null
          claim_filed_at: string | null
          claim_notes: string | null
          claim_status: string | null
          cod_amount: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          courier_order_status: string | null
          courier_partner_id: string | null
          courier_weight: number | null
          created_at: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          delivered_at: string | null
          delivery_date: string | null
          delivery_return_date: string | null
          gst: number | null
          id: string
          item_id: string | null
          item_name: string | null
          label_url: string | null
          last_tracked_at: string | null
          net_amount: number | null
          order_date: string
          order_number: string
          order_value: number | null
          origin_city: string | null
          payment_mode: string | null
          payment_ref: string | null
          pickup_date: string | null
          pincode: string | null
          platform: string
          platform_order_id: string | null
          quantity: number | null
          remarks: string | null
          return_city: string | null
          settled: boolean | null
          settled_at: string | null
          shipping_address: string | null
          shipping_charges: number | null
          state: string | null
          status: string | null
          tracking_number: string | null
          updated_at: string | null
          wh_income_tax: number | null
          wh_sales_tax: number | null
        }
        Insert: {
          actual_weight?: number | null
          booked_at?: string | null
          booking_weight?: number | null
          city?: string | null
          claim_filed_at?: string | null
          claim_notes?: string | null
          claim_status?: string | null
          cod_amount?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          courier_order_status?: string | null
          courier_partner_id?: string | null
          courier_weight?: number | null
          created_at?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_date?: string | null
          delivery_return_date?: string | null
          gst?: number | null
          id?: string
          item_id?: string | null
          item_name?: string | null
          label_url?: string | null
          last_tracked_at?: string | null
          net_amount?: number | null
          order_date?: string
          order_number: string
          order_value?: number | null
          origin_city?: string | null
          payment_mode?: string | null
          payment_ref?: string | null
          pickup_date?: string | null
          pincode?: string | null
          platform?: string
          platform_order_id?: string | null
          quantity?: number | null
          remarks?: string | null
          return_city?: string | null
          settled?: boolean | null
          settled_at?: string | null
          shipping_address?: string | null
          shipping_charges?: number | null
          state?: string | null
          status?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          wh_income_tax?: number | null
          wh_sales_tax?: number | null
        }
        Update: {
          actual_weight?: number | null
          booked_at?: string | null
          booking_weight?: number | null
          city?: string | null
          claim_filed_at?: string | null
          claim_notes?: string | null
          claim_status?: string | null
          cod_amount?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          courier_order_status?: string | null
          courier_partner_id?: string | null
          courier_weight?: number | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_date?: string | null
          delivery_return_date?: string | null
          gst?: number | null
          id?: string
          item_id?: string | null
          item_name?: string | null
          label_url?: string | null
          last_tracked_at?: string | null
          net_amount?: number | null
          order_date?: string
          order_number?: string
          order_value?: number | null
          origin_city?: string | null
          payment_mode?: string | null
          payment_ref?: string | null
          pickup_date?: string | null
          pincode?: string | null
          platform?: string
          platform_order_id?: string | null
          quantity?: number | null
          remarks?: string | null
          return_city?: string | null
          settled?: boolean | null
          settled_at?: string | null
          shipping_address?: string | null
          shipping_charges?: number | null
          state?: string | null
          status?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          wh_income_tax?: number | null
          wh_sales_tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "online_orders_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_orders_courier_partner_id_fkey"
            columns: ["courier_partner_id"]
            isOneToOne: false
            referencedRelation: "courier_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_orders_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "online_items"
            referencedColumns: ["id"]
          },
        ]
      }
      online_platforms: {
        Row: {
          code: string
          commission_pct: number
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          commission_pct?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          commission_pct?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      online_returns: {
        Row: {
          created_at: string | null
          created_by: string | null
          dispatch_id: string | null
          id: string
          order_id: string
          received_back: boolean | null
          received_date: string | null
          refund_amount: number | null
          refund_status: string | null
          remarks: string | null
          return_date: string
          return_number: string
          return_reason: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          dispatch_id?: string | null
          id?: string
          order_id: string
          received_back?: boolean | null
          received_date?: string | null
          refund_amount?: number | null
          refund_status?: string | null
          remarks?: string | null
          return_date?: string
          return_number: string
          return_reason?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          dispatch_id?: string | null
          id?: string
          order_id?: string
          received_back?: boolean | null
          received_date?: string | null
          refund_amount?: number | null
          refund_status?: string | null
          remarks?: string | null
          return_date?: string
          return_number?: string
          return_reason?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_returns_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "online_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      online_tracking_events: {
        Row: {
          created_at: string | null
          event_time: string | null
          id: string
          order_id: string | null
          raw: Json | null
          status: string | null
          status_message: string | null
          tracking_number: string | null
        }
        Insert: {
          created_at?: string | null
          event_time?: string | null
          id?: string
          order_id?: string | null
          raw?: Json | null
          status?: string | null
          status_message?: string | null
          tracking_number?: string | null
        }
        Update: {
          created_at?: string | null
          event_time?: string | null
          id?: string
          order_id?: string | null
          raw?: Json | null
          status?: string | null
          status_message?: string | null
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_tracking_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_types: {
        Row: {
          created_at: string | null
          dozens: number
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          dozens?: number
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          dozens?: number
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      padel_court_interactions: {
        Row: {
          court_id: string
          created_at: string
          follow_up_date: string | null
          id: string
          notes: string | null
          outcome: string | null
          performed_at: string
          performed_by: string | null
          stage_after: string | null
          stage_before: string | null
          type: string
        }
        Insert: {
          court_id: string
          created_at?: string
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          outcome?: string | null
          performed_at?: string
          performed_by?: string | null
          stage_after?: string | null
          stage_before?: string | null
          type: string
        }
        Update: {
          court_id?: string
          created_at?: string
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          outcome?: string | null
          performed_at?: string
          performed_by?: string | null
          stage_after?: string | null
          stage_before?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "padel_court_interactions_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "padel_courts"
            referencedColumns: ["id"]
          },
        ]
      }
      padel_courts: {
        Row: {
          area: string | null
          city: string | null
          created_at: string
          created_by: string | null
          current_ball_brand: string | null
          google_maps_url: string | null
          id: string
          latitude: number | null
          longitude: number | null
          lost_reason: string | null
          manager_email: string | null
          manager_name: string | null
          manager_phone: string | null
          monthly_consumption_estimate: number | null
          notes: string | null
          number_of_courts: number | null
          pipeline_stage: string
          updated_at: string
          venue_name: string
          weekly_play_hours: number | null
        }
        Insert: {
          area?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          current_ball_brand?: string | null
          google_maps_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          lost_reason?: string | null
          manager_email?: string | null
          manager_name?: string | null
          manager_phone?: string | null
          monthly_consumption_estimate?: number | null
          notes?: string | null
          number_of_courts?: number | null
          pipeline_stage?: string
          updated_at?: string
          venue_name: string
          weekly_play_hours?: number | null
        }
        Update: {
          area?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          current_ball_brand?: string | null
          google_maps_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          lost_reason?: string | null
          manager_email?: string | null
          manager_name?: string | null
          manager_phone?: string | null
          monthly_consumption_estimate?: number | null
          notes?: string | null
          number_of_courts?: number | null
          pipeline_stage?: string
          updated_at?: string
          venue_name?: string
          weekly_play_hours?: number | null
        }
        Relationships: []
      }
      padel_demo_sessions: {
        Row: {
          attendees_count: number | null
          balls_provided: number | null
          completed_at: string | null
          converted_to_trial: boolean
          court_id: string
          created_at: string
          created_by: string | null
          durability_rating: number | null
          id: string
          manager_feedback: string | null
          performance_rating: number | null
          photos_url: string[] | null
          player_feedback: string | null
          pressure_retention_rating: number | null
          scheduled_at: string | null
          updated_at: string
        }
        Insert: {
          attendees_count?: number | null
          balls_provided?: number | null
          completed_at?: string | null
          converted_to_trial?: boolean
          court_id: string
          created_at?: string
          created_by?: string | null
          durability_rating?: number | null
          id?: string
          manager_feedback?: string | null
          performance_rating?: number | null
          photos_url?: string[] | null
          player_feedback?: string | null
          pressure_retention_rating?: number | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Update: {
          attendees_count?: number | null
          balls_provided?: number | null
          completed_at?: string | null
          converted_to_trial?: boolean
          court_id?: string
          created_at?: string
          created_by?: string | null
          durability_rating?: number | null
          id?: string
          manager_feedback?: string | null
          performance_rating?: number | null
          photos_url?: string[] | null
          player_feedback?: string | null
          pressure_retention_rating?: number | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "padel_demo_sessions_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "padel_courts"
            referencedColumns: ["id"]
          },
        ]
      }
      padel_supply_agreements: {
        Row: {
          agreement_number: string | null
          auto_renew: boolean
          court_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivered_volume_mtd: number
          end_date: string | null
          id: string
          monthly_volume: number | null
          payment_terms: string | null
          start_date: string | null
          status: string
          type: string
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          agreement_number?: string | null
          auto_renew?: boolean
          court_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_volume_mtd?: number
          end_date?: string | null
          id?: string
          monthly_volume?: number | null
          payment_terms?: string | null
          start_date?: string | null
          status?: string
          type: string
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          agreement_number?: string | null
          auto_renew?: boolean
          court_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_volume_mtd?: number
          end_date?: string | null
          id?: string
          monthly_volume?: number | null
          payment_terms?: string | null
          start_date?: string | null
          status?: string
          type?: string
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "padel_supply_agreements_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "padel_courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "padel_supply_agreements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          bank_ref: string | null
          created_at: string | null
          created_by: string | null
          delivered_cod: number | null
          delivered_count: number | null
          gst: number | null
          imported_at: string | null
          notes: string | null
          official_net: number | null
          payment_ref: string
          received_amount: number | null
          returned_cod: number | null
          returned_count: number | null
          shipping: number | null
          statement_date: string | null
          wh_income: number | null
          wh_sales: number | null
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          bank_ref?: string | null
          created_at?: string | null
          created_by?: string | null
          delivered_cod?: number | null
          delivered_count?: number | null
          gst?: number | null
          imported_at?: string | null
          notes?: string | null
          official_net?: number | null
          payment_ref: string
          received_amount?: number | null
          returned_cod?: number | null
          returned_count?: number | null
          shipping?: number | null
          statement_date?: string | null
          wh_income?: number | null
          wh_sales?: number | null
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          bank_ref?: string | null
          created_at?: string | null
          created_by?: string | null
          delivered_cod?: number | null
          delivered_count?: number | null
          gst?: number | null
          imported_at?: string | null
          notes?: string | null
          official_net?: number | null
          payment_ref?: string
          received_amount?: number | null
          returned_cod?: number | null
          returned_count?: number | null
          shipping?: number | null
          statement_date?: string | null
          wh_income?: number | null
          wh_sales?: number | null
        }
        Relationships: []
      }
      performance_daily_tracking: {
        Row: {
          actual_value: number | null
          created_at: string
          employee_id: string
          id: string
          kpi_id: string
          remarks: string | null
          tracking_date: string
          updated_at: string
        }
        Insert: {
          actual_value?: number | null
          created_at?: string
          employee_id: string
          id?: string
          kpi_id: string
          remarks?: string | null
          tracking_date: string
          updated_at?: string
        }
        Update: {
          actual_value?: number | null
          created_at?: string
          employee_id?: string
          id?: string
          kpi_id?: string
          remarks?: string | null
          tracking_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_daily_tracking_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_daily_tracking_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "performance_monthly_kpis"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_goals: {
        Row: {
          actual_value: number | null
          assigned_by: string | null
          created_at: string
          employee_id: string
          id: string
          kpi_id: string
          remarks: string | null
          review_cycle_id: string
          score: number | null
          status: string
          target_value: number
          updated_at: string
          weight: number | null
        }
        Insert: {
          actual_value?: number | null
          assigned_by?: string | null
          created_at?: string
          employee_id: string
          id?: string
          kpi_id: string
          remarks?: string | null
          review_cycle_id: string
          score?: number | null
          status?: string
          target_value: number
          updated_at?: string
          weight?: number | null
        }
        Update: {
          actual_value?: number | null
          assigned_by?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          kpi_id?: string
          remarks?: string | null
          review_cycle_id?: string
          score?: number | null
          status?: string
          target_value?: number
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_goals_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_goals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_goals_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "performance_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_goals_review_cycle_id_fkey"
            columns: ["review_cycle_id"]
            isOneToOne: false
            referencedRelation: "performance_review_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_kpis: {
        Row: {
          category: string | null
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_value: number | null
          measurement_type: string
          min_value: number | null
          name: string
          target_direction: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_value?: number | null
          measurement_type?: string
          min_value?: number | null
          name: string
          target_direction?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_value?: number | null
          measurement_type?: string
          min_value?: number | null
          name?: string
          target_direction?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_kpis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_monthly_goals: {
        Row: {
          actual_value: number | null
          approved_at: string | null
          approved_by: string | null
          assigned_by: string | null
          created_at: string | null
          employee_id: string
          goal_month: number
          goal_year: number
          id: string
          kpi_id: string
          remarks: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          status: string
          target_value: number
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          actual_value?: number | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_by?: string | null
          created_at?: string | null
          employee_id: string
          goal_month: number
          goal_year: number
          id?: string
          kpi_id: string
          remarks?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          status?: string
          target_value?: number
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          actual_value?: number | null
          approved_at?: string | null
          approved_by?: string | null
          assigned_by?: string | null
          created_at?: string | null
          employee_id?: string
          goal_month?: number
          goal_year?: number
          id?: string
          kpi_id?: string
          remarks?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          status?: string
          target_value?: number
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_monthly_goals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_goals_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "performance_monthly_kpis"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_monthly_kpis: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_score: number
          name: string
          updated_at: string | null
          weight: number
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_score?: number
          name: string
          updated_at?: string | null
          weight?: number
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_score?: number
          name?: string
          updated_at?: string | null
          weight?: number
        }
        Relationships: []
      }
      performance_monthly_scores: {
        Row: {
          actual_value: number | null
          created_at: string | null
          created_by: string | null
          employee_id: string
          id: string
          kpi_id: string
          remarks: string | null
          score: number | null
          score_month: number
          score_year: number
          target_value: number
          updated_at: string | null
        }
        Insert: {
          actual_value?: number | null
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          id?: string
          kpi_id: string
          remarks?: string | null
          score?: number | null
          score_month: number
          score_year: number
          target_value?: number
          updated_at?: string | null
        }
        Update: {
          actual_value?: number | null
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          id?: string
          kpi_id?: string
          remarks?: string | null
          score?: number | null
          score_month?: number
          score_year?: number
          target_value?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_monthly_scores_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_scores_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_monthly_scores_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "performance_monthly_kpis"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_review_cycles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          name: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date: string
          id?: string
          name: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string
          id?: string
          name?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_review_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          acknowledged_at: string | null
          areas_for_improvement: string | null
          created_at: string
          employee_comments: string | null
          employee_id: string
          id: string
          overall_rating: string | null
          overall_score: number | null
          review_cycle_id: string
          reviewed_at: string | null
          reviewer_comments: string | null
          reviewer_id: string | null
          status: string
          strengths: string | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          areas_for_improvement?: string | null
          created_at?: string
          employee_comments?: string | null
          employee_id: string
          id?: string
          overall_rating?: string | null
          overall_score?: number | null
          review_cycle_id: string
          reviewed_at?: string | null
          reviewer_comments?: string | null
          reviewer_id?: string | null
          status?: string
          strengths?: string | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          areas_for_improvement?: string | null
          created_at?: string
          employee_comments?: string | null
          employee_id?: string
          id?: string
          overall_rating?: string | null
          overall_score?: number | null
          review_cycle_id?: string
          reviewed_at?: string | null
          reviewer_comments?: string | null
          reviewer_id?: string | null
          status?: string
          strengths?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_review_cycle_id_fkey"
            columns: ["review_cycle_id"]
            isOneToOne: false
            referencedRelation: "performance_review_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_entries: {
        Row: {
          amount: number
          approval_remarks: string | null
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          category_id: string | null
          created_at: string | null
          created_by: string | null
          description: string
          entry_date: string
          entry_number: string
          entry_type: string
          fund_id: string | null
          id: string
          paid_to: string | null
          receipt_number: string | null
          receipt_url: string | null
          running_balance: number | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          approval_remarks?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description: string
          entry_date?: string
          entry_number: string
          entry_type: string
          fund_id?: string | null
          id?: string
          paid_to?: string | null
          receipt_number?: string | null
          receipt_url?: string | null
          running_balance?: number | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          approval_remarks?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_number?: string
          entry_type?: string
          fund_id?: string | null
          id?: string
          paid_to?: string | null
          receipt_number?: string | null
          receipt_url?: string | null
          running_balance?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_entries_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_fund"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_fund: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_balance: number | null
          created_at: string | null
          fund_date: string
          id: string
          opening_balance: number
          remarks: string | null
          status: string | null
          total_expenses: number | null
          total_receipts: number | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_balance?: number | null
          created_at?: string | null
          fund_date?: string
          id?: string
          opening_balance?: number
          remarks?: string | null
          status?: string | null
          total_expenses?: number | null
          total_receipts?: number | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_balance?: number | null
          created_at?: string | null
          fund_date?: string
          id?: string
          opening_balance?: number
          remarks?: string | null
          status?: string | null
          total_expenses?: number | null
          total_receipts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_fund_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_items: {
        Row: {
          code: string
          costing_value: number | null
          created_at: string | null
          department_id: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          threshold_inventory: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          costing_value?: number | null
          created_at?: string | null
          department_id: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          threshold_inventory?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          costing_value?: number | null
          created_at?: string | null
          department_id?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          threshold_inventory?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      production_departments: {
        Row: {
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          sequence_order: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sequence_order?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sequence_order?: number | null
        }
        Relationships: []
      }
      production_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          department_id: string
          entry_date: string
          grade_id: string
          id: string
          machine_id: string | null
          operator_id: string | null
          quantity_ok: number
          quantity_produced: number
          quantity_rejected: number
          remarks: string | null
          shift: string
          status: string
          sub_department_id: string | null
          supervisor_id: string | null
          target_production: number
          uom_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          entry_date?: string
          grade_id: string
          id?: string
          machine_id?: string | null
          operator_id?: string | null
          quantity_ok?: number
          quantity_produced?: number
          quantity_rejected?: number
          remarks?: string | null
          shift?: string
          status?: string
          sub_department_id?: string | null
          supervisor_id?: string | null
          target_production?: number
          uom_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          entry_date?: string
          grade_id?: string
          id?: string
          machine_id?: string | null
          operator_id?: string | null
          quantity_ok?: number
          quantity_produced?: number
          quantity_rejected?: number
          remarks?: string | null
          shift?: string
          status?: string
          sub_department_id?: string | null
          supervisor_id?: string | null
          target_production?: number
          uom_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_sub_department_id_fkey"
            columns: ["sub_department_id"]
            isOneToOne: false
            referencedRelation: "production_sub_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_entries_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      production_order_items: {
        Row: {
          created_at: string
          grade_id: string | null
          id: string
          order_id: string
          packing_type: Database["public"]["Enums"]["packing_option"]
          product_id: string | null
          quantity_dozens: number
          quantity_produced: number
          remarks: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          grade_id?: string | null
          id?: string
          order_id: string
          packing_type: Database["public"]["Enums"]["packing_option"]
          product_id?: string | null
          quantity_dozens?: number
          quantity_produced?: number
          remarks?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          grade_id?: string | null
          id?: string
          order_id?: string
          packing_type?: Database["public"]["Enums"]["packing_option"]
          product_id?: string | null
          quantity_dozens?: number
          quantity_produced?: number
          remarks?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_items_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          order_date: string
          order_number: string
          priority: string | null
          remarks: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          order_date?: string
          order_number: string
          priority?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          order_date?: string
          order_number?: string
          priority?: string | null
          remarks?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      production_planning: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          id: string
          plan_number: string
          remarks: string | null
          status: string
          total_capacity_hrs: number | null
          total_planned_qty: number | null
          updated_at: string | null
          utilization_percent: number | null
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          plan_number: string
          remarks?: string | null
          status?: string
          total_capacity_hrs?: number | null
          total_planned_qty?: number | null
          updated_at?: string | null
          utilization_percent?: number | null
          week_end_date: string
          week_start_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          plan_number?: string
          remarks?: string | null
          status?: string
          total_capacity_hrs?: number | null
          total_planned_qty?: number | null
          updated_at?: string | null
          utilization_percent?: number | null
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_planning_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      production_planning_items: {
        Row: {
          capacity_required_hrs: number | null
          created_at: string | null
          department_id: string | null
          expected_demand: number | null
          gap_qty: number | null
          grade_id: string | null
          id: string
          machine_id: string | null
          plan_id: string | null
          planned_date: string
          planned_qty_dozens: number
          planning_item_id: string | null
          priority: string | null
          product_id: string | null
          remarks: string | null
          stock_in_hand: number | null
          updated_at: string | null
        }
        Insert: {
          capacity_required_hrs?: number | null
          created_at?: string | null
          department_id?: string | null
          expected_demand?: number | null
          gap_qty?: number | null
          grade_id?: string | null
          id?: string
          machine_id?: string | null
          plan_id?: string | null
          planned_date: string
          planned_qty_dozens?: number
          planning_item_id?: string | null
          priority?: string | null
          product_id?: string | null
          remarks?: string | null
          stock_in_hand?: number | null
          updated_at?: string | null
        }
        Update: {
          capacity_required_hrs?: number | null
          created_at?: string | null
          department_id?: string | null
          expected_demand?: number | null
          gap_qty?: number | null
          grade_id?: string | null
          id?: string
          machine_id?: string | null
          plan_id?: string | null
          planned_date?: string
          planned_qty_dozens?: number
          planning_item_id?: string | null
          priority?: string | null
          product_id?: string | null
          remarks?: string | null
          stock_in_hand?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_planning_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_items_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_items_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "production_planning"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_items_planning_item_id_fkey"
            columns: ["planning_item_id"]
            isOneToOne: false
            referencedRelation: "planning_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_planning_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_rejections: {
        Row: {
          created_at: string
          defect_reason_id: string
          id: string
          production_entry_id: string
          quantity: number
          remarks: string | null
        }
        Insert: {
          created_at?: string
          defect_reason_id: string
          id?: string
          production_entry_id: string
          quantity?: number
          remarks?: string | null
        }
        Update: {
          created_at?: string
          defect_reason_id?: string
          id?: string
          production_entry_id?: string
          quantity?: number
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_rejections_defect_reason_id_fkey"
            columns: ["defect_reason_id"]
            isOneToOne: false
            referencedRelation: "defect_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_rejections_production_entry_id_fkey"
            columns: ["production_entry_id"]
            isOneToOne: false
            referencedRelation: "production_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      production_requirement_items: {
        Row: {
          created_at: string
          id: string
          planning_item_id: string | null
          remarks: string | null
          required_by: string | null
          required_qty: number
          requirement_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          planning_item_id?: string | null
          remarks?: string | null
          required_by?: string | null
          required_qty?: number
          requirement_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          planning_item_id?: string | null
          remarks?: string | null
          required_by?: string | null
          required_qty?: number
          requirement_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_requirement_items_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "production_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      production_requirements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          priority: string
          requirement_number: string | null
          status: string
          title: string | null
          updated_at: string
          window_from: string
          window_to: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          priority?: string
          requirement_number?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          window_from: string
          window_to: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          priority?: string
          requirement_number?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          window_from?: string
          window_to?: string
        }
        Relationships: []
      }
      production_sub_departments: {
        Row: {
          code: string
          created_at: string | null
          department_id: string
          id: string
          is_active: boolean | null
          name: string
          sequence_order: number | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          department_id: string
          id?: string
          is_active?: boolean | null
          name: string
          sequence_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          department_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          sequence_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_sub_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      production_targets: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string
          grade_id: string
          id: string
          is_active: boolean
          target_quantity: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id: string
          grade_id: string
          id?: string
          is_active?: boolean
          target_quantity?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string
          grade_id?: string
          id?: string
          is_active?: boolean
          target_quantity?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_targets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_targets_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      production_wip_sequence: {
        Row: {
          created_at: string
          department_id: string
          is_included: boolean
          updated_at: string
          wip_order: number
        }
        Insert: {
          created_at?: string
          department_id: string
          is_included?: boolean
          updated_at?: string
          wip_order?: number
        }
        Update: {
          created_at?: string
          department_id?: string
          is_included?: boolean
          updated_at?: string
          wip_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_wip_sequence_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          grade_id: string | null
          id: string
          is_active: boolean | null
          name: string
          standard_cost: number | null
          standard_output_rate: number | null
          standard_selling_price: number | null
          uom_id: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          grade_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          standard_cost?: number | null
          standard_output_rate?: number | null
          standard_selling_price?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          grade_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          standard_cost?: number | null
          standard_output_rate?: number | null
          standard_selling_price?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          created_at: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          project_id: string
          remarks: string | null
          task_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          project_id: string
          remarks?: string | null
          task_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          project_id?: string
          remarks?: string | null
          task_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          actual_hours: number | null
          assigned_to: string | null
          completed_date: string | null
          created_at: string | null
          depends_on_task_id: string | null
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          is_milestone: boolean | null
          milestone_name: string | null
          priority: string | null
          project_id: string
          sort_order: number | null
          start_date: string | null
          status: string
          task_number: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_hours?: number | null
          assigned_to?: string | null
          completed_date?: string | null
          created_at?: string | null
          depends_on_task_id?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_milestone?: boolean | null
          milestone_name?: string | null
          priority?: string | null
          project_id: string
          sort_order?: number | null
          start_date?: string | null
          status?: string
          task_number?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_hours?: number | null
          assigned_to?: string | null
          completed_date?: string | null
          created_at?: string | null
          depends_on_task_id?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_milestone?: boolean | null
          milestone_name?: string | null
          priority?: string | null
          project_id?: string
          sort_order?: number | null
          start_date?: string | null
          status?: string
          task_number?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_end_date: string | null
          budget_actual: number | null
          budget_estimated: number | null
          created_at: string | null
          department_id: string | null
          description: string | null
          id: string
          methodology: string | null
          priority: string | null
          project_manager_id: string | null
          project_number: string
          start_date: string | null
          status: string
          target_end_date: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_end_date?: string | null
          budget_actual?: number | null
          budget_estimated?: number | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          methodology?: string | null
          priority?: string | null
          project_manager_id?: string | null
          project_number: string
          start_date?: string | null
          status?: string
          target_end_date?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_end_date?: string | null
          budget_actual?: number | null
          budget_estimated?: number | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          methodology?: string | null
          priority?: string | null
          project_manager_id?: string | null
          project_number?: string
          start_date?: string | null
          status?: string
          target_end_date?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_manager_id_fkey"
            columns: ["project_manager_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          created_at: string
          description: string | null
          holiday_date: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          holiday_date: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          holiday_date?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_category_permissions: {
        Row: {
          can_approve: boolean | null
          can_create: boolean | null
          can_view: boolean | null
          category: Database["public"]["Enums"]["purchase_category"]
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          can_approve?: boolean | null
          can_create?: boolean | null
          can_view?: boolean | null
          category: Database["public"]["Enums"]["purchase_category"]
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          can_approve?: boolean | null
          can_create?: boolean | null
          can_view?: boolean | null
          category?: Database["public"]["Enums"]["purchase_category"]
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_category_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          item_id: string | null
          order_id: string
          quantity: number
          quantity_received: number | null
          remarks: string | null
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          item_id?: string | null
          order_id: string
          quantity?: number
          quantity_received?: number | null
          remarks?: string | null
          unit_price?: number
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          item_id?: string | null
          order_id?: string
          quantity?: number
          quantity_received?: number | null
          remarks?: string | null
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          category: Database["public"]["Enums"]["purchase_category"]
          created_at: string | null
          created_by: string | null
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string
          payment_terms: number | null
          po_number: string
          shipping_address: string | null
          status: string
          supplier_id: string
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          category: Database["public"]["Enums"]["purchase_category"]
          created_at?: string | null
          created_by?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          payment_terms?: number | null
          po_number: string
          shipping_address?: string | null
          status?: string
          supplier_id: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          category?: Database["public"]["Enums"]["purchase_category"]
          created_at?: string | null
          created_by?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          payment_terms?: number | null
          po_number?: string
          shipping_address?: string | null
          status?: string
          supplier_id?: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_items: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          grn_item_id: string | null
          id: string
          item_id: string | null
          line_order: number
          quantity: number
          reason: string | null
          return_id: string
          unit_price: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string | null
          grn_item_id?: string | null
          id?: string
          item_id?: string | null
          line_order?: number
          quantity?: number
          reason?: string | null
          return_id: string
          unit_price?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          grn_item_id?: string | null
          id?: string
          item_id?: string | null
          line_order?: number
          quantity?: number
          reason?: string | null
          return_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_grn_item_id_fkey"
            columns: ["grn_item_id"]
            isOneToOne: false
            referencedRelation: "grn_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          accounting_voucher_id: string | null
          category: string
          created_at: string
          created_by: string | null
          grn_id: string | null
          id: string
          notes: string | null
          reason: string | null
          return_date: string
          return_number: string | null
          status: string
          subtotal: number
          supplier_id: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          accounting_voucher_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          grn_id?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          return_date?: string
          return_number?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          accounting_voucher_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          grn_id?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          return_date?: string
          return_number?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_capa: {
        Row: {
          action_plan: string | null
          capa_number: string
          capa_type: string
          completion_date: string | null
          created_at: string | null
          created_by: string | null
          description: string
          effectiveness_check: string | null
          id: string
          ncr_id: string | null
          responsible_person: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          target_date: string | null
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          action_plan?: string | null
          capa_number: string
          capa_type: string
          completion_date?: string | null
          created_at?: string | null
          created_by?: string | null
          description: string
          effectiveness_check?: string | null
          id?: string
          ncr_id?: string | null
          responsible_person?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          target_date?: string | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          action_plan?: string | null
          capa_number?: string
          capa_type?: string
          completion_date?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string
          effectiveness_check?: string | null
          id?: string
          ncr_id?: string | null
          responsible_person?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          target_date?: string | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_capa_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_capa_ncr_id_fkey"
            columns: ["ncr_id"]
            isOneToOne: false
            referencedRelation: "qa_ncr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_capa_responsible_person_fkey"
            columns: ["responsible_person"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_capa_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_daily_plan_items: {
        Row: {
          assigned_to: string | null
          completed_inspections: number
          created_at: string | null
          department_id: string | null
          grade_id: string | null
          id: string
          notes: string | null
          plan_id: string
          priority: string | null
          process_id: string | null
          target_inspections: number
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_inspections?: number
          created_at?: string | null
          department_id?: string | null
          grade_id?: string | null
          id?: string
          notes?: string | null
          plan_id: string
          priority?: string | null
          process_id?: string | null
          target_inspections?: number
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_inspections?: number
          created_at?: string | null
          department_id?: string | null
          grade_id?: string | null
          id?: string
          notes?: string | null
          plan_id?: string
          priority?: string | null
          process_id?: string | null
          target_inspections?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_daily_plan_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_daily_plan_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_daily_plan_items_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_daily_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "qa_daily_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_daily_plan_items_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_daily_plans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          plan_date: string
          remarks: string | null
          shift: string | null
          status: string
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          plan_date?: string
          remarks?: string | null
          shift?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          plan_date?: string
          remarks?: string | null
          shift?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_daily_plans_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_daily_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_daily_plans_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "qa_plan_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_inspection_readings: {
        Row: {
          created_at: string | null
          id: string
          inspection_id: string
          is_within_spec: boolean | null
          parameter_id: string
          remarks: string | null
          value_boolean: boolean | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inspection_id: string
          is_within_spec?: boolean | null
          parameter_id: string
          remarks?: string | null
          value_boolean?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inspection_id?: string
          is_within_spec?: boolean | null
          parameter_id?: string
          remarks?: string | null
          value_boolean?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_inspection_readings_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "qa_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspection_readings_parameter_id_fkey"
            columns: ["parameter_id"]
            isOneToOne: false
            referencedRelation: "qa_process_parameters"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_inspection_targets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          process_id: string
          target_count: number
          target_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          process_id: string
          target_count?: number
          target_date?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          process_id?: string
          target_count?: number
          target_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_inspection_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspection_targets_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_inspections: {
        Row: {
          created_at: string | null
          created_by: string | null
          department_id: string
          grade_id: string | null
          id: string
          inspection_date: string
          inspection_number: string
          inspector_id: string | null
          process_id: string
          remarks: string | null
          result: Database["public"]["Enums"]["qa_result"] | null
          reviewed_at: string | null
          reviewed_by: string | null
          shift: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          tag_tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          department_id: string
          grade_id?: string | null
          id?: string
          inspection_date?: string
          inspection_number: string
          inspector_id?: string | null
          process_id: string
          remarks?: string | null
          result?: Database["public"]["Enums"]["qa_result"] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          tag_tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          department_id?: string
          grade_id?: string | null
          id?: string
          inspection_date?: string
          inspection_number?: string
          inspector_id?: string | null
          process_id?: string
          remarks?: string | null
          result?: Database["public"]["Enums"]["qa_result"] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          tag_tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspections_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspections_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspections_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_inspections_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_instruction_acknowledgements: {
        Row: {
          acknowledgement_date: string
          created_at: string | null
          department_id: string
          id: string
          process_id: string
          user_id: string
        }
        Insert: {
          acknowledgement_date?: string
          created_at?: string | null
          department_id: string
          id?: string
          process_id: string
          user_id: string
        }
        Update: {
          acknowledgement_date?: string
          created_at?: string | null
          department_id?: string
          id?: string
          process_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_instruction_acknowledgements_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_instruction_acknowledgements_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_instruction_acknowledgements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_ncr: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          department_id: string
          description: string
          grade_id: string | null
          id: string
          immediate_action: string | null
          inspection_id: string | null
          ncr_date: string
          ncr_number: string
          quantity_affected: number | null
          raised_by: string | null
          root_cause: string | null
          severity: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          department_id: string
          description: string
          grade_id?: string | null
          id?: string
          immediate_action?: string | null
          inspection_id?: string | null
          ncr_date?: string
          ncr_number: string
          quantity_affected?: number | null
          raised_by?: string | null
          root_cause?: string | null
          severity?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          department_id?: string
          description?: string
          grade_id?: string | null
          id?: string
          immediate_action?: string | null
          inspection_id?: string | null
          ncr_date?: string
          ncr_number?: string
          quantity_affected?: number | null
          raised_by?: string | null
          root_cause?: string | null
          severity?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_ncr_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ncr_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ncr_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ncr_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ncr_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "qa_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ncr_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_plan_template_items: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          department_id: string | null
          grade_id: string | null
          id: string
          notes: string | null
          priority: string | null
          process_id: string | null
          target_inspections: number
          template_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          department_id?: string | null
          grade_id?: string | null
          id?: string
          notes?: string | null
          priority?: string | null
          process_id?: string | null
          target_inspections?: number
          template_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          department_id?: string | null
          grade_id?: string | null
          id?: string
          notes?: string | null
          priority?: string | null
          process_id?: string | null
          target_inspections?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_plan_template_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_plan_template_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_plan_template_items_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_plan_template_items_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_plan_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "qa_plan_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_plan_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_plan_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_process_instructions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          instruction_type: string
          is_active: boolean
          process_id: string
          step_number: number
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          instruction_type?: string
          is_active?: boolean
          process_id: string
          step_number?: number
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          instruction_type?: string
          is_active?: boolean
          process_id?: string
          step_number?: number
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_process_instructions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_process_instructions_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_process_parameters: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          is_required: boolean | null
          max_value: number | null
          min_value: number | null
          options: Json | null
          parameter_name: string
          parameter_type: string | null
          process_id: string
          sequence_order: number | null
          unit: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          max_value?: number | null
          min_value?: number | null
          options?: Json | null
          parameter_name: string
          parameter_type?: string | null
          process_id: string
          sequence_order?: number | null
          unit?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          max_value?: number | null
          min_value?: number | null
          options?: Json | null
          parameter_name?: string
          parameter_type?: string | null
          process_id?: string
          sequence_order?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_process_parameters_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_process_standards: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          process_id: string
          standard_description: string | null
          standard_title: string
          standard_type: string | null
          target_value: string | null
          tolerance_range: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          process_id: string
          standard_description?: string | null
          standard_title: string
          standard_type?: string | null
          target_value?: string | null
          tolerance_range?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          process_id?: string
          standard_description?: string | null
          standard_title?: string
          standard_type?: string | null
          target_value?: string | null
          tolerance_range?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_process_standards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_process_standards_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_processes: {
        Row: {
          code: string
          created_at: string | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_export_allowed: boolean
          is_hourly_tracked: boolean | null
          name: string
          requires_inspection_tag: boolean | null
          sequence_order: number | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_export_allowed?: boolean
          is_hourly_tracked?: boolean | null
          name: string
          requires_inspection_tag?: boolean | null
          sequence_order?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_export_allowed?: boolean
          is_hourly_tracked?: boolean | null
          name?: string
          requires_inspection_tag?: boolean | null
          sequence_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_processes_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      rd_experiments: {
        Row: {
          conclusion: string | null
          conducted_by: string | null
          created_at: string | null
          experiment_date: string | null
          experiment_number: string | null
          id: string
          materials_used: string | null
          methodology: string | null
          objective: string | null
          observations: string | null
          parameters: Json | null
          project_id: string | null
          results: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          conclusion?: string | null
          conducted_by?: string | null
          created_at?: string | null
          experiment_date?: string | null
          experiment_number?: string | null
          id?: string
          materials_used?: string | null
          methodology?: string | null
          objective?: string | null
          observations?: string | null
          parameters?: Json | null
          project_id?: string | null
          results?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          conclusion?: string | null
          conducted_by?: string | null
          created_at?: string | null
          experiment_date?: string | null
          experiment_number?: string | null
          id?: string
          materials_used?: string | null
          methodology?: string | null
          objective?: string | null
          observations?: string | null
          parameters?: Json | null
          project_id?: string | null
          results?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rd_experiments_conducted_by_fkey"
            columns: ["conducted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rd_experiments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "rd_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rd_projects: {
        Row: {
          actual_launch_date: string | null
          category: string | null
          created_at: string | null
          current_stage: string
          department_id: string | null
          description: string | null
          id: string
          priority: string | null
          product_type: string | null
          project_lead_id: string | null
          project_number: string | null
          remarks: string | null
          status: string
          target_launch_date: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_launch_date?: string | null
          category?: string | null
          created_at?: string | null
          current_stage?: string
          department_id?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          product_type?: string | null
          project_lead_id?: string | null
          project_number?: string | null
          remarks?: string | null
          status?: string
          target_launch_date?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_launch_date?: string | null
          category?: string | null
          created_at?: string | null
          current_stage?: string
          department_id?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          product_type?: string | null
          project_lead_id?: string | null
          project_number?: string | null
          remarks?: string | null
          status?: string
          target_launch_date?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rd_projects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rd_projects_project_lead_id_fkey"
            columns: ["project_lead_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rd_stage_gates: {
        Row: {
          approved_by: string | null
          completed_at: string | null
          created_at: string | null
          gate_checklist: Json | null
          id: string
          project_id: string
          remarks: string | null
          stage_name: string
          stage_order: number
          started_at: string | null
          status: string
        }
        Insert: {
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          gate_checklist?: Json | null
          id?: string
          project_id: string
          remarks?: string | null
          stage_name: string
          stage_order: number
          started_at?: string | null
          status?: string
        }
        Update: {
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          gate_checklist?: Json | null
          id?: string
          project_id?: string
          remarks?: string | null
          stage_name?: string
          stage_order?: number
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rd_stage_gates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rd_stage_gates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "rd_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_schedules: {
        Row: {
          asset_category: string
          created_at: string | null
          created_by: string | null
          frequency: string
          id: string
          is_active: boolean | null
          last_reconciliation_date: string | null
          next_due_date: string
          remarks: string | null
          updated_at: string | null
        }
        Insert: {
          asset_category: string
          created_at?: string | null
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_reconciliation_date?: string | null
          next_due_date: string
          remarks?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_category?: string
          created_at?: string | null
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_reconciliation_date?: string | null
          next_due_date?: string
          remarks?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rw_dispositions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          name_urdu: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          name_urdu?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          name_urdu?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rw_leakages: {
        Row: {
          created_at: string | null
          department_id: string | null
          disposition_id: string | null
          entered_at: string | null
          entered_by: string | null
          entry_date: string
          id: string
          leaked_qty: number
          material_id: string | null
          process_id: string | null
          reason_id: string | null
          remarks: string | null
          shift: string | null
          total_cost: number | null
          unit: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          disposition_id?: string | null
          entered_at?: string | null
          entered_by?: string | null
          entry_date: string
          id?: string
          leaked_qty?: number
          material_id?: string | null
          process_id?: string | null
          reason_id?: string | null
          remarks?: string | null
          shift?: string | null
          total_cost?: number | null
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          disposition_id?: string | null
          entered_at?: string | null
          entered_by?: string | null
          entry_date?: string
          id?: string
          leaked_qty?: number
          material_id?: string | null
          process_id?: string | null
          reason_id?: string | null
          remarks?: string | null
          shift?: string | null
          total_cost?: number | null
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rw_leakages_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rw_leakages_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "rw_dispositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rw_leakages_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rw_leakages_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "hp_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rw_leakages_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "hourly_production_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rw_leakages_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "rw_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rw_materials: {
        Row: {
          created_at: string
          hp_material_id: string
          id: string
          is_active: boolean
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          hp_material_id: string
          id?: string
          is_active?: boolean
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          hp_material_id?: string
          id?: string
          is_active?: boolean
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rw_materials_hp_material_id_fkey"
            columns: ["hp_material_id"]
            isOneToOne: true
            referencedRelation: "hp_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      rw_reasons: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      rw_rejections: {
        Row: {
          created_at: string
          department_id: string | null
          disposition: string
          disposition_id: string | null
          entered_at: string
          entered_by: string | null
          entry_date: string
          id: string
          material_id: string | null
          process_id: string | null
          product_id: string | null
          reason_id: string | null
          rejected_qty: number
          remarks: string | null
          rework_completed_at: string | null
          rework_qty: number
          rework_status: string | null
          shift: string | null
          sub_department_id: string | null
          total_cost: number
          unit: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          disposition?: string
          disposition_id?: string | null
          entered_at?: string
          entered_by?: string | null
          entry_date?: string
          id?: string
          material_id?: string | null
          process_id?: string | null
          product_id?: string | null
          reason_id?: string | null
          rejected_qty?: number
          remarks?: string | null
          rework_completed_at?: string | null
          rework_qty?: number
          rework_status?: string | null
          shift?: string | null
          sub_department_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          disposition?: string
          disposition_id?: string | null
          entered_at?: string
          entered_by?: string | null
          entry_date?: string
          id?: string
          material_id?: string | null
          process_id?: string | null
          product_id?: string | null
          reason_id?: string | null
          rejected_qty?: number
          remarks?: string | null
          rework_completed_at?: string | null
          rework_qty?: number
          rework_status?: string | null
          shift?: string | null
          sub_department_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rw_rejections_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "rw_dispositions"
            referencedColumns: ["id"]
          },
        ]
      }
      rw_units: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          symbol: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          symbol: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      rw_wastages: {
        Row: {
          created_at: string
          department_id: string | null
          disposition_id: string | null
          entered_at: string
          entered_by: string | null
          entry_date: string
          id: string
          material_id: string | null
          reason_id: string | null
          remarks: string | null
          shift: string | null
          total_cost: number
          unit: string | null
          unit_cost: number
          updated_at: string
          wasted_qty: number
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          disposition_id?: string | null
          entered_at?: string
          entered_by?: string | null
          entry_date?: string
          id?: string
          material_id?: string | null
          reason_id?: string | null
          remarks?: string | null
          shift?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
          updated_at?: string
          wasted_qty?: number
        }
        Update: {
          created_at?: string
          department_id?: string | null
          disposition_id?: string | null
          entered_at?: string
          entered_by?: string | null
          entry_date?: string
          id?: string
          material_id?: string | null
          reason_id?: string | null
          remarks?: string | null
          shift?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
          updated_at?: string
          wasted_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "rw_wastages_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "rw_dispositions"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_locks: {
        Row: {
          id: string
          lock_month: number
          lock_year: number
          locked_at: string | null
          locked_by: string | null
          module: string
          remarks: string | null
          total_employees: number | null
          total_net_salary: number | null
        }
        Insert: {
          id?: string
          lock_month: number
          lock_year: number
          locked_at?: string | null
          locked_by?: string | null
          module?: string
          remarks?: string | null
          total_employees?: number | null
          total_net_salary?: number | null
        }
        Update: {
          id?: string
          lock_month?: number
          lock_year?: number
          locked_at?: string | null
          locked_by?: string | null
          module?: string
          remarks?: string | null
          total_employees?: number | null
          total_net_salary?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "salary_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_areas: {
        Row: {
          city_id: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          city_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          city_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_areas_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "sales_cities"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_cities: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_customer_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_dispatch_items: {
        Row: {
          created_at: string | null
          dispatch_id: string
          id: string
          order_item_id: string
          packages: number | null
          packing_type: string | null
          quantity_dozens: number
          remarks: string | null
        }
        Insert: {
          created_at?: string | null
          dispatch_id: string
          id?: string
          order_item_id: string
          packages?: number | null
          packing_type?: string | null
          quantity_dozens: number
          remarks?: string | null
        }
        Update: {
          created_at?: string | null
          dispatch_id?: string
          id?: string
          order_item_id?: string
          packages?: number | null
          packing_type?: string | null
          quantity_dozens?: number
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_dispatch_items_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "sales_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_dispatch_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "sales_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_dispatch_orders: {
        Row: {
          created_at: string
          dispatch_id: string
          id: string
          order_id: string
        }
        Insert: {
          created_at?: string
          dispatch_id: string
          id?: string
          order_id: string
        }
        Update: {
          created_at?: string
          dispatch_id?: string
          id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_dispatch_orders_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "sales_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_dispatch_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_dispatches: {
        Row: {
          acknowledgement_date: string | null
          acknowledgement_doc_url: string | null
          actual_delivery_date: string | null
          created_at: string | null
          delivery_address: string | null
          delivery_status: string
          dispatch_date: string
          dispatch_number: string
          dispatched_by: string | null
          driver_contact: string | null
          driver_name: string | null
          expected_delivery_date: string | null
          freight_charges: number | null
          id: string
          lr_date: string | null
          lr_number: string | null
          notes: string | null
          order_id: string | null
          receiver_name: string | null
          receiver_signature: string | null
          sales_segment: Database["public"]["Enums"]["sales_segment"]
          total_packages: number | null
          total_weight: number | null
          transporter_name: string | null
          updated_at: string | null
          vehicle_number: string | null
        }
        Insert: {
          acknowledgement_date?: string | null
          acknowledgement_doc_url?: string | null
          actual_delivery_date?: string | null
          created_at?: string | null
          delivery_address?: string | null
          delivery_status?: string
          dispatch_date?: string
          dispatch_number: string
          dispatched_by?: string | null
          driver_contact?: string | null
          driver_name?: string | null
          expected_delivery_date?: string | null
          freight_charges?: number | null
          id?: string
          lr_date?: string | null
          lr_number?: string | null
          notes?: string | null
          order_id?: string | null
          receiver_name?: string | null
          receiver_signature?: string | null
          sales_segment?: Database["public"]["Enums"]["sales_segment"]
          total_packages?: number | null
          total_weight?: number | null
          transporter_name?: string | null
          updated_at?: string | null
          vehicle_number?: string | null
        }
        Update: {
          acknowledgement_date?: string | null
          acknowledgement_doc_url?: string | null
          actual_delivery_date?: string | null
          created_at?: string | null
          delivery_address?: string | null
          delivery_status?: string
          dispatch_date?: string
          dispatch_number?: string
          dispatched_by?: string | null
          driver_contact?: string | null
          driver_name?: string | null
          expected_delivery_date?: string | null
          freight_charges?: number | null
          id?: string
          lr_date?: string | null
          lr_number?: string | null
          notes?: string | null
          order_id?: string | null
          receiver_name?: string | null
          receiver_signature?: string | null
          sales_segment?: Database["public"]["Enums"]["sales_segment"]
          total_packages?: number | null
          total_weight?: number | null
          transporter_name?: string | null
          updated_at?: string | null
          vehicle_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_dispatches_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_fuel_payouts: {
        Row: {
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          paid_at: string | null
          paid_by: string | null
          payout_number: string | null
          remarks: string | null
          status: string
          total_amount: number
          total_km: number
          total_litres: number
          updated_at: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payout_number?: string | null
          remarks?: string | null
          status?: string
          total_amount?: number
          total_km?: number
          total_litres?: number
          updated_at?: string
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payout_number?: string | null
          remarks?: string | null
          status?: string
          total_amount?: number
          total_km?: number
          total_litres?: number
          updated_at?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      sales_fuel_prices: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          price_per_litre: number
          remarks: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_date: string
          id?: string
          price_per_litre: number
          remarks?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          price_per_litre?: number
          remarks?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sales_fuel_trips: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          end_odometer: number
          from_location: string | null
          fuel_price_snapshot: number | null
          id: string
          km: number | null
          litres: number | null
          mileage_kmpl_snapshot: number | null
          payout_id: string | null
          purpose: string | null
          rejected_reason: string | null
          remarks: string | null
          start_odometer: number
          status: string
          to_location: string | null
          trip_date: string
          updated_at: string
          user_id: string
          vehicle_id: string | null
          visit_id: string | null
        }
        Insert: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          end_odometer?: number
          from_location?: string | null
          fuel_price_snapshot?: number | null
          id?: string
          km?: number | null
          litres?: number | null
          mileage_kmpl_snapshot?: number | null
          payout_id?: string | null
          purpose?: string | null
          rejected_reason?: string | null
          remarks?: string | null
          start_odometer?: number
          status?: string
          to_location?: string | null
          trip_date?: string
          updated_at?: string
          user_id: string
          vehicle_id?: string | null
          visit_id?: string | null
        }
        Update: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          end_odometer?: number
          from_location?: string | null
          fuel_price_snapshot?: number | null
          id?: string
          km?: number | null
          litres?: number | null
          mileage_kmpl_snapshot?: number | null
          payout_id?: string | null
          purpose?: string | null
          rejected_reason?: string | null
          remarks?: string | null
          start_odometer?: number
          status?: string
          to_location?: string | null
          trip_date?: string
          updated_at?: string
          user_id?: string
          vehicle_id?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_fuel_trips_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "sales_fuel_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_fuel_trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "sales_fuel_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_fuel_vehicles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          mileage_kmpl: number
          registration_no: string | null
          remarks: string | null
          updated_at: string
          user_id: string
          vehicle_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          mileage_kmpl?: number
          registration_no?: string | null
          remarks?: string | null
          updated_at?: string
          user_id: string
          vehicle_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          mileage_kmpl?: number
          registration_no?: string | null
          remarks?: string | null
          updated_at?: string
          user_id?: string
          vehicle_type?: string
        }
        Relationships: []
      }
      sales_order_items: {
        Row: {
          amount: number
          created_at: string | null
          details: string | null
          grade_id: string | null
          id: string
          order_id: string
          packing_type: string | null
          price_per_dozen: number
          product_id: string | null
          production_instructions: string | null
          quantity_dispatched: number | null
          quantity_dozens: number
          remarks: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          details?: string | null
          grade_id?: string | null
          id?: string
          order_id: string
          packing_type?: string | null
          price_per_dozen: number
          product_id?: string | null
          production_instructions?: string | null
          quantity_dispatched?: number | null
          quantity_dozens: number
          remarks?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          details?: string | null
          grade_id?: string | null
          id?: string
          order_id?: string
          packing_type?: string | null
          price_per_dozen?: number
          product_id?: string | null
          production_instructions?: string | null
          quantity_dispatched?: number | null
          quantity_dozens?: number
          remarks?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_items_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string
          discount_percent: number | null
          expected_dispatch_date: string | null
          id: string
          net_amount: number | null
          notes: string | null
          order_date: string
          order_number: string
          payment_terms: string | null
          quotation_id: string | null
          required_date: string | null
          sales_segment: Database["public"]["Enums"]["sales_segment"]
          shipping_address: string | null
          status: string
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          discount_percent?: number | null
          expected_dispatch_date?: string | null
          id?: string
          net_amount?: number | null
          notes?: string | null
          order_date?: string
          order_number: string
          payment_terms?: string | null
          quotation_id?: string | null
          required_date?: string | null
          sales_segment?: Database["public"]["Enums"]["sales_segment"]
          shipping_address?: string | null
          status?: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          discount_percent?: number | null
          expected_dispatch_date?: string | null
          id?: string
          net_amount?: number | null
          notes?: string | null
          order_date?: string
          order_number?: string
          payment_terms?: string | null
          quotation_id?: string | null
          required_date?: string | null
          sales_segment?: Database["public"]["Enums"]["sales_segment"]
          shipping_address?: string | null
          status?: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotation_items: {
        Row: {
          amount: number
          created_at: string | null
          grade_id: string | null
          id: string
          packing_type: string | null
          price_per_dozen: number
          product_id: string | null
          quantity_dozens: number
          quotation_id: string
          remarks: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          grade_id?: string | null
          id?: string
          packing_type?: string | null
          price_per_dozen: number
          product_id?: string | null
          quantity_dozens: number
          quotation_id: string
          remarks?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          grade_id?: string | null
          id?: string
          packing_type?: string | null
          price_per_dozen?: number
          product_id?: string | null
          quantity_dozens?: number
          quotation_id?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotation_items_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotations: {
        Row: {
          converted_to_order_id: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string
          discount_percent: number | null
          id: string
          net_amount: number | null
          notes: string | null
          quotation_date: string
          quotation_number: string
          status: string
          total_amount: number | null
          updated_at: string | null
          valid_until: string | null
        }
        Insert: {
          converted_to_order_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          discount_percent?: number | null
          id?: string
          net_amount?: number | null
          notes?: string | null
          quotation_date?: string
          quotation_number: string
          status?: string
          total_amount?: number | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Update: {
          converted_to_order_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          discount_percent?: number | null
          id?: string
          net_amount?: number | null
          notes?: string | null
          quotation_date?: string
          quotation_number?: string
          status?: string
          total_amount?: number | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_return_items: {
        Row: {
          amount: number
          created_at: string
          dispatch_item_id: string | null
          id: string
          line_order: number
          product_id: string | null
          quantity_dozens: number
          reason: string | null
          return_id: string
          standard_cost: number
          unit_price: number
        }
        Insert: {
          amount?: number
          created_at?: string
          dispatch_item_id?: string | null
          id?: string
          line_order?: number
          product_id?: string | null
          quantity_dozens?: number
          reason?: string | null
          return_id: string
          standard_cost?: number
          unit_price?: number
        }
        Update: {
          amount?: number
          created_at?: string
          dispatch_item_id?: string | null
          id?: string
          line_order?: number
          product_id?: string | null
          quantity_dozens?: number
          reason?: string | null
          return_id?: string
          standard_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_return_items_dispatch_item_id_fkey"
            columns: ["dispatch_item_id"]
            isOneToOne: false
            referencedRelation: "sales_dispatch_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_returns: {
        Row: {
          accounting_voucher_id: string | null
          cogs_amount: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          dispatch_id: string | null
          id: string
          notes: string | null
          reason: string | null
          return_date: string
          return_number: string | null
          status: string
          subtotal: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          accounting_voucher_id?: string | null
          cogs_amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          dispatch_id?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          return_date?: string
          return_number?: string | null
          status?: string
          subtotal?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          accounting_voucher_id?: string | null
          cogs_amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          dispatch_id?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          return_date?: string
          return_number?: string | null
          status?: string
          subtotal?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_returns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "sales_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      scrap_reasons: {
        Row: {
          code: string
          created_at: string | null
          department_id: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrap_reasons_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      six_sigma_metrics: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          measurement_date: string
          metric_type: string
          metric_value: number
          project_id: string
          remarks: string | null
          unit: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          measurement_date?: string
          metric_type: string
          metric_value: number
          project_id: string
          remarks?: string | null
          unit?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          measurement_date?: string
          metric_type?: string
          metric_value?: number
          project_id?: string
          remarks?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "six_sigma_metrics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_metrics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "six_sigma_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      six_sigma_phases: {
        Row: {
          created_at: string | null
          deliverables: string | null
          end_date: string | null
          gate_review_date: string | null
          gate_review_status: string | null
          gate_reviewer_id: string | null
          id: string
          phase_name: string
          project_id: string
          remarks: string | null
          start_date: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deliverables?: string | null
          end_date?: string | null
          gate_review_date?: string | null
          gate_review_status?: string | null
          gate_reviewer_id?: string | null
          id?: string
          phase_name: string
          project_id: string
          remarks?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deliverables?: string | null
          end_date?: string | null
          gate_review_date?: string | null
          gate_review_status?: string | null
          gate_reviewer_id?: string | null
          id?: string
          phase_name?: string
          project_id?: string
          remarks?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "six_sigma_phases_gate_reviewer_id_fkey"
            columns: ["gate_reviewer_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "six_sigma_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      six_sigma_projects: {
        Row: {
          actual_completion: string | null
          actual_savings: number | null
          baseline_dpmo: number | null
          baseline_sigma: number | null
          belt_leader_id: string | null
          champion_id: string | null
          created_at: string | null
          created_by: string | null
          current_dpmo: number | null
          current_phase: string
          current_sigma: number | null
          department_id: string | null
          description: string | null
          estimated_savings: number | null
          goal_statement: string | null
          id: string
          linked_capa_ids: string[] | null
          linked_ncr_ids: string[] | null
          methodology: string
          priority: string | null
          problem_statement: string | null
          project_number: string
          scope: string | null
          start_date: string | null
          status: string
          target_completion: string | null
          target_dpmo: number | null
          target_sigma: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_completion?: string | null
          actual_savings?: number | null
          baseline_dpmo?: number | null
          baseline_sigma?: number | null
          belt_leader_id?: string | null
          champion_id?: string | null
          created_at?: string | null
          created_by?: string | null
          current_dpmo?: number | null
          current_phase?: string
          current_sigma?: number | null
          department_id?: string | null
          description?: string | null
          estimated_savings?: number | null
          goal_statement?: string | null
          id?: string
          linked_capa_ids?: string[] | null
          linked_ncr_ids?: string[] | null
          methodology?: string
          priority?: string | null
          problem_statement?: string | null
          project_number: string
          scope?: string | null
          start_date?: string | null
          status?: string
          target_completion?: string | null
          target_dpmo?: number | null
          target_sigma?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_completion?: string | null
          actual_savings?: number | null
          baseline_dpmo?: number | null
          baseline_sigma?: number | null
          belt_leader_id?: string | null
          champion_id?: string | null
          created_at?: string | null
          created_by?: string | null
          current_dpmo?: number | null
          current_phase?: string
          current_sigma?: number | null
          department_id?: string | null
          description?: string | null
          estimated_savings?: number | null
          goal_statement?: string | null
          id?: string
          linked_capa_ids?: string[] | null
          linked_ncr_ids?: string[] | null
          methodology?: string
          priority?: string | null
          problem_statement?: string | null
          project_number?: string
          scope?: string | null
          start_date?: string | null
          status?: string
          target_completion?: string | null
          target_dpmo?: number | null
          target_sigma?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "six_sigma_projects_belt_leader_id_fkey"
            columns: ["belt_leader_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_projects_champion_id_fkey"
            columns: ["champion_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_projects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      six_sigma_team_members: {
        Row: {
          created_at: string | null
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "six_sigma_team_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "six_sigma_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      six_sigma_tools: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          phase_id: string | null
          project_id: string
          status: string | null
          title: string
          tool_data: Json
          tool_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          phase_id?: string | null
          project_id: string
          status?: string | null
          title: string
          tool_data?: Json
          tool_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          phase_id?: string | null
          project_id?: string
          status?: string | null
          title?: string
          tool_data?: Json
          tool_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "six_sigma_tools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_tools_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "six_sigma_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "six_sigma_tools_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "six_sigma_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      skilled_labour_planning: {
        Row: {
          available_workers: number
          created_at: string | null
          created_by: string | null
          department_id: string | null
          id: string
          is_active: boolean | null
          output_per_worker_per_day: number
          output_unit: string | null
          process_id: string | null
          process_name: string
          remarks: string | null
          required_workers: number
          to_hire: number
          to_train: number
          updated_at: string | null
        }
        Insert: {
          available_workers?: number
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          output_per_worker_per_day?: number
          output_unit?: string | null
          process_id?: string | null
          process_name: string
          remarks?: string | null
          required_workers?: number
          to_hire?: number
          to_train?: number
          updated_at?: string | null
        }
        Update: {
          available_workers?: number
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          output_per_worker_per_day?: number
          output_unit?: string | null
          process_id?: string | null
          process_name?: string
          remarks?: string | null
          required_workers?: number
          to_hire?: number
          to_train?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skilled_labour_planning_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skilled_labour_planning_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skilled_labour_planning_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "qa_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_part_issues: {
        Row: {
          created_at: string | null
          id: string
          issue_date: string
          issue_number: string
          issued_by: string | null
          issued_to: string | null
          machine_id: string | null
          purpose: string | null
          quantity_issued: number
          remarks: string | null
          spare_part_id: string
          status: string | null
          total_cost: number | null
          unit_cost: number | null
          updated_at: string | null
          work_order_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          issue_date?: string
          issue_number: string
          issued_by?: string | null
          issued_to?: string | null
          machine_id?: string | null
          purpose?: string | null
          quantity_issued?: number
          remarks?: string | null
          spare_part_id: string
          status?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          issue_date?: string
          issue_number?: string
          issued_by?: string | null
          issued_to?: string | null
          machine_id?: string | null
          purpose?: string | null
          quantity_issued?: number
          remarks?: string | null
          spare_part_id?: string
          status?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spare_part_issues_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spare_part_issues_issued_to_fkey"
            columns: ["issued_to"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spare_part_issues_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spare_part_issues_spare_part_id_fkey"
            columns: ["spare_part_id"]
            isOneToOne: false
            referencedRelation: "spare_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spare_part_issues_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_parts: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          current_stock: number | null
          description: string | null
          id: string
          is_active: boolean | null
          location: string | null
          minimum_stock: number | null
          name: string
          unit_cost: number | null
          unit_of_measure: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          current_stock?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          location?: string | null
          minimum_stock?: number | null
          name: string
          unit_cost?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          current_stock?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          location?: string | null
          minimum_stock?: number | null
          name?: string
          unit_cost?: number | null
          unit_of_measure?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          from_location_id: string | null
          id: string
          item_id: string
          item_type: string
          movement_date: string
          movement_number: string
          movement_type: string
          quantity: number
          reference_id: string | null
          reference_number: string | null
          reference_type: string | null
          remarks: string | null
          status: string | null
          to_location_id: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          item_id: string
          item_type: string
          movement_date?: string
          movement_number: string
          movement_type: string
          quantity: number
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          remarks?: string | null
          status?: string | null
          to_location_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          item_id?: string
          item_type?: string
          movement_date?: string
          movement_number?: string
          movement_type?: string
          quantity?: number
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          remarks?: string | null
          status?: string | null
          to_location_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          accounting_party_id: string | null
          address: string | null
          categories: Database["public"]["Enums"]["purchase_category"][] | null
          city: string | null
          code: string
          contact_person: string | null
          country: string | null
          created_at: string | null
          email: string | null
          gst_number: string | null
          id: string
          is_active: boolean | null
          lead_time_days: number | null
          name: string
          payment_terms: number | null
          phone: string | null
          rating: number | null
          state: string | null
          updated_at: string | null
        }
        Insert: {
          accounting_party_id?: string | null
          address?: string | null
          categories?: Database["public"]["Enums"]["purchase_category"][] | null
          city?: string | null
          code: string
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          lead_time_days?: number | null
          name: string
          payment_terms?: number | null
          phone?: string | null
          rating?: number | null
          state?: string | null
          updated_at?: string | null
        }
        Update: {
          accounting_party_id?: string | null
          address?: string | null
          categories?: Database["public"]["Enums"]["purchase_category"][] | null
          city?: string | null
          code?: string
          contact_person?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          lead_time_days?: number | null
          name?: string
          payment_terms?: number | null
          phone?: string | null
          rating?: number | null
          state?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_accounting_party_id_fkey"
            columns: ["accounting_party_id"]
            isOneToOne: false
            referencedRelation: "accounting_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      system_alerts: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          message: string
          module: string | null
          priority: number
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          message: string
          module?: string | null
          priority?: number
          type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          message?: string
          module?: string | null
          priority?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_alerts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          symbol: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          symbol: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_bills: {
        Row: {
          base_amount: number
          bill_attachment_url: string | null
          bill_date: string
          bill_number: string
          billing_period_end: string
          billing_period_start: string
          created_at: string | null
          created_by: string | null
          department_id: string | null
          due_date: string
          id: string
          meter_reading_current: number | null
          meter_reading_previous: number | null
          other_charges: number | null
          payment_date: string | null
          payment_mode: string | null
          payment_reference: string | null
          payment_status: string | null
          receipt_attachment_url: string | null
          remarks: string | null
          tax_amount: number | null
          total_amount: number
          unit_rate: number | null
          units_consumed: number | null
          updated_at: string | null
          utility_type_id: string
        }
        Insert: {
          base_amount: number
          bill_attachment_url?: string | null
          bill_date: string
          bill_number: string
          billing_period_end: string
          billing_period_start: string
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          due_date: string
          id?: string
          meter_reading_current?: number | null
          meter_reading_previous?: number | null
          other_charges?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          receipt_attachment_url?: string | null
          remarks?: string | null
          tax_amount?: number | null
          total_amount: number
          unit_rate?: number | null
          units_consumed?: number | null
          updated_at?: string | null
          utility_type_id: string
        }
        Update: {
          base_amount?: number
          bill_attachment_url?: string | null
          bill_date?: string
          bill_number?: string
          billing_period_end?: string
          billing_period_start?: string
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          due_date?: string
          id?: string
          meter_reading_current?: number | null
          meter_reading_previous?: number | null
          other_charges?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          receipt_attachment_url?: string | null
          remarks?: string | null
          tax_amount?: number | null
          total_amount?: number
          unit_rate?: number | null
          units_consumed?: number | null
          updated_at?: string | null
          utility_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_bills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_bills_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_bills_utility_type_id_fkey"
            columns: ["utility_type_id"]
            isOneToOne: false
            referencedRelation: "utility_types"
            referencedColumns: ["id"]
          },
        ]
      }
      utility_types: {
        Row: {
          billing_cycle: string | null
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          billing_cycle?: string | null
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          billing_cycle?: string | null
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      wip_inventory: {
        Row: {
          closing_qty: number
          created_at: string
          department_id: string
          entry_date: string
          grade_id: string
          id: string
          opening_qty: number
          process_stage: string | null
          produced_qty: number
          received_qty: number
          status: string | null
          transferred_qty: number
          uom_id: string | null
          updated_at: string
        }
        Insert: {
          closing_qty?: number
          created_at?: string
          department_id: string
          entry_date?: string
          grade_id: string
          id?: string
          opening_qty?: number
          process_stage?: string | null
          produced_qty?: number
          received_qty?: number
          status?: string | null
          transferred_qty?: number
          uom_id?: string | null
          updated_at?: string
        }
        Update: {
          closing_qty?: number
          created_at?: string
          department_id?: string
          entry_date?: string
          grade_id?: string
          id?: string
          opening_qty?: number
          process_stage?: string | null
          produced_qty?: number
          received_qty?: number
          status?: string | null
          transferred_qty?: number
          uom_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wip_inventory_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "production_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_inventory_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wip_inventory_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      wip_stage_thresholds: {
        Row: {
          created_at: string
          id: string
          max_threshold: number
          notes: string | null
          stage_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_threshold?: number
          notes?: string | null
          stage_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_threshold?: number
          notes?: string | null
          stage_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wip_stage_thresholds_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: true
            referencedRelation: "wip_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      wip_stages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sequence_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sequence_order: number
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sequence_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      wip_stock_entries: {
        Row: {
          created_at: string
          entered_by: string | null
          entry_date: string
          entry_time: string
          id: string
          quantity: number
          remarks: string | null
          stage_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entered_by?: string | null
          entry_date?: string
          entry_time?: string
          id?: string
          quantity?: number
          remarks?: string | null
          stage_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entered_by?: string | null
          entry_date?: string
          entry_time?: string
          id?: string
          quantity?: number
          remarks?: string | null
          stage_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wip_stock_entries_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "wip_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_spare_parts: {
        Row: {
          created_at: string | null
          id: string
          quantity_used: number
          remarks: string | null
          spare_part_id: string
          total_cost: number | null
          unit_cost: number | null
          work_order_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          quantity_used?: number
          remarks?: string | null
          spare_part_id: string
          total_cost?: number | null
          unit_cost?: number | null
          work_order_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          quantity_used?: number
          remarks?: string | null
          spare_part_id?: string
          total_cost?: number | null
          unit_cost?: number | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_spare_parts_spare_part_id_fkey"
            columns: ["spare_part_id"]
            isOneToOne: false
            referencedRelation: "spare_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_spare_parts_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accounting_periodic_cogs_inputs: {
        Args: { p_from: string; p_to: string }
        Returns: {
          already_posted_cogs: number
          current_fg_wip_items: number
          current_fg_wip_value: number
          current_rm_items: number
          current_rm_value: number
          previous_fg_wip_items: number
          previous_fg_wip_value: number
          previous_rm_items: number
          previous_rm_value: number
          production_additions: number
          rm_purchases_value: number
          unpriced_fg_wip_count: number
          unpriced_rm_count: number
        }[]
      }
      backup_list_tables: { Args: never; Returns: string[] }
      backup_schema_sql: { Args: never; Returns: string }
      create_app_user: {
        Args: {
          p_department_id?: string
          p_designation?: string
          p_full_name: string
          p_password: string
          p_user_id: string
        }
        Returns: string
      }
      floor_inventory_apply_movement: {
        Args: { p_movement_id: string }
        Returns: undefined
      }
      floor_inventory_execute_production: {
        Args: {
          p_bom_id: string
          p_from_location_id: string
          p_multiplier: number
          p_production_date?: string
          p_remarks?: string
          p_to_location_id: string
        }
        Returns: string
      }
      generate_breakdown_number: { Args: never; Returns: string }
      generate_dev_task_number: { Args: never; Returns: string }
      generate_job_code: { Args: never; Returns: string }
      generate_kpi_code: { Args: never; Returns: string }
      generate_schedule_number: { Args: never; Returns: string }
      generate_work_order_number: { Args: never; Returns: string }
      has_module_permission: {
        Args: { _module: string; _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      reset_user_password: {
        Args: { p_new_password: string; p_user_uuid: string }
        Returns: boolean
      }
      verify_user_password: {
        Args: { p_password: string; p_user_id: string }
        Returns: {
          is_valid: boolean
          user_uuid: string
        }[]
      }
    }
    Enums: {
      accounting_account_type:
        | "asset"
        | "liability"
        | "equity"
        | "revenue"
        | "expense"
      accounting_party_type: "customer" | "supplier" | "employee" | "other"
      accounting_voucher_type:
        | "CRV"
        | "CPV"
        | "BRV"
        | "BPV"
        | "JV"
        | "CV"
        | "OB"
      app_role:
        | "super_admin"
        | "admin"
        | "manager"
        | "supervisor"
        | "operator"
        | "viewer"
        | "operational_manager"
        | "qa_manager"
        | "maintenance_manager"
        | "sales_executive"
        | "order_management"
        | "floor_incharge"
        | "private_label_distributor"
        | "pettycash_handler"
        | "store_operator"
        | "project_manager"
        | "online_sales_packing"
        | "accounting_poster"
        | "accounting_officer"
        | "accounting_manager"
        | "purchase_officer"
        | "purchase_manager"
        | "billing_officer"
        | "dispatch_operator"
        | "sales_order_manager"
        | "production_operator"
        | "closing_data_poster"
        | "distributor_sales"
        | "distributor_manager"
        | "distributor_admin"
      asset_category:
        | "office_assets"
        | "production_machinery"
        | "molds_dies"
        | "machine_spare_parts"
      asset_status:
        | "active"
        | "under_maintenance"
        | "disposed"
        | "written_off"
        | "sold"
      finance_account_type:
        | "asset"
        | "liability"
        | "equity"
        | "revenue"
        | "expense"
      finance_period_status: "open" | "closed" | "draft"
      packing_option:
        | "12_dz_ctns"
        | "20_dz_bag"
        | "60_dz_bag"
        | "20_dz_ctn"
        | "6_dz_ctn"
      priority_level: "low" | "medium" | "high" | "critical"
      purchase_category:
        | "raw_material"
        | "office_supplies"
        | "general_supplies"
        | "spare_maintenance"
      qa_result: "pass" | "fail" | "hold"
      record_status:
        | "draft"
        | "in_progress"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "closed"
      sales_segment: "private_label" | "domestic" | "export"
      shift_type: "morning" | "afternoon" | "night"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      accounting_account_type: [
        "asset",
        "liability",
        "equity",
        "revenue",
        "expense",
      ],
      accounting_party_type: ["customer", "supplier", "employee", "other"],
      accounting_voucher_type: ["CRV", "CPV", "BRV", "BPV", "JV", "CV", "OB"],
      app_role: [
        "super_admin",
        "admin",
        "manager",
        "supervisor",
        "operator",
        "viewer",
        "operational_manager",
        "qa_manager",
        "maintenance_manager",
        "sales_executive",
        "order_management",
        "floor_incharge",
        "private_label_distributor",
        "pettycash_handler",
        "store_operator",
        "project_manager",
        "online_sales_packing",
        "accounting_poster",
        "accounting_officer",
        "accounting_manager",
        "purchase_officer",
        "purchase_manager",
        "billing_officer",
        "dispatch_operator",
        "sales_order_manager",
        "production_operator",
        "closing_data_poster",
        "distributor_sales",
        "distributor_manager",
        "distributor_admin",
      ],
      asset_category: [
        "office_assets",
        "production_machinery",
        "molds_dies",
        "machine_spare_parts",
      ],
      asset_status: [
        "active",
        "under_maintenance",
        "disposed",
        "written_off",
        "sold",
      ],
      finance_account_type: [
        "asset",
        "liability",
        "equity",
        "revenue",
        "expense",
      ],
      finance_period_status: ["open", "closed", "draft"],
      packing_option: [
        "12_dz_ctns",
        "20_dz_bag",
        "60_dz_bag",
        "20_dz_ctn",
        "6_dz_ctn",
      ],
      priority_level: ["low", "medium", "high", "critical"],
      purchase_category: [
        "raw_material",
        "office_supplies",
        "general_supplies",
        "spare_maintenance",
      ],
      qa_result: ["pass", "fail", "hold"],
      record_status: [
        "draft",
        "in_progress",
        "pending_approval",
        "approved",
        "rejected",
        "closed",
      ],
      sales_segment: ["private_label", "domestic", "export"],
      shift_type: ["morning", "afternoon", "night"],
    },
  },
} as const
