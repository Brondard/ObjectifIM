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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      checklist_items: {
        Row: {
          _field_ts: Json
          _rev: number
          checked_at: string | null
          checklist_id: string
          created_at: string
          deleted_at: string | null
          id: string
          label: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          checked_at?: string | null
          checklist_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          checked_at?: string | null
          checklist_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_checklist_id_user_id_fkey"
            columns: ["checklist_id", "user_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      checklists: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          id: string
          is_template: boolean
          name: string
          race_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_template?: boolean
          name: string
          race_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_template?: boolean
          name?: string
          race_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_race_id_user_id_fkey"
            columns: ["race_id", "user_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      completed_sessions: {
        Row: {
          _field_ts: Json
          _rev: number
          analysis: Json | null
          avg_cadence: number | null
          avg_hr: number | null
          avg_power: number | null
          avg_speed_mps: number | null
          comment: string | null
          created_at: string
          deleted_at: string | null
          discipline: string
          distance_m: number | null
          elapsed_s: number | null
          elevation_gain_m: number | null
          equipment_id: string | null
          feeling: string | null
          hr_reliable: boolean | null
          id: string
          local_date: string
          match_status: string
          max_hr: number | null
          moving_s: number | null
          name: string | null
          np_power: number | null
          planned_session_id: string | null
          relative_effort: number | null
          rpe: number | null
          source: string
          sport_type: string | null
          started_at: string | null
          strava_activity_id: number | null
          streams_path: string | null
          updated_at: string
          user_id: string
          weather: Json | null
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          analysis?: Json | null
          avg_cadence?: number | null
          avg_hr?: number | null
          avg_power?: number | null
          avg_speed_mps?: number | null
          comment?: string | null
          created_at?: string
          deleted_at?: string | null
          discipline: string
          distance_m?: number | null
          elapsed_s?: number | null
          elevation_gain_m?: number | null
          equipment_id?: string | null
          feeling?: string | null
          hr_reliable?: boolean | null
          id?: string
          local_date: string
          match_status?: string
          max_hr?: number | null
          moving_s?: number | null
          name?: string | null
          np_power?: number | null
          planned_session_id?: string | null
          relative_effort?: number | null
          rpe?: number | null
          source?: string
          sport_type?: string | null
          started_at?: string | null
          strava_activity_id?: number | null
          streams_path?: string | null
          updated_at?: string
          user_id?: string
          weather?: Json | null
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          analysis?: Json | null
          avg_cadence?: number | null
          avg_hr?: number | null
          avg_power?: number | null
          avg_speed_mps?: number | null
          comment?: string | null
          created_at?: string
          deleted_at?: string | null
          discipline?: string
          distance_m?: number | null
          elapsed_s?: number | null
          elevation_gain_m?: number | null
          equipment_id?: string | null
          feeling?: string | null
          hr_reliable?: boolean | null
          id?: string
          local_date?: string
          match_status?: string
          max_hr?: number | null
          moving_s?: number | null
          name?: string | null
          np_power?: number | null
          planned_session_id?: string | null
          relative_effort?: number | null
          rpe?: number | null
          source?: string
          sport_type?: string | null
          started_at?: string | null
          strava_activity_id?: number | null
          streams_path?: string | null
          updated_at?: string
          user_id?: string
          weather?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "completed_sessions_equipment_id_user_id_fkey"
            columns: ["equipment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "completed_sessions_equipment_id_user_id_fkey"
            columns: ["equipment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_usage"
            referencedColumns: ["equipment_id", "user_id"]
          },
          {
            foreignKeyName: "completed_sessions_planned_session_id_user_id_fkey"
            columns: ["planned_session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "planned_sessions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          _field_ts: Json
          _rev: number
          created_at: string
          date: string
          deleted_at: string | null
          freshness: number | null
          hr_rest: number | null
          id: string
          mood: number | null
          motivation: number | null
          note: string | null
          sleep_h: number | null
          sleep_quality: number | null
          soreness: number | null
          sources: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          created_at?: string
          date: string
          deleted_at?: string | null
          freshness?: number | null
          hr_rest?: number | null
          id?: string
          mood?: number | null
          motivation?: number | null
          note?: string | null
          sleep_h?: number | null
          sleep_quality?: number | null
          soreness?: number | null
          sources?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          created_at?: string
          date?: string
          deleted_at?: string | null
          freshness?: number | null
          hr_rest?: number | null
          id?: string
          mood?: number | null
          motivation?: number | null
          note?: string | null
          sleep_h?: number | null
          sleep_quality?: number | null
          soreness?: number | null
          sources?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      engine_rules: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          description: string | null
          enabled: boolean
          id: string
          kind: string
          params: Json
          rule_key: string
          updated_at: string
          user_id: string
          weight: number
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          kind: string
          params?: Json
          rule_key: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          kind?: string
          params?: Json
          rule_key?: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: []
      }
      equipment: {
        Row: {
          _rev: number
          alert_km: number | null
          brand: string | null
          created_at: string
          default_for_discipline: string | null
          deleted_at: string | null
          id: string
          initial_km: number
          kind: string
          name: string
          purchased_on: string | null
          retired_on: string | null
          strava_gear_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          alert_km?: number | null
          brand?: string | null
          created_at?: string
          default_for_discipline?: string | null
          deleted_at?: string | null
          id?: string
          initial_km?: number
          kind: string
          name: string
          purchased_on?: string | null
          retired_on?: string | null
          strava_gear_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          alert_km?: number | null
          brand?: string | null
          created_at?: string
          default_for_discipline?: string | null
          deleted_at?: string | null
          id?: string
          initial_km?: number
          kind?: string
          name?: string
          purchased_on?: string | null
          retired_on?: string | null
          strava_gear_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      equipment_maintenance: {
        Row: {
          _rev: number
          at_km: number | null
          component: string
          created_at: string
          deleted_at: string | null
          done_on: string
          equipment_id: string
          id: string
          interval_km: number | null
          note: string | null
          photo_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          at_km?: number | null
          component: string
          created_at?: string
          deleted_at?: string | null
          done_on: string
          equipment_id: string
          id?: string
          interval_km?: number | null
          note?: string | null
          photo_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          at_km?: number | null
          component?: string
          created_at?: string
          deleted_at?: string | null
          done_on?: string
          equipment_id?: string
          id?: string
          interval_km?: number | null
          note?: string | null
          photo_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_maintenance_equipment_id_user_id_fkey"
            columns: ["equipment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "equipment_maintenance_equipment_id_user_id_fkey"
            columns: ["equipment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "v_equipment_usage"
            referencedColumns: ["equipment_id", "user_id"]
          },
        ]
      }
      import_batches: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          file_sha256: string | null
          format_version: string
          id: string
          kind: string
          payload: Json | null
          period_end: string
          period_start: string
          phase_id: string | null
          summary: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          file_sha256?: string | null
          format_version: string
          id?: string
          kind: string
          payload?: Json | null
          period_end: string
          period_start: string
          phase_id?: string | null
          summary?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          file_sha256?: string | null
          format_version?: string
          id?: string
          kind?: string
          payload?: Json | null
          period_end?: string
          period_start?: string
          phase_id?: string | null
          summary?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_phase_id_user_id_fkey"
            columns: ["phase_id", "user_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      metrics: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          measured_on: string
          note: string | null
          source: string
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          measured_on: string
          note?: string | null
          source?: string
          updated_at?: string
          user_id?: string
          value: number
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          measured_on?: string
          note?: string | null
          source?: string
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      niggle_entries: {
        Row: {
          _field_ts: Json
          _rev: number
          created_at: string
          date: string
          deleted_at: string | null
          id: string
          intensity: number
          niggle_id: string
          note: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          created_at?: string
          date: string
          deleted_at?: string | null
          id?: string
          intensity: number
          niggle_id: string
          note?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          created_at?: string
          date?: string
          deleted_at?: string | null
          id?: string
          intensity?: number
          niggle_id?: string
          note?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "niggle_entries_niggle_id_user_id_fkey"
            columns: ["niggle_id", "user_id"]
            isOneToOne: false
            referencedRelation: "niggles"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      niggles: {
        Row: {
          _field_ts: Json
          _rev: number
          body_zone: string
          context: string | null
          created_at: string
          deleted_at: string | null
          id: string
          resolved_on: string | null
          side: string
          started_on: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          body_zone: string
          context?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          resolved_on?: string | null
          side: string
          started_on: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          body_zone?: string
          context?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          resolved_on?: string | null
          side?: string
          started_on?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_products: {
        Row: {
          _rev: number
          brand: string | null
          caffeine_mg: number | null
          carbs_g: number | null
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          name: string
          sodium_mg: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          brand?: string | null
          caffeine_mg?: number | null
          carbs_g?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          name: string
          sodium_mg?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          brand?: string | null
          caffeine_mg?: number | null
          carbs_g?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          name?: string
          sodium_mg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_protocols: {
        Row: {
          _rev: number
          carbs_per_h: number
          context: string | null
          created_at: string
          deleted_at: string | null
          id: string
          items: Json
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          carbs_per_h: number
          context?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          items?: Json
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          carbs_per_h?: number
          context?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          items?: Json
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      phases: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          end_date: string
          engine_params: Json
          id: string
          name: string
          season_id: string
          start_date: string
          targets: Json
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          end_date: string
          engine_params?: Json
          id?: string
          name: string
          season_id: string
          start_date: string
          targets?: Json
          type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          end_date?: string
          engine_params?: Json
          id?: string
          name?: string
          season_id?: string
          start_date?: string
          targets?: Json
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_season_id_user_id_fkey"
            columns: ["season_id", "user_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      plan_changes: {
        Row: {
          _rev: number
          affected: Json
          chosen_option: string | null
          created_at: string
          deleted_at: string | null
          engine_version: string | null
          id: string
          input: Json
          occurred_at: string
          options: Json
          reason: string | null
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          affected?: Json
          chosen_option?: string | null
          created_at?: string
          deleted_at?: string | null
          engine_version?: string | null
          id?: string
          input?: Json
          occurred_at?: string
          options?: Json
          reason?: string | null
          trigger: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          affected?: Json
          chosen_option?: string | null
          created_at?: string
          deleted_at?: string | null
          engine_version?: string | null
          id?: string
          input?: Json
          occurred_at?: string
          options?: Json
          reason?: string | null
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      planned_sessions: {
        Row: {
          _field_ts: Json
          _rev: number
          created_at: string
          date: string
          deleted_at: string | null
          discipline: string
          id: string
          import_batch_id: string | null
          import_key: string | null
          indoor: boolean
          instructions: string | null
          local_time: string | null
          original_date: string | null
          priority: string
          session_type: string
          skip_note: string | null
          source: string
          status: string
          structure: Json | null
          target_distance_m: number | null
          target_duration_s: number | null
          target_intensity: Json | null
          template_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          created_at?: string
          date: string
          deleted_at?: string | null
          discipline: string
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          indoor?: boolean
          instructions?: string | null
          local_time?: string | null
          original_date?: string | null
          priority?: string
          session_type: string
          skip_note?: string | null
          source?: string
          status?: string
          structure?: Json | null
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_intensity?: Json | null
          template_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          created_at?: string
          date?: string
          deleted_at?: string | null
          discipline?: string
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          indoor?: boolean
          instructions?: string | null
          local_time?: string | null
          original_date?: string | null
          priority?: string
          session_type?: string
          skip_note?: string | null
          source?: string
          status?: string
          structure?: Json | null
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_intensity?: Json | null
          template_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_sessions_import_batch_id_user_id_fkey"
            columns: ["import_batch_id", "user_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "planned_sessions_template_id_user_id_fkey"
            columns: ["template_id", "user_id"]
            isOneToOne: false
            referencedRelation: "session_templates"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          _rev: number
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          home_lat: number | null
          home_lng: number | null
          prefs: Json
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          home_lat?: number | null
          home_lng?: number | null
          prefs?: Json
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          home_lat?: number | null
          home_lng?: number | null
          prefs?: Json
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          device_label: string | null
          endpoint: string
          id: string
          keys: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          device_label?: string | null
          endpoint: string
          id?: string
          keys: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          device_label?: string | null
          endpoint?: string
          id?: string
          keys?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      race_plans: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          hr_caps: Json
          id: string
          leg: string
          morning_timeline: Json
          name: string
          nutrition: Json
          params: Json
          protocol_id: string | null
          race_id: string
          splits: Json
          target_time_s: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          hr_caps?: Json
          id?: string
          leg?: string
          morning_timeline?: Json
          name: string
          nutrition?: Json
          params?: Json
          protocol_id?: string | null
          race_id: string
          splits?: Json
          target_time_s?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          hr_caps?: Json
          id?: string
          leg?: string
          morning_timeline?: Json
          name?: string
          nutrition?: Json
          params?: Json
          protocol_id?: string | null
          race_id?: string
          splits?: Json
          target_time_s?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_plans_protocol_id_user_id_fkey"
            columns: ["protocol_id", "user_id"]
            isOneToOne: false
            referencedRelation: "nutrition_protocols"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "race_plans_race_id_user_id_fkey"
            columns: ["race_id", "user_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      races: {
        Row: {
          _rev: number
          course: Json | null
          created_at: string
          date: string
          debrief: Json | null
          deleted_at: string | null
          distance_m: number | null
          format: string
          goals: Json
          gpx_path: string | null
          id: string
          lat: number | null
          lng: number | null
          location: string | null
          name: string
          priority: string
          registration_url: string | null
          result: Json | null
          season_id: string | null
          sport: string
          start_time: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          course?: Json | null
          created_at?: string
          date: string
          debrief?: Json | null
          deleted_at?: string | null
          distance_m?: number | null
          format: string
          goals?: Json
          gpx_path?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location?: string | null
          name: string
          priority: string
          registration_url?: string | null
          result?: Json | null
          season_id?: string | null
          sport: string
          start_time?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          course?: Json | null
          created_at?: string
          date?: string
          debrief?: Json | null
          deleted_at?: string | null
          distance_m?: number | null
          format?: string
          goals?: Json
          gpx_path?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location?: string | null
          name?: string
          priority?: string
          registration_url?: string | null
          result?: Json | null
          season_id?: string | null
          sport?: string
          start_time?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "races_season_id_user_id_fkey"
            columns: ["season_id", "user_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      seasons: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          end_date: string
          goal: string | null
          id: string
          main_race_id: string | null
          name: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          end_date: string
          goal?: string | null
          id?: string
          main_race_id?: string | null
          name: string
          start_date: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          end_date?: string
          goal?: string | null
          id?: string
          main_race_id?: string | null
          name?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_main_race_id_user_id_fkey"
            columns: ["main_race_id", "user_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      session_templates: {
        Row: {
          _rev: number
          created_at: string
          default_distance_m: number | null
          default_duration_s: number | null
          deleted_at: string | null
          discipline: string
          id: string
          instructions: string | null
          name: string
          session_type: string
          structure: Json | null
          tags: string[]
          target_intensity: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          default_distance_m?: number | null
          default_duration_s?: number | null
          deleted_at?: string | null
          discipline: string
          id?: string
          instructions?: string | null
          name: string
          session_type: string
          structure?: Json | null
          tags?: string[]
          target_intensity?: Json | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          default_distance_m?: number | null
          default_duration_s?: number | null
          deleted_at?: string | null
          discipline?: string
          id?: string
          instructions?: string | null
          name?: string
          session_type?: string
          structure?: Json | null
          tags?: string[]
          target_intensity?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strength_exercises: {
        Row: {
          _rev: number
          archived_at: string | null
          created_at: string
          default_rest_s: number | null
          deleted_at: string | null
          id: string
          is_unilateral: boolean
          loads_legs: boolean
          muscle_groups: string[]
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          archived_at?: string | null
          created_at?: string
          default_rest_s?: number | null
          deleted_at?: string | null
          id?: string
          is_unilateral?: boolean
          loads_legs?: boolean
          muscle_groups?: string[]
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          archived_at?: string | null
          created_at?: string
          default_rest_s?: number | null
          deleted_at?: string | null
          id?: string
          is_unilateral?: boolean
          loads_legs?: boolean
          muscle_groups?: string[]
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strength_sets: {
        Row: {
          _field_ts: Json
          _rev: number
          completed_session_id: string
          created_at: string
          deleted_at: string | null
          exercise_id: string
          id: string
          is_warmup: boolean
          load_kg: number | null
          reps: number | null
          rir: number | null
          set_index: number
          side: string | null
          tempo: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _field_ts?: Json
          _rev?: number
          completed_session_id: string
          created_at?: string
          deleted_at?: string | null
          exercise_id: string
          id?: string
          is_warmup?: boolean
          load_kg?: number | null
          reps?: number | null
          rir?: number | null
          set_index: number
          side?: string | null
          tempo?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _field_ts?: Json
          _rev?: number
          completed_session_id?: string
          created_at?: string
          deleted_at?: string | null
          exercise_id?: string
          id?: string
          is_warmup?: boolean
          load_kg?: number | null
          reps?: number | null
          rir?: number | null
          set_index?: number
          side?: string | null
          tempo?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strength_sets_completed_session_id_user_id_fkey"
            columns: ["completed_session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "completed_sessions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "strength_sets_exercise_id_user_id_fkey"
            columns: ["exercise_id", "user_id"]
            isOneToOne: false
            referencedRelation: "strength_exercises"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      substitutions: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          duration_ratio: number
          from_discipline: string
          from_session_type: string | null
          id: string
          loss_note: string
          to_discipline: string
          to_label: string
          to_session_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          duration_ratio: number
          from_discipline: string
          from_session_type?: string | null
          id?: string
          loss_note: string
          to_discipline: string
          to_label: string
          to_session_type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          duration_ratio?: number
          from_discipline?: string
          from_session_type?: string | null
          id?: string
          loss_note?: string
          to_discipline?: string
          to_label?: string
          to_session_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tolerance_logs: {
        Row: {
          _rev: number
          completed_session_id: string | null
          created_at: string
          date: string
          deleted_at: string | null
          gi_rating: number
          id: string
          note: string | null
          product_id: string
          race_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          completed_session_id?: string | null
          created_at?: string
          date: string
          deleted_at?: string | null
          gi_rating: number
          id?: string
          note?: string | null
          product_id: string
          race_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          completed_session_id?: string | null
          created_at?: string
          date?: string
          deleted_at?: string | null
          gi_rating?: number
          id?: string
          note?: string | null
          product_id?: string
          race_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tolerance_logs_completed_session_id_user_id_fkey"
            columns: ["completed_session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "completed_sessions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tolerance_logs_product_id_user_id_fkey"
            columns: ["product_id", "user_id"]
            isOneToOne: false
            referencedRelation: "nutrition_products"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tolerance_logs_race_id_user_id_fkey"
            columns: ["race_id", "user_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      venue_slots: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          end_time: string
          id: string
          label: string | null
          start_time: string
          updated_at: string
          user_id: string
          valid_from: string | null
          valid_to: string | null
          venue_id: string
          weekday: number
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          end_time: string
          id?: string
          label?: string | null
          start_time: string
          updated_at?: string
          user_id?: string
          valid_from?: string | null
          valid_to?: string | null
          venue_id: string
          weekday: number
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          end_time?: string
          id?: string
          label?: string | null
          start_time?: string
          updated_at?: string
          user_id?: string
          valid_from?: string | null
          valid_to?: string | null
          venue_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "venue_slots_venue_id_user_id_fkey"
            columns: ["venue_id", "user_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      venues: {
        Row: {
          _rev: number
          address: string | null
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          name: string
          travel_min: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          name: string
          travel_min?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          name?: string
          travel_min?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      week_template_items: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          discipline: string
          distance_m: number | null
          duration_s: number | null
          id: string
          instructions: string | null
          local_time: string | null
          position: number
          priority: string
          progression: Json
          session_template_id: string | null
          session_type: string
          structure: Json | null
          target_intensity: Json | null
          updated_at: string
          user_id: string
          week_template_id: string
          weekday: number
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          discipline: string
          distance_m?: number | null
          duration_s?: number | null
          id?: string
          instructions?: string | null
          local_time?: string | null
          position?: number
          priority?: string
          progression?: Json
          session_template_id?: string | null
          session_type: string
          structure?: Json | null
          target_intensity?: Json | null
          updated_at?: string
          user_id?: string
          week_template_id: string
          weekday: number
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          discipline?: string
          distance_m?: number | null
          duration_s?: number | null
          id?: string
          instructions?: string | null
          local_time?: string | null
          position?: number
          priority?: string
          progression?: Json
          session_template_id?: string | null
          session_type?: string
          structure?: Json | null
          target_intensity?: Json | null
          updated_at?: string
          user_id?: string
          week_template_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "week_template_items_session_template_id_user_id_fkey"
            columns: ["session_template_id", "user_id"]
            isOneToOne: false
            referencedRelation: "session_templates"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "week_template_items_week_template_id_user_id_fkey"
            columns: ["week_template_id", "user_id"]
            isOneToOne: false
            referencedRelation: "week_templates"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      week_templates: {
        Row: {
          _rev: number
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          phase_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          phase_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          _rev?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          phase_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_templates_phase_id_user_id_fkey"
            columns: ["phase_id", "user_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      zone_models: {
        Row: {
          _rev: number
          basis: string
          bounds: Json
          created_at: string
          deleted_at: string | null
          discipline: string
          id: string
          method: string
          overrides: Json | null
          updated_at: string
          user_id: string
          valid_from: string
        }
        Insert: {
          _rev?: number
          basis: string
          bounds: Json
          created_at?: string
          deleted_at?: string | null
          discipline: string
          id?: string
          method: string
          overrides?: Json | null
          updated_at?: string
          user_id?: string
          valid_from: string
        }
        Update: {
          _rev?: number
          basis?: string
          bounds?: Json
          created_at?: string
          deleted_at?: string | null
          discipline?: string
          id?: string
          method?: string
          overrides?: Json | null
          updated_at?: string
          user_id?: string
          valid_from?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_equipment_usage: {
        Row: {
          equipment_id: string | null
          last_used_on: string | null
          session_count: number | null
          total_km: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_mutations: { Args: { mutations: Json }; Returns: Json }
      strava_connection: {
        Args: { p_athlete?: number; p_user?: string }
        Returns: {
          access_token: string
          athlete_id: number
          expires_at: string
          refresh_token: string
          user_id: string
        }[]
      }
      strava_delete_connection: { Args: { p_user: string }; Returns: undefined }
      strava_enqueue_event: { Args: { p: Json }; Returns: number }
      strava_finish_event: {
        Args: { p_error?: string; p_id: number }
        Returns: undefined
      }
      strava_mark_import: { Args: { p_user: string }; Returns: undefined }
      strava_pending_events: {
        Args: { p_limit?: number }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "strava_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      strava_save_connection: {
        Args: {
          p_access: string
          p_athlete: number
          p_expires: string
          p_refresh: string
          p_scopes: string[]
          p_user: string
        }
        Returns: undefined
      }
      strava_status: {
        Args: never
        Returns: {
          athlete_id: number
          connected_at: string
          failed_events: number
          last_event_at: string
          last_import_at: string
          scopes: string[]
        }[]
      }
      strava_update_tokens: {
        Args: {
          p_access: string
          p_expires: string
          p_refresh: string
          p_user: string
        }
        Returns: undefined
      }
      sync_writable_tables: { Args: never; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
