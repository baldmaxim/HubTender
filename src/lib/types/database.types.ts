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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      boq_items: {
        Row: {
          base_quantity: number | null
          boq_item_type: Database["public"]["Enums"]["boq_item_type"]
          client_position_id: string
          commercial_markup: number | null
          consumption_coefficient: number | null
          conversion_coefficient: number | null
          created_at: string
          currency_type: Database["public"]["Enums"]["currency_type"] | null
          delivery_amount: number | null
          delivery_price_type:
            | Database["public"]["Enums"]["delivery_price_type"]
            | null
          description: string | null
          detail_cost_category_id: string | null
          id: string
          import_session_id: string | null
          material_name_id: string | null
          material_type: Database["public"]["Enums"]["material_type"] | null
          parent_work_item_id: string | null
          quantity: number | null
          quote_link: string | null
          sort_number: number
          tender_id: string
          total_amount: number | null
          total_commercial_material_cost: number | null
          total_commercial_work_cost: number | null
          unit_code: string | null
          unit_rate: number | null
          updated_at: string
          work_name_id: string | null
        }
        Insert: {
          base_quantity?: number | null
          boq_item_type: Database["public"]["Enums"]["boq_item_type"]
          client_position_id: string
          commercial_markup?: number | null
          consumption_coefficient?: number | null
          conversion_coefficient?: number | null
          created_at?: string
          currency_type?: Database["public"]["Enums"]["currency_type"] | null
          delivery_amount?: number | null
          delivery_price_type?:
            | Database["public"]["Enums"]["delivery_price_type"]
            | null
          description?: string | null
          detail_cost_category_id?: string | null
          id?: string
          import_session_id?: string | null
          material_name_id?: string | null
          material_type?: Database["public"]["Enums"]["material_type"] | null
          parent_work_item_id?: string | null
          quantity?: number | null
          quote_link?: string | null
          sort_number?: number
          tender_id: string
          total_amount?: number | null
          total_commercial_material_cost?: number | null
          total_commercial_work_cost?: number | null
          unit_code?: string | null
          unit_rate?: number | null
          updated_at?: string
          work_name_id?: string | null
        }
        Update: {
          base_quantity?: number | null
          boq_item_type?: Database["public"]["Enums"]["boq_item_type"]
          client_position_id?: string
          commercial_markup?: number | null
          consumption_coefficient?: number | null
          conversion_coefficient?: number | null
          created_at?: string
          currency_type?: Database["public"]["Enums"]["currency_type"] | null
          delivery_amount?: number | null
          delivery_price_type?:
            | Database["public"]["Enums"]["delivery_price_type"]
            | null
          description?: string | null
          detail_cost_category_id?: string | null
          id?: string
          import_session_id?: string | null
          material_name_id?: string | null
          material_type?: Database["public"]["Enums"]["material_type"] | null
          parent_work_item_id?: string | null
          quantity?: number | null
          quote_link?: string | null
          sort_number?: number
          tender_id?: string
          total_amount?: number | null
          total_commercial_material_cost?: number | null
          total_commercial_work_cost?: number | null
          unit_code?: string | null
          unit_rate?: number | null
          updated_at?: string
          work_name_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_client_position_id_fkey"
            columns: ["client_position_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_detail_cost_category_id_fkey"
            columns: ["detail_cost_category_id"]
            isOneToOne: false
            referencedRelation: "detail_cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_import_session_id_fkey"
            columns: ["import_session_id"]
            isOneToOne: false
            referencedRelation: "import_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_material_name_id_fkey"
            columns: ["material_name_id"]
            isOneToOne: false
            referencedRelation: "material_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_parent_work_item_id_fkey"
            columns: ["parent_work_item_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_unit_code_fkey"
            columns: ["unit_code"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "boq_items_work_name_id_fkey"
            columns: ["work_name_id"]
            isOneToOne: false
            referencedRelation: "work_names"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_items_audit: {
        Row: {
          boq_item_id: string
          changed_at: string
          changed_by: string | null
          changed_fields: string[] | null
          id: string
          new_data: Json | null
          old_data: Json | null
          operation_type: string
        }
        Insert: {
          boq_item_id: string
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation_type: string
        }
        Update: {
          boq_item_id?: string
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_positions: {
        Row: {
          client_note: string | null
          created_at: string
          hierarchy_level: number | null
          id: string
          is_additional: boolean | null
          item_no: string | null
          manual_note: string | null
          manual_volume: number | null
          material_cost_per_unit: number | null
          parent_position_id: string | null
          position_number: number
          tender_id: string
          total_commercial_material: number | null
          total_commercial_material_per_unit: number | null
          total_commercial_work: number | null
          total_commercial_work_per_unit: number | null
          total_material: number | null
          total_works: number | null
          unit_code: string | null
          updated_at: string
          volume: number | null
          work_cost_per_unit: number | null
          work_name: string
        }
        Insert: {
          client_note?: string | null
          created_at?: string
          hierarchy_level?: number | null
          id?: string
          is_additional?: boolean | null
          item_no?: string | null
          manual_note?: string | null
          manual_volume?: number | null
          material_cost_per_unit?: number | null
          parent_position_id?: string | null
          position_number: number
          tender_id: string
          total_commercial_material?: number | null
          total_commercial_material_per_unit?: number | null
          total_commercial_work?: number | null
          total_commercial_work_per_unit?: number | null
          total_material?: number | null
          total_works?: number | null
          unit_code?: string | null
          updated_at?: string
          volume?: number | null
          work_cost_per_unit?: number | null
          work_name: string
        }
        Update: {
          client_note?: string | null
          created_at?: string
          hierarchy_level?: number | null
          id?: string
          is_additional?: boolean | null
          item_no?: string | null
          manual_note?: string | null
          manual_volume?: number | null
          material_cost_per_unit?: number | null
          parent_position_id?: string | null
          position_number?: number
          tender_id?: string
          total_commercial_material?: number | null
          total_commercial_material_per_unit?: number | null
          total_commercial_work?: number | null
          total_commercial_work_per_unit?: number | null
          total_material?: number | null
          total_works?: number | null
          unit_code?: string | null
          updated_at?: string
          volume?: number | null
          work_cost_per_unit?: number | null
          work_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_positions_parent_position_id_fkey"
            columns: ["parent_position_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_positions_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_positions_unit_code_fkey"
            columns: ["unit_code"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      comparison_notes: {
        Row: {
          cost_category_name: string
          created_at: string | null
          created_by: string | null
          detail_category_key: string | null
          id: string
          note: string
          tender_id_1: string
          tender_id_2: string
          updated_at: string | null
        }
        Insert: {
          cost_category_name: string
          created_at?: string | null
          created_by?: string | null
          detail_category_key?: string | null
          id?: string
          note?: string
          tender_id_1: string
          tender_id_2: string
          updated_at?: string | null
        }
        Update: {
          cost_category_name?: string
          created_at?: string | null
          created_by?: string | null
          detail_category_key?: string | null
          id?: string
          note?: string
          tender_id_1?: string
          tender_id_2?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comparison_notes_tender_id_1_fkey"
            columns: ["tender_id_1"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comparison_notes_tender_id_2_fkey"
            columns: ["tender_id_2"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_cost_volumes: {
        Row: {
          created_at: string | null
          detail_cost_category_id: string | null
          group_key: string | null
          id: string
          tender_id: string
          updated_at: string | null
          volume: number | null
        }
        Insert: {
          created_at?: string | null
          detail_cost_category_id?: string | null
          group_key?: string | null
          id?: string
          tender_id: string
          updated_at?: string | null
          volume?: number | null
        }
        Update: {
          created_at?: string | null
          detail_cost_category_id?: string | null
          group_key?: string | null
          id?: string
          tender_id?: string
          updated_at?: string | null
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_cost_volumes_detail_cost_category_id_fkey"
            columns: ["detail_cost_category_id"]
            isOneToOne: false
            referencedRelation: "detail_cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_cost_volumes_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_scopes: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      cost_categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_categories_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      cost_redistribution_results: {
        Row: {
          added_amount: number
          boq_item_id: string
          created_at: string
          created_by: string | null
          deducted_amount: number
          final_work_cost: number | null
          id: string
          markup_tactic_id: string
          original_work_cost: number | null
          redistribution_rules: Json | null
          tender_id: string
          updated_at: string
        }
        Insert: {
          added_amount?: number
          boq_item_id: string
          created_at?: string
          created_by?: string | null
          deducted_amount?: number
          final_work_cost?: number | null
          id?: string
          markup_tactic_id: string
          original_work_cost?: number | null
          redistribution_rules?: Json | null
          tender_id: string
          updated_at?: string
        }
        Update: {
          added_amount?: number
          boq_item_id?: string
          created_at?: string
          created_by?: string | null
          deducted_amount?: number
          final_work_cost?: number | null
          id?: string
          markup_tactic_id?: string
          original_work_cost?: number | null
          redistribution_rules?: Json | null
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_redistribution_results_boq_item_id_fkey"
            columns: ["boq_item_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_redistribution_results_markup_tactic_id_fkey"
            columns: ["markup_tactic_id"]
            isOneToOne: false
            referencedRelation: "markup_tactics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_redistribution_results_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      detail_cost_categories: {
        Row: {
          cost_category_id: string
          created_at: string | null
          id: string
          location: string
          name: string
          order_num: number | null
          unit: string
          updated_at: string | null
        }
        Insert: {
          cost_category_id: string
          created_at?: string | null
          id?: string
          location: string
          name: string
          order_num?: number | null
          unit: string
          updated_at?: string | null
        }
        Update: {
          cost_category_id?: string
          created_at?: string | null
          id?: string
          location?: string
          name?: string
          order_num?: number | null
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "detail_cost_categories_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detail_cost_categories_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      import_sessions: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          file_name: string | null
          id: string
          imported_at: string
          items_count: number
          positions_snapshot: Json | null
          tender_id: string | null
          user_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          file_name?: string | null
          id?: string
          imported_at?: string
          items_count?: number
          positions_snapshot?: Json | null
          tender_id?: string | null
          user_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          file_name?: string | null
          id?: string
          imported_at?: string
          items_count?: number
          positions_snapshot?: Json | null
          tender_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_sessions_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      library_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "library_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      markup_parameters: {
        Row: {
          created_at: string
          default_value: number
          id: string
          is_active: boolean
          key: string
          label: string
          order_num: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_value?: number
          id?: string
          is_active?: boolean
          key: string
          label: string
          order_num?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_value?: number
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          order_num?: number
          updated_at?: string
        }
        Relationships: []
      }
      markup_tactics: {
        Row: {
          base_costs: Json
          created_at: string | null
          id: string
          is_global: boolean | null
          name: string | null
          sequences: Json
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          base_costs?: Json
          created_at?: string | null
          id?: string
          is_global?: boolean | null
          name?: string | null
          sequences?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          base_costs?: Json
          created_at?: string | null
          id?: string
          is_global?: boolean | null
          name?: string | null
          sequences?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      material_names: {
        Row: {
          created_at: string | null
          id: string
          name: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_names_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      materials_library: {
        Row: {
          consumption_coefficient: number | null
          created_at: string | null
          currency_type: Database["public"]["Enums"]["currency_type"]
          delivery_amount: number | null
          delivery_price_type: Database["public"]["Enums"]["delivery_price_type"]
          folder_id: string | null
          id: string
          item_type: Database["public"]["Enums"]["boq_item_type"]
          material_name_id: string
          material_type: Database["public"]["Enums"]["material_type"]
          unit_rate: number
          updated_at: string | null
        }
        Insert: {
          consumption_coefficient?: number | null
          created_at?: string | null
          currency_type?: Database["public"]["Enums"]["currency_type"]
          delivery_amount?: number | null
          delivery_price_type?: Database["public"]["Enums"]["delivery_price_type"]
          folder_id?: string | null
          id?: string
          item_type: Database["public"]["Enums"]["boq_item_type"]
          material_name_id: string
          material_type: Database["public"]["Enums"]["material_type"]
          unit_rate: number
          updated_at?: string | null
        }
        Update: {
          consumption_coefficient?: number | null
          created_at?: string | null
          currency_type?: Database["public"]["Enums"]["currency_type"]
          delivery_amount?: number | null
          delivery_price_type?: Database["public"]["Enums"]["delivery_price_type"]
          folder_id?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["boq_item_type"]
          material_name_id?: string
          material_type?: Database["public"]["Enums"]["material_type"]
          unit_rate?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_library_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "library_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_library_material_name_id_fkey"
            columns: ["material_name_id"]
            isOneToOne: false
            referencedRelation: "material_names"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          related_entity_id: string | null
          related_entity_type: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          title: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      project_additional_agreements: {
        Row: {
          agreement_date: string
          agreement_number: string | null
          amount: number
          created_at: string
          description: string | null
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          agreement_date: string
          agreement_number?: string | null
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          agreement_date?: string
          agreement_number?: string | null
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_additional_agreements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_monthly_completion: {
        Row: {
          actual_amount: number
          created_at: string
          forecast_amount: number | null
          id: string
          month: number
          note: string | null
          project_id: string
          updated_at: string
          year: number
        }
        Insert: {
          actual_amount?: number
          created_at?: string
          forecast_amount?: number | null
          id?: string
          month: number
          note?: string | null
          project_id: string
          updated_at?: string
          year: number
        }
        Update: {
          actual_amount?: number
          created_at?: string
          forecast_amount?: number | null
          id?: string
          month?: number
          note?: string | null
          project_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_monthly_completion_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          area: number | null
          client_name: string
          construction_end_date: string | null
          contract_cost: number
          contract_date: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          tender_id: string | null
          updated_at: string
        }
        Insert: {
          area?: number | null
          client_name: string
          construction_end_date?: string | null
          contract_cost?: number
          contract_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          tender_id?: string | null
          updated_at?: string
        }
        Update: {
          area?: number | null
          client_name?: string
          construction_end_date?: string | null
          contract_cost?: number
          contract_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tender_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          allowed_pages: Json
          code: string
          color: string | null
          created_at: string
          is_system_role: boolean
          name: string
          updated_at: string
        }
        Insert: {
          allowed_pages?: Json
          code: string
          color?: string | null
          created_at?: string
          is_system_role?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          allowed_pages?: Json
          code?: string
          color?: string | null
          created_at?: string
          is_system_role?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      subcontract_growth_exclusions: {
        Row: {
          created_at: string | null
          detail_cost_category_id: string
          exclusion_type: string
          id: string
          tender_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          detail_cost_category_id: string
          exclusion_type?: string
          id?: string
          tender_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          detail_cost_category_id?: string
          exclusion_type?: string
          id?: string
          tender_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subcontract_growth_exclusions_detail_cost_category_id_fkey"
            columns: ["detail_cost_category_id"]
            isOneToOne: false
            referencedRelation: "detail_cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcontract_growth_exclusions_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      template_items: {
        Row: {
          conversation_coeff: number | null
          created_at: string
          detail_cost_category_id: string | null
          id: string
          kind: string
          material_library_id: string | null
          note: string | null
          parent_work_item_id: string | null
          position: number
          template_id: string
          updated_at: string
          work_library_id: string | null
        }
        Insert: {
          conversation_coeff?: number | null
          created_at?: string
          detail_cost_category_id?: string | null
          id?: string
          kind: string
          material_library_id?: string | null
          note?: string | null
          parent_work_item_id?: string | null
          position?: number
          template_id: string
          updated_at?: string
          work_library_id?: string | null
        }
        Update: {
          conversation_coeff?: number | null
          created_at?: string
          detail_cost_category_id?: string | null
          id?: string
          kind?: string
          material_library_id?: string | null
          note?: string | null
          parent_work_item_id?: string | null
          position?: number
          template_id?: string
          updated_at?: string
          work_library_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_items_detail_cost_category_fk"
            columns: ["detail_cost_category_id"]
            isOneToOne: false
            referencedRelation: "detail_cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_material_library_fk"
            columns: ["material_library_id"]
            isOneToOne: false
            referencedRelation: "materials_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_material_library_fk"
            columns: ["material_library_id"]
            isOneToOne: false
            referencedRelation: "materials_library_full_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_parent_work_item_fk"
            columns: ["parent_work_item_id"]
            isOneToOne: false
            referencedRelation: "template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_template_fk"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_work_library_fk"
            columns: ["work_library_id"]
            isOneToOne: false
            referencedRelation: "works_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_work_library_fk"
            columns: ["work_library_id"]
            isOneToOne: false
            referencedRelation: "works_library_full_view"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          detail_cost_category_id: string
          folder_id: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          detail_cost_category_id: string
          folder_id?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          detail_cost_category_id?: string
          folder_id?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "templates_detail_cost_category_fk"
            columns: ["detail_cost_category_id"]
            isOneToOne: false
            referencedRelation: "detail_cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "library_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_documents: {
        Row: {
          content_markdown: string
          created_at: string | null
          file_size: number | null
          id: string
          original_filename: string | null
          section_type: string
          tender_id: string
          title: string
          updated_at: string | null
          upload_date: string | null
        }
        Insert: {
          content_markdown: string
          created_at?: string | null
          file_size?: number | null
          id?: string
          original_filename?: string | null
          section_type: string
          tender_id: string
          title: string
          updated_at?: string | null
          upload_date?: string | null
        }
        Update: {
          content_markdown?: string
          created_at?: string | null
          file_size?: number | null
          id?: string
          original_filename?: string | null
          section_type?: string
          tender_id?: string
          title?: string
          updated_at?: string | null
          upload_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_documents_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "tender_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_groups: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          quality_comment: string | null
          quality_level: number | null
          quality_updated_at: string | null
          quality_updated_by: string | null
          sort_order: number
          tender_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          quality_comment?: string | null
          quality_level?: number | null
          quality_updated_at?: string | null
          quality_updated_by?: string | null
          sort_order?: number
          tender_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          quality_comment?: string | null
          quality_level?: number | null
          quality_updated_at?: string | null
          quality_updated_by?: string | null
          sort_order?: number
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_groups_quality_updated_by_fkey"
            columns: ["quality_updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_groups_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_insurance: {
        Row: {
          apt_area: number
          apt_price_m2: number
          created_at: string | null
          id: string
          judicial_pct: number
          parking_area: number
          parking_price_m2: number
          storage_area: number
          storage_price_m2: number
          tender_id: string
          total_pct: number
          updated_at: string | null
        }
        Insert: {
          apt_area?: number
          apt_price_m2?: number
          created_at?: string | null
          id?: string
          judicial_pct?: number
          parking_area?: number
          parking_price_m2?: number
          storage_area?: number
          storage_price_m2?: number
          tender_id: string
          total_pct?: number
          updated_at?: string | null
        }
        Update: {
          apt_area?: number
          apt_price_m2?: number
          created_at?: string | null
          id?: string
          judicial_pct?: number
          parking_area?: number
          parking_price_m2?: number
          storage_area?: number
          storage_price_m2?: number
          tender_id?: string
          total_pct?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_insurance_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: true
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_iterations: {
        Row: {
          approval_status: string
          created_at: string
          group_id: string
          id: string
          iteration_number: number
          manager_comment: string | null
          manager_id: string | null
          manager_responded_at: string | null
          submitted_at: string
          updated_at: string
          user_amount: number | null
          user_comment: string
          user_id: string
        }
        Insert: {
          approval_status?: string
          created_at?: string
          group_id: string
          id?: string
          iteration_number: number
          manager_comment?: string | null
          manager_id?: string | null
          manager_responded_at?: string | null
          submitted_at?: string
          updated_at?: string
          user_amount?: number | null
          user_comment: string
          user_id: string
        }
        Update: {
          approval_status?: string
          created_at?: string
          group_id?: string
          id?: string
          iteration_number?: number
          manager_comment?: string | null
          manager_id?: string | null
          manager_responded_at?: string | null
          submitted_at?: string
          updated_at?: string
          user_amount?: number | null
          user_comment?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_iterations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "tender_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_iterations_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_iterations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_markup_percentage: {
        Row: {
          created_at: string
          id: string
          markup_parameter_id: string
          tender_id: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          markup_parameter_id: string
          tender_id: string
          updated_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          markup_parameter_id?: string
          tender_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "tender_markup_percentage_markup_parameter_id_fkey"
            columns: ["markup_parameter_id"]
            isOneToOne: false
            referencedRelation: "markup_parameters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_markup_percentage_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_notes: {
        Row: {
          created_at: string
          id: string
          note_text: string
          tender_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note_text?: string
          tender_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note_text?: string
          tender_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_notes_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_pricing_distribution: {
        Row: {
          auxiliary_material_base_target: string
          auxiliary_material_markup_target: string
          basic_material_base_target: string
          basic_material_markup_target: string
          component_material_base_target: string
          component_material_markup_target: string
          component_work_base_target: string
          component_work_markup_target: string
          created_at: string
          id: string
          markup_tactic_id: string | null
          subcontract_auxiliary_material_base_target: string
          subcontract_auxiliary_material_markup_target: string
          subcontract_basic_material_base_target: string
          subcontract_basic_material_markup_target: string
          tender_id: string
          updated_at: string
          work_base_target: string
          work_markup_target: string
        }
        Insert: {
          auxiliary_material_base_target?: string
          auxiliary_material_markup_target?: string
          basic_material_base_target?: string
          basic_material_markup_target?: string
          component_material_base_target?: string
          component_material_markup_target?: string
          component_work_base_target?: string
          component_work_markup_target?: string
          created_at?: string
          id?: string
          markup_tactic_id?: string | null
          subcontract_auxiliary_material_base_target?: string
          subcontract_auxiliary_material_markup_target?: string
          subcontract_basic_material_base_target?: string
          subcontract_basic_material_markup_target?: string
          tender_id: string
          updated_at?: string
          work_base_target?: string
          work_markup_target?: string
        }
        Update: {
          auxiliary_material_base_target?: string
          auxiliary_material_markup_target?: string
          basic_material_base_target?: string
          basic_material_markup_target?: string
          component_material_base_target?: string
          component_material_markup_target?: string
          component_work_base_target?: string
          component_work_markup_target?: string
          created_at?: string
          id?: string
          markup_tactic_id?: string | null
          subcontract_auxiliary_material_base_target?: string
          subcontract_auxiliary_material_markup_target?: string
          subcontract_basic_material_base_target?: string
          subcontract_basic_material_markup_target?: string
          tender_id?: string
          updated_at?: string
          work_base_target?: string
          work_markup_target?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_pricing_distribution_markup_tactic_id_fkey"
            columns: ["markup_tactic_id"]
            isOneToOne: false
            referencedRelation: "markup_tactics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_pricing_distribution_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_registry: {
        Row: {
          area: number | null
          chronology: string | null
          chronology_items: Json | null
          client_name: string
          commission_date: string | null
          construction_scope_id: string | null
          construction_start_date: string | null
          created_at: string | null
          created_by: string | null
          dashboard_status: string | null
          has_tender_package: string | null
          id: string
          invitation_date: string | null
          is_archived: boolean
          manual_total_cost: number | null
          object_address: string | null
          object_coordinates: string | null
          site_visit_date: string | null
          site_visit_photo_url: string | null
          sort_order: number
          status_id: string | null
          submission_date: string | null
          tender_number: string | null
          tender_package_items: Json | null
          title: string
          updated_at: string | null
        }
        Insert: {
          area?: number | null
          chronology?: string | null
          chronology_items?: Json | null
          client_name: string
          commission_date?: string | null
          construction_scope_id?: string | null
          construction_start_date?: string | null
          created_at?: string | null
          created_by?: string | null
          dashboard_status?: string | null
          has_tender_package?: string | null
          id?: string
          invitation_date?: string | null
          is_archived?: boolean
          manual_total_cost?: number | null
          object_address?: string | null
          object_coordinates?: string | null
          site_visit_date?: string | null
          site_visit_photo_url?: string | null
          sort_order: number
          status_id?: string | null
          submission_date?: string | null
          tender_number?: string | null
          tender_package_items?: Json | null
          title: string
          updated_at?: string | null
        }
        Update: {
          area?: number | null
          chronology?: string | null
          chronology_items?: Json | null
          client_name?: string
          commission_date?: string | null
          construction_scope_id?: string | null
          construction_start_date?: string | null
          created_at?: string | null
          created_by?: string | null
          dashboard_status?: string | null
          has_tender_package?: string | null
          id?: string
          invitation_date?: string | null
          is_archived?: boolean
          manual_total_cost?: number | null
          object_address?: string | null
          object_coordinates?: string | null
          site_visit_date?: string | null
          site_visit_photo_url?: string | null
          sort_order?: number
          status_id?: string | null
          submission_date?: string | null
          tender_number?: string | null
          tender_package_items?: Json | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_registry_construction_scope_id_fkey"
            columns: ["construction_scope_id"]
            isOneToOne: false
            referencedRelation: "construction_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_registry_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "tender_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_statuses: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      tenders: {
        Row: {
          apply_subcontract_materials_growth: boolean | null
          apply_subcontract_works_growth: boolean | null
          area_client: number | null
          area_sp: number | null
          bsm_link: string | null
          cached_grand_total: number
          client_name: string
          cny_rate: number | null
          construction_scope:
            | Database["public"]["Enums"]["construction_scope_type"]
            | null
          created_at: string | null
          created_by: string | null
          description: string | null
          eur_rate: number | null
          housing_class:
            | Database["public"]["Enums"]["housing_class_type"]
            | null
          id: string
          is_archived: boolean
          markup_tactic_id: string | null
          project_folder_link: string | null
          qa_form_link: string | null
          submission_deadline: string | null
          tender_number: string
          title: string
          tz_link: string | null
          updated_at: string | null
          upload_folder: string | null
          usd_rate: number | null
          version: number | null
          volume_title: string | null
        }
        Insert: {
          apply_subcontract_materials_growth?: boolean | null
          apply_subcontract_works_growth?: boolean | null
          area_client?: number | null
          area_sp?: number | null
          bsm_link?: string | null
          cached_grand_total?: number
          client_name: string
          cny_rate?: number | null
          construction_scope?:
            | Database["public"]["Enums"]["construction_scope_type"]
            | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          eur_rate?: number | null
          housing_class?:
            | Database["public"]["Enums"]["housing_class_type"]
            | null
          id?: string
          is_archived?: boolean
          markup_tactic_id?: string | null
          project_folder_link?: string | null
          qa_form_link?: string | null
          submission_deadline?: string | null
          tender_number: string
          title: string
          tz_link?: string | null
          updated_at?: string | null
          upload_folder?: string | null
          usd_rate?: number | null
          version?: number | null
          volume_title?: string | null
        }
        Update: {
          apply_subcontract_materials_growth?: boolean | null
          apply_subcontract_works_growth?: boolean | null
          area_client?: number | null
          area_sp?: number | null
          bsm_link?: string | null
          cached_grand_total?: number
          client_name?: string
          cny_rate?: number | null
          construction_scope?:
            | Database["public"]["Enums"]["construction_scope_type"]
            | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          eur_rate?: number | null
          housing_class?:
            | Database["public"]["Enums"]["housing_class_type"]
            | null
          id?: string
          is_archived?: boolean
          markup_tactic_id?: string | null
          project_folder_link?: string | null
          qa_form_link?: string | null
          submission_deadline?: string | null
          tender_number?: string
          title?: string
          tz_link?: string | null
          updated_at?: string | null
          upload_folder?: string | null
          usd_rate?: number | null
          version?: number | null
          volume_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenders_markup_tactic_id_fkey"
            columns: ["markup_tactic_id"]
            isOneToOne: false
            referencedRelation: "markup_tactics"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          description: string | null
          is_active: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_position_filters: {
        Row: {
          created_at: string | null
          id: string
          position_id: string
          tender_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          position_id: string
          tender_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          position_id?: string
          tender_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_position_filters_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_position_filters_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_position_filters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          description: string
          id: string
          task_status: Database["public"]["Enums"]["task_status"] | null
          tender_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          description: string
          id?: string
          task_status?: Database["public"]["Enums"]["task_status"] | null
          tender_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          description?: string
          id?: string
          task_status?: Database["public"]["Enums"]["task_status"] | null
          tender_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tasks_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          access_enabled: boolean | null
          access_status: Database["public"]["Enums"]["access_status_type"]
          allowed_pages: Json | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          current_work_mode: Database["public"]["Enums"]["work_mode"] | null
          current_work_status: Database["public"]["Enums"]["work_status"] | null
          email: string
          full_name: string
          id: string
          registration_date: string
          role_code: string
          tender_deadline_extensions: Json | null
          updated_at: string
        }
        Insert: {
          access_enabled?: boolean | null
          access_status?: Database["public"]["Enums"]["access_status_type"]
          allowed_pages?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_work_mode?: Database["public"]["Enums"]["work_mode"] | null
          current_work_status?:
            | Database["public"]["Enums"]["work_status"]
            | null
          email: string
          full_name: string
          id: string
          registration_date?: string
          role_code: string
          tender_deadline_extensions?: Json | null
          updated_at?: string
        }
        Update: {
          access_enabled?: boolean | null
          access_status?: Database["public"]["Enums"]["access_status_type"]
          allowed_pages?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_work_mode?: Database["public"]["Enums"]["work_mode"] | null
          current_work_status?:
            | Database["public"]["Enums"]["work_status"]
            | null
          email?: string
          full_name?: string
          id?: string
          registration_date?: string
          role_code?: string
          tender_deadline_extensions?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      work_names: {
        Row: {
          created_at: string | null
          id: string
          name: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_names_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      works_library: {
        Row: {
          created_at: string | null
          currency_type: Database["public"]["Enums"]["currency_type"]
          folder_id: string | null
          id: string
          item_type: Database["public"]["Enums"]["boq_item_type"]
          unit_rate: number
          updated_at: string | null
          work_name_id: string
        }
        Insert: {
          created_at?: string | null
          currency_type?: Database["public"]["Enums"]["currency_type"]
          folder_id?: string | null
          id?: string
          item_type: Database["public"]["Enums"]["boq_item_type"]
          unit_rate: number
          updated_at?: string | null
          work_name_id: string
        }
        Update: {
          created_at?: string | null
          currency_type?: Database["public"]["Enums"]["currency_type"]
          folder_id?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["boq_item_type"]
          unit_rate?: number
          updated_at?: string | null
          work_name_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "works_library_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "library_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "works_library_work_name_id_fkey"
            columns: ["work_name_id"]
            isOneToOne: false
            referencedRelation: "work_names"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      materials_library_full_view: {
        Row: {
          consumption_coefficient: number | null
          created_at: string | null
          currency_type: Database["public"]["Enums"]["currency_type"] | null
          delivery_amount: number | null
          delivery_price_type:
            | Database["public"]["Enums"]["delivery_price_type"]
            | null
          id: string | null
          item_type: Database["public"]["Enums"]["boq_item_type"] | null
          material_name: string | null
          material_type: Database["public"]["Enums"]["material_type"] | null
          unit: string | null
          unit_rate: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_names_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      works_library_full_view: {
        Row: {
          created_at: string | null
          currency_type: Database["public"]["Enums"]["currency_type"] | null
          id: string | null
          item_type: Database["public"]["Enums"]["boq_item_type"] | null
          unit: string | null
          unit_rate: number | null
          updated_at: string | null
          work_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_names_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Functions: {
      add_subcontract_growth_exclusion: {
        Args: {
          p_detail_cost_category_id: string
          p_exclusion_type?: string
          p_tender_id: string
        }
        Returns: string
      }
      bulk_import_client_position_boq: {
        Args: {
          p_file_name: string
          p_items?: Json
          p_position_updates?: Json
          p_tender_id: string
          p_user_id: string
        }
        Returns: Json
      }
      bulk_update_boq_items_commercial_costs: {
        Args: { p_rows: Json }
        Returns: number
      }
      check_user_page_access: {
        Args: { page_url: string; user_id: string }
        Returns: boolean
      }
      clear_audit_user: { Args: never; Returns: undefined }
      current_user_role: { Args: never; Returns: string }
      current_user_status: {
        Args: never
        Returns: Database["public"]["Enums"]["access_status_type"]
      }
      delete_boq_item_with_audit: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: Json
      }
      execute_version_transfer: {
        Args: {
          p_matches?: Json
          p_new_positions: Json
          p_source_tender_id: string
        }
        Returns: Json
      }
      get_positions_with_costs: {
        Args: { p_tender_id: string }
        Returns: {
          base_total: number
          client_note: string
          commercial_total: number
          created_at: string
          hierarchy_level: number
          id: string
          is_additional: boolean
          item_no: string
          items_count: number
          manual_note: string
          manual_volume: number
          markup_percentage: number
          material_cost_per_unit: number
          material_cost_total: number
          parent_position_id: string
          position_number: number
          tender_id: string
          total_commercial_material: number
          total_commercial_material_per_unit: number
          total_commercial_work: number
          total_commercial_work_per_unit: number
          total_material: number
          total_works: number
          unit_code: string
          updated_at: string
          volume: number
          work_cost_per_unit: number
          work_cost_total: number
          work_name: string
        }[]
      }
      get_subcontract_growth_exclusions: {
        Args: { p_tender_id: string }
        Returns: {
          detail_cost_category_id: string
          exclusion_type: string
        }[]
      }
      insert_boq_item_with_audit: {
        Args: { p_data: Json; p_user_id: string }
        Returns: Json
      }
      is_tender_timeline_privileged: { Args: never; Returns: boolean }
      recalculate_tender_grand_total: {
        Args: { p_tender_id: string }
        Returns: undefined
      }
      register_user: {
        Args: {
          p_allowed_pages: Json
          p_email: string
          p_full_name: string
          p_role_code: string
          p_user_id: string
        }
        Returns: undefined
      }
      remove_subcontract_growth_exclusion: {
        Args: {
          p_detail_cost_category_id: string
          p_exclusion_type?: string
          p_tender_id: string
        }
        Returns: boolean
      }
      respond_tender_iteration: {
        Args: {
          p_approval_status: string
          p_iteration_id: string
          p_manager_comment: string
        }
        Returns: {
          approval_status: string
          created_at: string
          group_id: string
          id: string
          iteration_number: number
          manager_comment: string | null
          manager_id: string | null
          manager_responded_at: string | null
          submitted_at: string
          updated_at: string
          user_amount: number | null
          user_comment: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "tender_iterations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_audit_user: { Args: { user_id: string }; Returns: undefined }
      set_tender_group_quality: {
        Args: {
          p_group_id: string
          p_quality_comment?: string
          p_quality_level: number
        }
        Returns: {
          color: string
          created_at: string
          id: string
          name: string
          quality_comment: string | null
          quality_level: number | null
          quality_updated_at: string | null
          quality_updated_by: string | null
          sort_order: number
          tender_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tender_groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      toggle_subcontract_growth_exclusion: {
        Args: {
          p_detail_cost_category_id: string
          p_exclusion_type?: string
          p_tender_id: string
        }
        Returns: boolean
      }
      update_boq_item_with_audit: {
        Args: { p_data: Json; p_item_id: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      access_status_type: "pending" | "approved" | "blocked"
      boq_item_type:
        | "мат"
        | "суб-мат"
        | "мат-комп."
        | "раб"
        | "суб-раб"
        | "раб-комп."
      construction_scope_type: "генподряд" | "коробка" | "монолит"
      currency_type: "RUB" | "USD" | "EUR" | "CNY"
      delivery_price_type: "в цене" | "не в цене" | "суммой"
      housing_class_type: "комфорт" | "бизнес" | "премиум" | "делюкс"
      material_type: "основн." | "вспомогат."
      task_status: "running" | "paused" | "completed"
      user_role_type:
        | "Руководитель"
        | "Администратор"
        | "Разработчик"
        | "Старший группы"
        | "Инженер"
      work_mode: "office" | "remote"
      work_status: "working" | "not_working"
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
      access_status_type: ["pending", "approved", "blocked"],
      boq_item_type: [
        "мат",
        "суб-мат",
        "мат-комп.",
        "раб",
        "суб-раб",
        "раб-комп.",
      ],
      construction_scope_type: ["генподряд", "коробка", "монолит"],
      currency_type: ["RUB", "USD", "EUR", "CNY"],
      delivery_price_type: ["в цене", "не в цене", "суммой"],
      housing_class_type: ["комфорт", "бизнес", "премиум", "делюкс"],
      material_type: ["основн.", "вспомогат."],
      task_status: ["running", "paused", "completed"],
      user_role_type: [
        "Руководитель",
        "Администратор",
        "Разработчик",
        "Старший группы",
        "Инженер",
      ],
      work_mode: ["office", "remote"],
      work_status: ["working", "not_working"],
    },
  },
} as const
