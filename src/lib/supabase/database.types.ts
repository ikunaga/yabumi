export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_metrics: {
        Row: {
          captured_at: string
          day: string
          owner_id: string
          social_account_id: string
          values: Json
        }
        Insert: {
          captured_at?: string
          day: string
          owner_id: string
          social_account_id: string
          values?: Json
        }
        Update: {
          captured_at?: string
          day?: string
          owner_id?: string
          social_account_id?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "account_metrics_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_plans: {
        Row: {
          created_at: string
          data: Json
          owner_id: string
          project_id: string
          schema_version: number
          section_sources: Json
          skipped_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          owner_id?: string
          project_id: string
          schema_version?: number
          section_sources?: Json
          skipped_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          owner_id?: string
          project_id?: string
          schema_version?: number
          section_sources?: Json
          skipped_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_image_jobs: {
        Row: {
          auto: boolean
          by_new_user: boolean
          cost_usd: number
          created_at: string
          id: string
          images: number
          model: string
          owner_id: string | null
          project_id: string | null
          status: string
        }
        Insert: {
          auto?: boolean
          by_new_user?: boolean
          cost_usd?: number
          created_at?: string
          id?: string
          images: number
          model: string
          owner_id?: string | null
          project_id?: string | null
          status?: string
        }
        Update: {
          auto?: boolean
          by_new_user?: boolean
          cost_usd?: number
          created_at?: string
          id?: string
          images?: number
          model?: string
          owner_id?: string | null
          project_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_image_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_image_notices: {
        Row: {
          acknowledged_at: string
          owner_id: string
        }
        Insert: {
          acknowledged_at?: string
          owner_id: string
        }
        Update: {
          acknowledged_at?: string
          owner_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          content: Json
          created_at: string
          id: string
          owner_id: string
          role: string
          thread_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          owner_id: string
          role: string
          thread_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          owner_id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_threads: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          owner_id: string
          project_id: string
          purpose: string
          reply_failed_at: string | null
          replying_since: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          owner_id: string
          project_id: string
          purpose: string
          reply_failed_at?: string | null
          replying_since?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          owner_id?: string
          project_id?: string
          purpose?: string
          reply_failed_at?: string | null
          replying_since?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_threads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          by_new_user: boolean
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          owner_id: string | null
          purpose: string
          status: string
          thread_id: string | null
        }
        Insert: {
          by_new_user?: boolean
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          owner_id?: string | null
          purpose: string
          status?: string
          thread_id?: string | null
        }
        Update: {
          by_new_user?: boolean
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          owner_id?: string | null
          purpose?: string
          status?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      app_store_report_requests: {
        Row: {
          app_apple_id: string
          created_at: string
          last_checked_at: string | null
          last_error: string | null
          last_imported_day: string | null
          owner_id: string
          project_id: string
          request_id: string
          status: string
          updated_at: string
        }
        Insert: {
          app_apple_id: string
          created_at?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_imported_day?: string | null
          owner_id: string
          project_id: string
          request_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          app_apple_id?: string
          created_at?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_imported_day?: string | null
          owner_id?: string
          project_id?: string
          request_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_store_report_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      attention_dismissals: {
        Row: {
          closed_at: string
          id: string
          kind: string
          owner_id: string
          post_id: string | null
          project_id: string
          ref_at: string | null
          ref_on: string | null
          roadmap_item_id: string | null
        }
        Insert: {
          closed_at?: string
          id?: string
          kind: string
          owner_id: string
          post_id?: string | null
          project_id: string
          ref_at?: string | null
          ref_on?: string | null
          roadmap_item_id?: string | null
        }
        Update: {
          closed_at?: string
          id?: string
          kind?: string
          owner_id?: string
          post_id?: string | null
          project_id?: string
          ref_at?: string | null
          ref_on?: string | null
          roadmap_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attention_dismissals_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attention_dismissals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attention_dismissals_roadmap_item_id_fkey"
            columns: ["roadmap_item_id"]
            isOneToOne: false
            referencedRelation: "roadmap_items"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_plans: {
        Row: {
          consent_version: string
          consented_at: string
          created_at: string
          fail_streak: number
          first_review: boolean
          id: string
          image: Json
          instructions: Json
          kind: string
          lead_hours: number
          materials: Json
          name: string
          owner_id: string
          project_id: string
          schedule: Json
          status: string
          stop_reason: string | null
          targets: Json
          tone: string
          updated_at: string
          x_link: string
        }
        Insert: {
          consent_version: string
          consented_at: string
          created_at?: string
          fail_streak?: number
          first_review?: boolean
          id?: string
          image?: Json
          instructions?: Json
          kind: string
          lead_hours?: number
          materials?: Json
          name: string
          owner_id: string
          project_id: string
          schedule: Json
          status?: string
          stop_reason?: string | null
          targets: Json
          tone?: string
          updated_at?: string
          x_link?: string
        }
        Update: {
          consent_version?: string
          consented_at?: string
          created_at?: string
          fail_streak?: number
          first_review?: boolean
          id?: string
          image?: Json
          instructions?: Json
          kind?: string
          lead_hours?: number
          materials?: Json
          name?: string
          owner_id?: string
          project_id?: string
          schedule?: Json
          status?: string
          stop_reason?: string | null
          targets?: Json
          tone?: string
          updated_at?: string
          x_link?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_post_holds: {
        Row: {
          held_at: string
          held_by: string
          hold_notified_at: string | null
          id: string
          reason: string
          release_notified_at: string | null
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          user_id: string
        }
        Insert: {
          held_at?: string
          held_by: string
          hold_notified_at?: string | null
          id?: string
          reason: string
          release_notified_at?: string | null
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          user_id: string
        }
        Update: {
          held_at?: string
          held_by?: string
          hold_notified_at?: string | null
          id?: string
          reason?: string
          release_notified_at?: string | null
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      auto_runs: {
        Row: {
          attempts: number
          created_at: string
          due_at: string
          generate_at: string
          id: string
          locked_at: string | null
          material_ref: Json
          notified_at: string | null
          owner_id: string
          plan_id: string
          post_id: string | null
          project_id: string
          reason: string | null
          reason_detail: string | null
          reminded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          due_at: string
          generate_at: string
          id?: string
          locked_at?: string | null
          material_ref?: Json
          notified_at?: string | null
          owner_id: string
          plan_id: string
          post_id?: string | null
          project_id: string
          reason?: string | null
          reason_detail?: string | null
          reminded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          due_at?: string
          generate_at?: string
          id?: string
          locked_at?: string | null
          material_ref?: Json
          notified_at?: string | null
          owner_id?: string
          plan_id?: string
          post_id?: string | null
          project_id?: string
          reason?: string | null
          reason_detail?: string | null
          reminded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_runs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "auto_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_runs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_sample_runs: {
        Row: {
          created_at: string
          id: number
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: never
          owner_id?: string
        }
        Relationships: []
      }
      auto_samples: {
        Row: {
          created_at: string
          hold: Json | null
          id: string
          image: Json | null
          material: Json
          owner_id: string
          plan_id: string | null
          project_id: string
          settings: Json
          tags: Json
          texts: Json
        }
        Insert: {
          created_at?: string
          hold?: Json | null
          id?: string
          image?: Json | null
          material: Json
          owner_id: string
          plan_id?: string | null
          project_id: string
          settings: Json
          tags?: Json
          texts: Json
        }
        Update: {
          created_at?: string
          hold?: Json | null
          id?: string
          image?: Json | null
          material?: Json
          owner_id?: string
          plan_id?: string | null
          project_id?: string
          settings?: Json
          tags?: Json
          texts?: Json
        }
        Relationships: [
          {
            foreignKeyName: "auto_samples_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "auto_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_samples_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      github_installations: {
        Row: {
          account_login: string
          account_type: string
          created_at: string
          installation_id: number
          owner_id: string
          repo_ids: number[] | null
          updated_at: string
        }
        Insert: {
          account_login: string
          account_type?: string
          created_at?: string
          installation_id: number
          owner_id: string
          repo_ids?: number[] | null
          updated_at?: string
        }
        Update: {
          account_login?: string
          account_type?: string
          created_at?: string
          installation_id?: number
          owner_id?: string
          repo_ids?: number[] | null
          updated_at?: string
        }
        Relationships: []
      }
      goal_kpis: {
        Row: {
          action: string | null
          created_at: string
          goal_id: string
          id: string
          metric: string
          owner_id: string
          per_week: number
          position: number
          role: string
          sns: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string
          goal_id: string
          id?: string
          metric: string
          owner_id: string
          per_week: number
          position?: number
          role: string
          sns?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string
          goal_id?: string
          id?: string
          metric?: string
          owner_id?: string
          per_week?: number
          position?: number
          role?: string
          sns?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_kpis_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_milestones: {
        Row: {
          created_at: string
          ends_on: string
          goal_id: string
          id: string
          owner_id: string
          result_value: number | null
          seq: number
          settled_at: string | null
          starts_on: string
          target: number | null
        }
        Insert: {
          created_at?: string
          ends_on: string
          goal_id: string
          id?: string
          owner_id: string
          result_value?: number | null
          seq: number
          settled_at?: string | null
          starts_on: string
          target?: number | null
        }
        Update: {
          created_at?: string
          ends_on?: string
          goal_id?: string
          id?: string
          owner_id?: string
          result_value?: number | null
          seq?: number
          settled_at?: string | null
          starts_on?: string
          target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_milestones_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          action: string | null
          closed_at: string | null
          created_at: string
          ends_on: string | null
          id: string
          metric: string | null
          owner_id: string
          project_id: string
          provisional: boolean
          result_value: number | null
          sns: string | null
          source: string
          starts_on: string
          statement: string | null
          status: string
          target: number | null
          updated_at: string
        }
        Insert: {
          action?: string | null
          closed_at?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          metric?: string | null
          owner_id: string
          project_id: string
          provisional?: boolean
          result_value?: number | null
          sns?: string | null
          source?: string
          starts_on: string
          statement?: string | null
          status?: string
          target?: number | null
          updated_at?: string
        }
        Update: {
          action?: string | null
          closed_at?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          metric?: string | null
          owner_id?: string
          project_id?: string
          provisional?: boolean
          result_value?: number | null
          sns?: string | null
          source?: string
          starts_on?: string
          statement?: string | null
          status?: string
          target?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          owner_id: string
          post_id: string | null
          project_id: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          owner_id?: string
          post_id?: string | null
          project_id: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          owner_id?: string
          post_id?: string | null
          project_id?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_notes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_term_reads: {
        Row: {
          first_read_at: string
          last_read_at: string
          term_key: string
          user_id: string
        }
        Insert: {
          first_read_at?: string
          last_read_at?: string
          term_key: string
          user_id?: string
        }
        Update: {
          first_read_at?: string
          last_read_at?: string
          term_key?: string
          user_id?: string
        }
        Relationships: []
      }
      learning_tip_shows: {
        Row: {
          last_shown_at: string
          tip_key: string
          user_id: string
        }
        Insert: {
          last_shown_at?: string
          tip_key: string
          user_id?: string
        }
        Update: {
          last_shown_at?: string
          tip_key?: string
          user_id?: string
        }
        Relationships: []
      }
      legal_consents: {
        Row: {
          accepted_at: string
          id: string
          user_id: string
          version: string
          via: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          user_id?: string
          version: string
          via: string
        }
        Update: {
          accepted_at?: string
          id?: string
          user_id?: string
          version?: string
          via?: string
        }
        Relationships: []
      }
      legal_notice_campaigns: {
        Row: {
          finished_at: string | null
          started_at: string
          version: string
        }
        Insert: {
          finished_at?: string | null
          started_at?: string
          version: string
        }
        Update: {
          finished_at?: string | null
          started_at?: string
          version?: string
        }
        Relationships: []
      }
      legal_notice_sends: {
        Row: {
          attempts: number
          created_at: string
          status: string
          updated_at: string
          user_id: string
          version: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          status?: string
          updated_at?: string
          user_id: string
          version: string
        }
        Update: {
          attempts?: number
          created_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_notice_sends_version_fkey"
            columns: ["version"]
            isOneToOne: false
            referencedRelation: "legal_notice_campaigns"
            referencedColumns: ["version"]
          },
        ]
      }
      link_click_daily: {
        Row: {
          clicks: number
          day: string
          device: string
          excluded: number
          link_id: string
          owner_id: string
        }
        Insert: {
          clicks?: number
          day: string
          device: string
          excluded?: number
          link_id: string
          owner_id: string
        }
        Update: {
          clicks?: number
          day?: string
          device?: string
          excluded?: number
          link_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_click_daily_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      link_clicks: {
        Row: {
          clicked_at: string
          country: string | null
          device: string
          excluded: string | null
          id: number
          link_id: string
          visitor_hash: string
        }
        Insert: {
          clicked_at?: string
          country?: string | null
          device: string
          excluded?: string | null
          id?: never
          link_id: string
          visitor_hash: string
        }
        Update: {
          clicked_at?: string
          country?: string | null
          device?: string
          excluded?: string | null
          id?: never
          link_id?: string
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      link_domain_attempts: {
        Row: {
          created_at: string
          domain: string
          id: number
          owner_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: never
          owner_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: never
          owner_id?: string
        }
        Relationships: []
      }
      link_domain_removals: {
        Row: {
          attempts: number
          created_at: string
          domain: string
          last_error: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          domain: string
          last_error?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          domain?: string
          last_error?: string
        }
        Relationships: []
      }
      link_domains: {
        Row: {
          cname_target: string
          created_at: string
          dns_confirmed_at: string | null
          domain: string
          id: string
          last_check: string
          last_checked_at: string | null
          owner_id: string
          owner_verified_at: string | null
          ownership_token: string
          pending_since: string
          project_id: string
          status: string
          txt_name: string
          txt_value: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          cname_target?: string
          created_at?: string
          dns_confirmed_at?: string | null
          domain: string
          id?: string
          last_check?: string
          last_checked_at?: string | null
          owner_id: string
          owner_verified_at?: string | null
          ownership_token?: string
          pending_since?: string
          project_id: string
          status?: string
          txt_name?: string
          txt_value?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          cname_target?: string
          created_at?: string
          dns_confirmed_at?: string | null
          domain?: string
          id?: string
          last_check?: string
          last_checked_at?: string | null
          owner_id?: string
          owner_verified_at?: string | null
          ownership_token?: string
          pending_since?: string
          project_id?: string
          status?: string
          txt_name?: string
          txt_value?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_domains_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      link_hash_salts: {
        Row: {
          day: string
          salt: string
        }
        Insert: {
          day: string
          salt: string
        }
        Update: {
          day?: string
          salt?: string
        }
        Relationships: []
      }
      manual_post_metrics: {
        Row: {
          owner_id: string
          post_target_id: string
          reactions: number | null
          recorded_at: string
          updated_at: string
          views: number | null
        }
        Insert: {
          owner_id?: string
          post_target_id: string
          reactions?: number | null
          recorded_at?: string
          updated_at?: string
          views?: number | null
        }
        Update: {
          owner_id?: string
          post_target_id?: string
          reactions?: number | null
          recorded_at?: string
          updated_at?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_post_metrics_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: true
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_files: {
        Row: {
          ai_generated: boolean
          alt_text: string
          created_at: string
          duration_ms: number | null
          edit: Json | null
          edit_base_id: string | null
          has_text: boolean | null
          height: number
          id: string
          kind: string
          note_id: string | null
          original_id: string | null
          owner_id: string
          position: number
          post_id: string | null
          removed_at: string | null
          size_bytes: number
          source_of: string | null
          storage_path: string
          updated_at: string
          width: number
        }
        Insert: {
          ai_generated?: boolean
          alt_text?: string
          created_at?: string
          duration_ms?: number | null
          edit?: Json | null
          edit_base_id?: string | null
          has_text?: boolean | null
          height: number
          id?: string
          kind?: string
          note_id?: string | null
          original_id?: string | null
          owner_id: string
          position?: number
          post_id?: string | null
          removed_at?: string | null
          size_bytes: number
          source_of?: string | null
          storage_path: string
          updated_at?: string
          width: number
        }
        Update: {
          ai_generated?: boolean
          alt_text?: string
          created_at?: string
          duration_ms?: number | null
          edit?: Json | null
          edit_base_id?: string | null
          has_text?: boolean | null
          height?: number
          id?: string
          kind?: string
          note_id?: string | null
          original_id?: string | null
          owner_id?: string
          position?: number
          post_id?: string | null
          removed_at?: string | null
          size_bytes?: number
          source_of?: string | null
          storage_path?: string
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_files_edit_base_id_fkey"
            columns: ["edit_base_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "idea_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_original_id_fkey"
            columns: ["original_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_source_of_fkey"
            columns: ["source_of"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
        ]
      }
      media_upload_tickets: {
        Row: {
          consumed_at: string | null
          created_at: string
          kind: string
          owner_id: string
          storage_path: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          kind?: string
          owner_id: string
          storage_path: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          kind?: string
          owner_id?: string
          storage_path?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          channel: string
          created_at: string
          id: number
          kind: string
          period_key: string
          project_id: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: never
          kind: string
          period_key: string
          project_id: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: never
          kind?: string
          period_key?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          auto_post_push: boolean
          behind_weekday: number
          comment_push: string
          email_mode: string
          learning_enabled: boolean
          learning_term_dismissed_on: string | null
          learning_term_key: string | null
          learning_term_on: string | null
          push_mode: string
          unsubscribe_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_post_push?: boolean
          behind_weekday?: number
          comment_push?: string
          email_mode?: string
          learning_enabled?: boolean
          learning_term_dismissed_on?: string | null
          learning_term_key?: string | null
          learning_term_on?: string | null
          push_mode?: string
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          auto_post_push?: boolean
          behind_weekday?: number
          comment_push?: string
          email_mode?: string
          learning_enabled?: boolean
          learning_term_dismissed_on?: string | null
          learning_term_key?: string | null
          learning_term_on?: string | null
          push_mode?: string
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      operator_notifications: {
        Row: {
          key: string
          sent_at: string
        }
        Insert: {
          key: string
          sent_at?: string
        }
        Update: {
          key?: string
          sent_at?: string
        }
        Relationships: []
      }
      pace_weeks: {
        Row: {
          achieved: boolean
          owner_id: string
          project_id: string
          published: Json
          scheduled: Json
          targets: Json
          updated_at: string
          week_start: string
        }
        Insert: {
          achieved?: boolean
          owner_id: string
          project_id: string
          published?: Json
          scheduled?: Json
          targets: Json
          updated_at?: string
          week_start: string
        }
        Update: {
          achieved?: boolean
          owner_id?: string
          project_id?: string
          published?: Json
          scheduled?: Json
          targets?: Json
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "pace_weeks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_page_choices: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          pages: Json
          parent_external_id: string
          project_id: string
          tokens_encrypted: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          owner_id: string
          pages: Json
          parent_external_id: string
          project_id: string
          tokens_encrypted: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          pages?: Json
          parent_external_id?: string
          project_id?: string
          tokens_encrypted?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_page_choices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      play_account_creations: {
        Row: {
          created_at: string
          id: number
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: never
          owner_id?: string
        }
        Relationships: []
      }
      play_connections: {
        Row: {
          bucket: string | null
          created_at: string
          last_checked_at: string | null
          last_error: string | null
          owner_id: string
          package_name: string | null
          project_id: string
          service_account_email: string
          status: string
          updated_at: string
        }
        Insert: {
          bucket?: string | null
          created_at?: string
          last_checked_at?: string | null
          last_error?: string | null
          owner_id: string
          package_name?: string | null
          project_id: string
          service_account_email: string
          status?: string
          updated_at?: string
        }
        Update: {
          bucket?: string | null
          created_at?: string
          last_checked_at?: string | null
          last_error?: string | null
          owner_id?: string
          package_name?: string | null
          project_id?: string
          service_account_email?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      post_format_rounds: {
        Row: {
          created_at: string
          format_id: string
          id: string
          owner_id: string
          post_id: string | null
          source: string
          values: Json
        }
        Insert: {
          created_at?: string
          format_id: string
          id?: string
          owner_id?: string
          post_id?: string | null
          source: string
          values?: Json
        }
        Update: {
          created_at?: string
          format_id?: string
          id?: string
          owner_id?: string
          post_id?: string | null
          source?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "post_format_rounds_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "post_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_format_rounds_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_formats: {
        Row: {
          body: string
          created_at: string
          example: string
          hashtags: Json
          id: string
          image: Json
          name: string
          owner_id: string
          pillar: string
          position: number
          project_id: string
          purpose: string
          series: Json
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          example?: string
          hashtags?: Json
          id?: string
          image?: Json
          name: string
          owner_id?: string
          pillar?: string
          position?: number
          project_id: string
          purpose?: string
          series?: Json
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          example?: string
          hashtags?: Json
          id?: string
          image?: Json
          name?: string
          owner_id?: string
          pillar?: string
          position?: number
          project_id?: string
          purpose?: string
          series?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_formats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      post_metrics: {
        Row: {
          captured_at: string
          day_index: number
          owner_id: string
          post_target_id: string
          values: Json
        }
        Insert: {
          captured_at?: string
          day_index: number
          owner_id: string
          post_target_id: string
          values?: Json
        }
        Update: {
          captured_at?: string
          day_index?: number
          owner_id?: string
          post_target_id?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "post_metrics_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      post_target_approvals: {
        Row: {
          approved_at: string
          fingerprint: string
          owner_id: string
          post_target_id: string
        }
        Insert: {
          approved_at?: string
          fingerprint: string
          owner_id: string
          post_target_id: string
        }
        Update: {
          approved_at?: string
          fingerprint?: string
          owner_id?: string
          post_target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_target_approvals_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: true
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      post_target_tiktok: {
        Row: {
          brand_content: boolean
          brand_organic: boolean
          consent_nickname: string
          consent_text_hash: string
          consent_username: string
          consented_at: string
          disable_comment: boolean
          is_aigc: boolean
          owner_id: string
          post_mode: string
          post_target_id: string
          privacy_level: string
          updated_at: string
        }
        Insert: {
          brand_content?: boolean
          brand_organic?: boolean
          consent_nickname: string
          consent_text_hash: string
          consent_username?: string
          consented_at: string
          disable_comment?: boolean
          is_aigc?: boolean
          owner_id: string
          post_mode?: string
          post_target_id: string
          privacy_level: string
          updated_at?: string
        }
        Update: {
          brand_content?: boolean
          brand_organic?: boolean
          consent_nickname?: string
          consent_text_hash?: string
          consent_username?: string
          consented_at?: string
          disable_comment?: boolean
          is_aigc?: boolean
          owner_id?: string
          post_mode?: string
          post_target_id?: string
          privacy_level?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_target_tiktok_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: true
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      post_target_youtube: {
        Row: {
          category_id: string
          consent_channel: string
          consent_text_hash: string
          consented_at: string
          made_for_kids: boolean
          owner_id: string
          post_target_id: string
          privacy_status: string
          synthetic_media: boolean
          updated_at: string
        }
        Insert: {
          category_id: string
          consent_channel: string
          consent_text_hash: string
          consented_at: string
          made_for_kids: boolean
          owner_id: string
          post_target_id: string
          privacy_status: string
          synthetic_media?: boolean
          updated_at?: string
        }
        Update: {
          category_id?: string
          consent_channel?: string
          consent_text_hash?: string
          consented_at?: string
          made_for_kids?: boolean
          owner_id?: string
          post_target_id?: string
          privacy_status?: string
          synthetic_media?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_target_youtube_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: true
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      post_targets: {
        Row: {
          attempts: number
          attention_closed_at: string | null
          body_override: string | null
          created_at: string
          error_message: string | null
          external_post_id: string | null
          external_url: string | null
          failed_at: string | null
          hashtags: string[]
          id: string
          locked_at: string | null
          next_attempt_at: string | null
          owner_id: string
          post_id: string
          preparing_since: string | null
          published_at: string | null
          quote_post_id: string | null
          sns: string
          sns_checked_at: string | null
          sns_container: Json | null
          sns_removed_at: string | null
          social_account_id: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          attention_closed_at?: string | null
          body_override?: string | null
          created_at?: string
          error_message?: string | null
          external_post_id?: string | null
          external_url?: string | null
          failed_at?: string | null
          hashtags?: string[]
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          owner_id?: string
          post_id: string
          preparing_since?: string | null
          published_at?: string | null
          quote_post_id?: string | null
          sns: string
          sns_checked_at?: string | null
          sns_container?: Json | null
          sns_removed_at?: string | null
          social_account_id?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          attention_closed_at?: string | null
          body_override?: string | null
          created_at?: string
          error_message?: string | null
          external_post_id?: string | null
          external_url?: string | null
          failed_at?: string | null
          hashtags?: string[]
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          owner_id?: string
          post_id?: string
          preparing_since?: string | null
          published_at?: string | null
          quote_post_id?: string | null
          sns?: string
          sns_checked_at?: string | null
          sns_container?: Json | null
          sns_removed_at?: string | null
          social_account_id?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_targets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_targets_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          auto_created: boolean
          auto_run_id: string | null
          body: string
          created_at: string
          format_id: string | null
          id: string
          owner_id: string
          planned_at: string | null
          project_id: string
          roadmap_item_id: string | null
          status: string
          text_origin: string | null
          updated_at: string
        }
        Insert: {
          auto_created?: boolean
          auto_run_id?: string | null
          body?: string
          created_at?: string
          format_id?: string | null
          id?: string
          owner_id?: string
          planned_at?: string | null
          project_id: string
          roadmap_item_id?: string | null
          status?: string
          text_origin?: string | null
          updated_at?: string
        }
        Update: {
          auto_created?: boolean
          auto_run_id?: string | null
          body?: string
          created_at?: string
          format_id?: string | null
          id?: string
          owner_id?: string
          planned_at?: string | null
          project_id?: string
          roadmap_item_id?: string | null
          status?: string
          text_origin?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_auto_run_id_fkey"
            columns: ["auto_run_id"]
            isOneToOne: false
            referencedRelation: "auto_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "post_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_roadmap_item_id_fkey"
            columns: ["roadmap_item_id"]
            isOneToOne: false
            referencedRelation: "roadmap_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_destinations: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string
          owner_id: string
          position: number
          project_id: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          label?: string
          owner_id?: string
          position?: number
          project_id: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          label?: string
          owner_id?: string
          position?: number
          project_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_destinations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_events: {
        Row: {
          body: string
          created_at: string
          id: string
          on_date: string
          owner_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          on_date: string
          owner_id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          on_date?: string
          owner_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_github_repos: {
        Row: {
          created_at: string
          default_branch: string
          full_name: string
          installation_id: number
          is_private: boolean
          last_read_at: string | null
          owner_id: string
          project_id: string
          repo_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_branch?: string
          full_name: string
          installation_id: number
          is_private?: boolean
          last_read_at?: string | null
          owner_id: string
          project_id: string
          repo_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_branch?: string
          full_name?: string
          installation_id?: number
          is_private?: boolean
          last_read_at?: string | null
          owner_id?: string
          project_id?: string
          repo_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_github_repos_owner_id_installation_id_fkey"
            columns: ["owner_id", "installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["owner_id", "installation_id"]
          },
          {
            foreignKeyName: "project_github_repos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_manual_channels: {
        Row: {
          created_at: string
          owner_id: string
          profile_url: string | null
          project_id: string
          sns: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          owner_id?: string
          profile_url?: string | null
          project_id: string
          sns: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          owner_id?: string
          profile_url?: string | null
          project_id?: string
          sns?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_manual_channels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_outcomes_daily: {
        Row: {
          action: string
          count: number
          day: string
          owner_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          action: string
          count: number
          day: string
          owner_id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          count?: number
          day?: string
          owner_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_outcomes_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_social_accounts: {
        Row: {
          created_at: string
          owner_id: string
          project_id: string
          social_account_id: string
        }
        Insert: {
          created_at?: string
          owner_id?: string
          project_id: string
          social_account_id: string
        }
        Update: {
          created_at?: string
          owner_id?: string
          project_id?: string
          social_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_social_accounts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_social_accounts_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          app_store_provider_token: string | null
          app_store_url: string | null
          created_at: string
          default_hashtags: Json
          description: string
          github_prompt_dismissed_at: string | null
          id: string
          name: string
          owner_id: string
          play_store_url: string | null
          product_type: string
          target_audience: string
          updated_at: string
        }
        Insert: {
          app_store_provider_token?: string | null
          app_store_url?: string | null
          created_at?: string
          default_hashtags?: Json
          description?: string
          github_prompt_dismissed_at?: string | null
          id?: string
          name: string
          owner_id?: string
          play_store_url?: string | null
          product_type?: string
          target_audience?: string
          updated_at?: string
        }
        Update: {
          app_store_provider_token?: string | null
          app_store_url?: string | null
          created_at?: string
          default_hashtags?: Json
          description?: string
          github_prompt_dismissed_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          play_store_url?: string | null
          product_type?: string
          target_audience?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string
          endpoint: string
          id: string
          last_success_at: string | null
          p256dh: string
          test_sent_at: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string
          endpoint: string
          id?: string
          last_success_at?: string | null
          p256dh: string
          test_sent_at?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string
          endpoint?: string
          id?: string
          last_success_at?: string | null
          p256dh?: string
          test_sent_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      roadmap_items: {
        Row: {
          action: string | null
          created_at: string
          detail: string
          done_at: string | null
          goal_id: string
          id: string
          kind: string | null
          kpi: string | null
          owner_id: string
          planned_on: string | null
          position: number
          project_id: string
          sns: string | null
          source: string
          status: string
          target: number | null
          title: string
          updated_at: string
          week_start: string
        }
        Insert: {
          action?: string | null
          created_at?: string
          detail?: string
          done_at?: string | null
          goal_id: string
          id?: string
          kind?: string | null
          kpi?: string | null
          owner_id?: string
          planned_on?: string | null
          position?: number
          project_id: string
          sns?: string | null
          source?: string
          status?: string
          target?: number | null
          title: string
          updated_at?: string
          week_start: string
        }
        Update: {
          action?: string | null
          created_at?: string
          detail?: string
          done_at?: string | null
          goal_id?: string
          id?: string
          kind?: string | null
          kpi?: string | null
          owner_id?: string
          planned_on?: string | null
          position?: number
          project_id?: string
          sns?: string | null
          source?: string
          status?: string
          target?: number | null
          title?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_items_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      short_links: {
        Row: {
          code: string
          created_at: string
          destination_url: string
          disabled_at: string | null
          id: string
          kind: string
          label: string
          owner_id: string
          post_target_id: string | null
          project_id: string
          sns: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          destination_url: string
          disabled_at?: string | null
          id?: string
          kind: string
          label?: string
          owner_id: string
          post_target_id?: string | null
          project_id: string
          sns?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          destination_url?: string
          disabled_at?: string | null
          id?: string
          kind?: string
          label?: string
          owner_id?: string
          post_target_id?: string | null
          project_id?: string
          sns?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_links_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sns_api_usage: {
        Row: {
          cost_usd: number
          created_at: string
          id: string
          operation: string
          owner_id: string | null
          post_target_id: string | null
          sns: string
        }
        Insert: {
          cost_usd: number
          created_at?: string
          id?: string
          operation: string
          owner_id?: string | null
          post_target_id?: string | null
          sns: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          id?: string
          operation?: string
          owner_id?: string | null
          post_target_id?: string | null
          sns?: string
        }
        Relationships: [
          {
            foreignKeyName: "sns_api_usage_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      sns_comment_polls: {
        Row: {
          fails: number
          last_checked_at: string | null
          last_count: number | null
          next_check_at: string
          owner_id: string
          post_target_id: string
          stopped: boolean
        }
        Insert: {
          fails?: number
          last_checked_at?: string | null
          last_count?: number | null
          next_check_at: string
          owner_id: string
          post_target_id: string
          stopped?: boolean
        }
        Update: {
          fails?: number
          last_checked_at?: string | null
          last_count?: number | null
          next_check_at?: string
          owner_id?: string
          post_target_id?: string
          stopped?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sns_comment_polls_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: true
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      sns_comments: {
        Row: {
          author_name: string
          body: string
          commented_at: string
          external_id: string
          fetched_at: string
          id: string
          is_own: boolean
          notified_at: string | null
          owner_id: string
          parent_external_id: string | null
          post_target_id: string
          seen_at: string | null
          sns: string
          social_account_id: string
        }
        Insert: {
          author_name?: string
          body?: string
          commented_at: string
          external_id: string
          fetched_at?: string
          id?: string
          is_own?: boolean
          notified_at?: string | null
          owner_id: string
          parent_external_id?: string | null
          post_target_id: string
          seen_at?: string | null
          sns: string
          social_account_id: string
        }
        Update: {
          author_name?: string
          body?: string
          commented_at?: string
          external_id?: string
          fetched_at?: string
          id?: string
          is_own?: boolean
          notified_at?: string | null
          owner_id?: string
          parent_external_id?: string | null
          post_target_id?: string
          seen_at?: string | null
          sns?: string
          social_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sns_comments_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sns_comments_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_account_tokens: {
        Row: {
          access_token_encrypted: string
          expires_at: string | null
          refresh_locked_until: string | null
          refresh_token_encrypted: string | null
          scopes: string[]
          social_account_id: string
          updated_at: string
        }
        Insert: {
          access_token_encrypted: string
          expires_at?: string | null
          refresh_locked_until?: string | null
          refresh_token_encrypted?: string | null
          scopes?: string[]
          social_account_id: string
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string
          expires_at?: string | null
          refresh_locked_until?: string | null
          refresh_token_encrypted?: string | null
          scopes?: string[]
          social_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_account_tokens_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: true
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          created_at: string
          display_name: string
          external_id: string
          handle: string
          id: string
          owner_id: string
          parent_external_id: string | null
          sns: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          external_id: string
          handle?: string
          id?: string
          owner_id?: string
          parent_external_id?: string | null
          sns: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          external_id?: string
          handle?: string
          id?: string
          owner_id?: string
          parent_external_id?: string | null
          sns?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      store_credentials: {
        Row: {
          created_at: string
          hint: string
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_imported_day: string | null
          owner_id: string
          project_id: string
          provider: string
          secret_sealed: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hint?: string
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_imported_day?: string | null
          owner_id: string
          project_id: string
          provider: string
          secret_sealed: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hint?: string
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_imported_day?: string | null
          owner_id?: string
          project_id?: string
          provider?: string
          secret_sealed?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      store_daily: {
        Row: {
          day: string
          owner_id: string
          project_id: string
          source: string
          updated_at: string
          values: Json
        }
        Insert: {
          day: string
          owner_id: string
          project_id: string
          source: string
          updated_at?: string
          values?: Json
        }
        Update: {
          day?: string
          owner_id?: string
          project_id?: string
          source?: string
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "store_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_media_tickets: {
        Row: {
          created_at: string
          expires_at: string
          media_id: string
          owner_id: string
          post_target_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          media_id: string
          owner_id: string
          post_target_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          media_id?: string
          owner_id?: string
          post_target_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_media_tickets_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiktok_media_tickets_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: false
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      video_upload_counts: {
        Row: {
          count: number
          month: string
          owner_id: string
        }
        Insert: {
          count?: number
          month: string
          owner_id: string
        }
        Update: {
          count?: number
          month?: string
          owner_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          app_note: string
          cancel_token_hash: string
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          sns_note: string
        }
        Insert: {
          app_note?: string
          cancel_token_hash: string
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          sns_note?: string
        }
        Update: {
          app_note?: string
          cancel_token_hash?: string
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          sns_note?: string
        }
        Relationships: []
      }
      x_search_usage: {
        Row: {
          by_new_user: boolean
          cost_usd: number
          created_at: string
          id: string
          owner_id: string | null
          post_count: number | null
          project_id: string | null
          settled_at: string | null
          status: string
          user_count: number | null
        }
        Insert: {
          by_new_user?: boolean
          cost_usd: number
          created_at?: string
          id?: string
          owner_id?: string | null
          post_count?: number | null
          project_id?: string | null
          settled_at?: string | null
          status?: string
          user_count?: number | null
        }
        Update: {
          by_new_user?: boolean
          cost_usd?: number
          created_at?: string
          id?: string
          owner_id?: string | null
          post_count?: number | null
          project_id?: string | null
          settled_at?: string | null
          status?: string
          user_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "x_search_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_uploads: {
        Row: {
          bytes_sent: number
          bytes_total: number
          owner_id: string
          post_target_id: string
          processing_check_until: string | null
          session_uri_encrypted: string | null
          started_at: string
          updated_at: string
          video_id: string | null
        }
        Insert: {
          bytes_sent?: number
          bytes_total: number
          owner_id: string
          post_target_id: string
          processing_check_until?: string | null
          session_uri_encrypted?: string | null
          started_at?: string
          updated_at?: string
          video_id?: string | null
        }
        Update: {
          bytes_sent?: number
          bytes_total?: number
          owner_id?: string
          post_target_id?: string
          processing_check_until?: string | null
          session_uri_encrypted?: string | null
          started_at?: string
          updated_at?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_uploads_post_target_id_fkey"
            columns: ["post_target_id"]
            isOneToOne: true
            referencedRelation: "post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_budget_check: {
        Args: {
          p_as_of?: string
          p_cost_usd: number
          p_owner_id: string
          p_purpose: string
          p_scope_owner?: string
        }
        Returns: {
          by_new_user: boolean
          cost_usd: number
          global_month_usd: number
          new_until: string
          status: string
          user_cap_usd: number
          user_month_usd: number
        }[]
      }
      ai_budget_status: {
        Args: { p_purpose?: string }
        Returns: {
          available_from: string
          low: boolean
          status: string
        }[]
      }
      ai_budget_status_of: {
        Args: {
          p_as_of?: string
          p_owner_id: string
          p_purpose?: string
          p_scope_owner?: string
        }
        Returns: {
          available_from: string
          low: boolean
          status: string
        }[]
      }
      ai_image_quota: {
        Args: {
          p_as_of?: string
          p_auto?: boolean
          p_owner_id: string
          p_scope_owner?: string
        }
        Returns: {
          attempts_today: number
          global_month_usd: number
          new_until: string
          new_users_month_usd: number
          user_month_images: number
          user_monthly_limit: number
        }[]
      }
      ai_usage_totals: {
        Args: { p_day_start: string; p_month_start: string; p_owner_id: string }
        Returns: {
          global_month_usd: number
          owner_month_usd: number
          owner_today_count: number
        }[]
      }
      approve_auto_target: {
        Args: { p_fingerprint: string; p_target_id: string }
        Returns: undefined
      }
      auto_approve_target: {
        Args: { p_fingerprint: string; p_target_id: string; p_uid: string }
        Returns: undefined
      }
      auto_cancel_unsent_runs: {
        Args: {
          p_reason: string
          p_run_ids: string[]
          p_to_draft: boolean
          p_uid: string
        }
        Returns: number
      }
      auto_image_valid: { Args: { p: Json; p_kind: string }; Returns: boolean }
      auto_instructions_clean: { Args: { p: Json }; Returns: Json }
      auto_instructions_valid: { Args: { p: Json }; Returns: boolean }
      auto_post_held: { Args: { p_uid: string }; Returns: boolean }
      auto_target_previews: {
        Args: { p_post_id: string }
        Returns: {
          approved_at: string
          body: string
          fingerprint: string
          sns: string
          status: string
          target_id: string
          title: string
        }[]
      }
      by_hand_message: { Args: { p_sns: string }; Returns: string }
      calendar_day_counts: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          day: string
          posts: number
        }[]
      }
      claim_due_auto_runs: {
        Args: { p_limit?: number; p_owner_ids?: string[] }
        Returns: {
          attempts: number
          created_at: string
          due_at: string
          generate_at: string
          id: string
          locked_at: string | null
          material_ref: Json
          notified_at: string | null
          owner_id: string
          plan_id: string
          post_id: string | null
          project_id: string
          reason: string | null
          reason_detail: string | null
          reminded_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "auto_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_targets: {
        Args: { p_limit?: number; p_post_id?: string }
        Returns: {
          account_external_id: string
          account_status: string
          attempts: number
          body: string
          post_id: string
          preparing_since: string
          sns: string
          sns_container: Json
          social_account_id: string
          target_id: string
        }[]
      }
      claim_learning_tip: { Args: { p_candidates: string[] }; Returns: string }
      claim_link_domain:
        | {
            Args: {
              p_daily: number
              p_domain: string
              p_owner: string
              p_project: string
              p_token: string
              p_total: number
            }
            Returns: string
          }
        | {
            Args: {
              p_daily: number
              p_domain: string
              p_owner: string
              p_project: string
              p_total: number
            }
            Returns: string
          }
      claim_operator_notification: {
        Args: { p_key: string; p_window: unknown }
        Returns: boolean
      }
      claim_token_refresh: {
        Args: { p_lease_seconds?: number; p_social_account_id: string }
        Returns: {
          access_token_encrypted: string
          expires_at: string
          refresh_token_encrypted: string
        }[]
      }
      cleanup_media_candidates: {
        Args: { p_limit?: number; p_now?: string; p_owner_id?: string }
        Returns: {
          bucket: string
          mark_removed: boolean
          media_id: string
          storage_path: string
        }[]
      }
      close_attention: {
        Args: { p_items: Json; p_project_id: string }
        Returns: number
      }
      close_goal_internal: {
        Args: { p_goal_id: string; p_replacing: boolean }
        Returns: undefined
      }
      connected_store_sources: {
        Args: { p_project_id: string }
        Returns: string[]
      }
      counted_post_targets: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          day: string
          project_id: string
          sns: string
          state: string
          target_id: string
        }[]
      }
      decline_auto_target: { Args: { p_target_id: string }; Returns: undefined }
      delete_auto_plan: {
        Args: { p_plan_id: string; p_to_draft?: boolean }
        Returns: undefined
      }
      dismiss_learning_today_term: { Args: never; Returns: undefined }
      due_account_metric_accounts: {
        Args: {
          p_insights: Json
          p_limit?: number
          p_now?: string
          p_owner_id?: string
          p_x?: Json
        }
        Returns: {
          external_id: string
          owner_id: string
          sns: string
          social_account_id: string
        }[]
      }
      due_post_metric_targets: {
        Args: {
          p_insights: Json
          p_limit?: number
          p_now?: string
          p_owner_id?: string
          p_x?: Json
        }
        Returns: {
          account_external_id: string
          day_index: number
          external_post_id: string
          owner_id: string
          post_target_id: string
          sns: string
          social_account_id: string
        }[]
      }
      due_sns_comment_targets: {
        Args: {
          p_limit?: number
          p_now?: string
          p_owner_id?: string
          p_scopes: Json
        }
        Returns: {
          account_external_id: string
          account_handle: string
          external_post_id: string
          fails: number
          last_count: number
          owner_id: string
          post_target_id: string
          published_at: string
          sns: string
          social_account_id: string
        }[]
      }
      ensure_active_goal: {
        Args: { p_owner_id: string; p_project_id: string; p_starts_on: string }
        Returns: string
      }
      expire_link_domains: { Args: never; Returns: number }
      format_series_valid: { Args: { p: Json }; Returns: boolean }
      format_var_modes: { Args: { p_series: Json }; Returns: Json }
      goal_metric_total: {
        Args: {
          p_action: string
          p_from: string
          p_metric: string
          p_project_id: string
          p_sns: unknown
          p_to: string
        }
        Returns: {
          available: boolean
          counted_through: string
          value: number
        }[]
      }
      goal_metric_valid: {
        Args: {
          p_action: string
          p_metric: string
          p_role: string
          p_sns: unknown
        }
        Returns: boolean
      }
      invoke_job: { Args: { p_path: string }; Returns: number }
      is_manual_sns: { Args: { p_sns: string }; Returns: boolean }
      is_review_sns: { Args: { p_sns: string }; Returns: boolean }
      issue_media_upload_ticket: {
        Args: { p_owner_id: string; p_storage_path: string }
        Returns: string
      }
      issue_video_upload_ticket: {
        Args: {
          p_owner_id: string
          p_scope_owner?: string
          p_storage_path: string
        }
        Returns: string
      }
      learning_today_jst: { Args: never; Returns: string }
      learning_today_term: { Args: { p_term_key: string }; Returns: string }
      link_click_totals: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          clicks_30d: number
          clicks_7d: number
          clicks_total: number
          excluded_total: number
          link_id: string
        }[]
      }
      link_clicks_by_sns: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          last_30d: number
          last_week: number
          sns: string
          this_week: number
        }[]
      }
      link_clicks_by_sns_period: {
        Args: { p_days: number; p_project_id: string; p_today: string }
        Returns: {
          clicks_now: number
          clicks_prev: number
          last_30d: number
          sns: string
        }[]
      }
      mark_manual_target_posted: {
        Args: { p_target_id: string; p_url?: string }
        Returns: undefined
      }
      mark_sns_comments_seen: {
        Args: { p_post_id?: string; p_project_id: string }
        Returns: number
      }
      media_usage_bytes: { Args: { p_owner_id: string }; Returns: number }
      metrics_period_totals: {
        Args: { p_days: number; p_project_id: string; p_today: string }
        Returns: {
          downloads_now: number
          downloads_prev: number
          followers_ago: number
          followers_now: number
          has_account_metrics: boolean
          has_post_metrics: boolean
          manual_views_now: number
          manual_views_prev: number
          page_views_now: number
          page_views_prev: number
          published_now: number
          published_prev: number
          revenue_currency: string
          revenue_latest: number
          revenue_week_ago: number
          views_now: number
          views_prev: number
        }[]
      }
      my_x_metrics_spend_this_month: { Args: never; Returns: number }
      operator_auto_post_holds: {
        Args: never
        Returns: {
          email: string
          held_at: string
          held_by: string
          hold_id: string
          reason: string
        }[]
      }
      operator_hold_auto_post: {
        Args: { p_by: string; p_email: string; p_reason: string }
        Returns: {
          already_held: boolean
          canceled_runs: number
          hold_id: string
        }[]
      }
      operator_release_auto_post: {
        Args: { p_by: string; p_email: string; p_reason: string }
        Returns: {
          hold_id: string
          released: boolean
        }[]
      }
      operator_user_by_email: { Args: { p_email: string }; Returns: string }
      post_counts_by_day: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          day: string
          project_id: string
          published: number
          scheduled: number
          sns: string
        }[]
      }
      post_target_approval_fingerprint: {
        Args: { p_target_id: string }
        Returns: string
      }
      post_target_text: {
        Args: { p_hashtags: string[]; p_text: string }
        Returns: string
      }
      posting_time_trends: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          avg_views: number
          band: string
          clicks: number
          posts: number
        }[]
      }
      project_step_flags: {
        Args: { p_project_id: string; p_week_start: string }
        Returns: {
          has_published: boolean
          has_roadmap: boolean
          project_id: string
          this_week_carried: number
          this_week_done: number
          this_week_todo: number
        }[]
      }
      purge_expired_data: {
        Args: never
        Returns: {
          ai_threads_deleted: number
          ai_usage_deleted: number
          sns_api_usage_deleted: number
        }[]
      }
      record_learning_term_read: {
        Args: { p_term_key: string }
        Returns: undefined
      }
      record_link_click: {
        Args: {
          p_country: string
          p_dedupe_minutes?: number
          p_device: string
          p_excluded: string
          p_ip: string
          p_link_id: string
          p_user_agent: string
        }
        Returns: string
      }
      replace_goal_kpis_internal: {
        Args: {
          p_goal_id: string
          p_kpis: Json
          p_owner_id: string
          p_role: string
        }
        Returns: undefined
      }
      requeue_failed_targets: {
        Args: { p_post_id: string; p_sns: string[] }
        Returns: number
      }
      reserve_ai_images: {
        Args: {
          p_as_of?: string
          p_auto?: boolean
          p_cost_usd: number
          p_images: number
          p_model: string
          p_owner_id: string
          p_project_id: string
          p_scope_owner?: string
        }
        Returns: {
          global_month_usd: number
          job_id: string
          new_until: string
          status: string
          user_month_images: number
          user_monthly_limit: number
        }[]
      }
      reserve_ai_usage: {
        Args: {
          p_as_of?: string
          p_cost_usd: number
          p_owner_id: string
          p_purpose: string
          p_scope_owner?: string
          p_thread_id?: string
        }
        Returns: {
          global_month_usd: number
          new_until: string
          status: string
          usage_id: string
        }[]
      }
      reserve_auto_sample: { Args: { p_owner_id: string }; Returns: string }
      reserve_sns_read: {
        Args: {
          p_budget_usd: number
          p_cost_usd: number
          p_daily_limit: number
          p_owner_id: string
          p_post_target_id: string
          p_scope_owner?: string
          p_sns: unknown
          p_user_budget_usd?: number
        }
        Returns: string
      }
      reserve_sns_spend: {
        Args: {
          p_budget_usd: number
          p_cost_usd: number
          p_operation: string
          p_owner_id: string
          p_post_target_id: string
          p_scope_owner?: string
          p_sns: unknown
          p_user_budget_usd?: number
        }
        Returns: string
      }
      reserve_x_metrics_read: {
        Args: {
          p_budget_usd: number
          p_cost_usd: number
          p_operation: string
          p_owner_id: string
          p_post_target_id: string
          p_scope_owner?: string
          p_user_budget_usd: number
        }
        Returns: string
      }
      reserve_x_search: {
        Args: {
          p_as_of?: string
          p_owner_id: string
          p_project_id: string
          p_scope_owner?: string
        }
        Returns: {
          limit_count: number
          resets_on: string
          status: string
          usage_id: string
          used: number
        }[]
      }
      reserve_youtube_upload: {
        Args: {
          p_owner_id: string
          p_post_target_id: string
          p_scope_owner?: string
        }
        Returns: string
      }
      review_auto_run: {
        Args: { p_fingerprints?: Json; p_run_id: string; p_send: boolean }
        Returns: undefined
      }
      revise_goal: {
        Args: {
          p_ends_on: string
          p_goal_id: string
          p_milestones: Json
          p_statement: string
          p_target: number
        }
        Returns: undefined
      }
      roadmap_daily_totals: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          day: string
          link_clicks: number
          posts: number
        }[]
      }
      roadmap_item_progress: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          item_id: string
          linked_published: number
          linked_scheduled: number
          published: number
          scheduled: number
        }[]
      }
      save_account_plan_section: {
        Args: {
          p_project_id: string
          p_section: string
          p_source?: string
          p_value: Json
        }
        Returns: undefined
      }
      save_auto_plan: {
        Args: {
          p_consent: boolean
          p_image?: Json
          p_instructions: Json
          p_kind: string
          p_lead_hours: number
          p_materials: Json
          p_name: string
          p_plan_id: string
          p_project_id: string
          p_schedule: Json
          p_targets: Json
          p_x_link: string
        }
        Returns: string
      }
      save_post: {
        Args: {
          p_body: string
          p_planned_at: string
          p_post_id: string
          p_project_id: string
          p_status: string
          p_targets: Json
          p_text_origin?: string
        }
        Returns: string
      }
      set_auto_plan_instructions: {
        Args: { p_instructions: Json; p_plan_id: string }
        Returns: Json
      }
      set_auto_plan_status: {
        Args: {
          p_plan_id: string
          p_project_id: string
          p_status: string
          p_to_draft?: boolean
        }
        Returns: number
      }
      set_goal_kpis: {
        Args: { p_kpis: Json; p_project_id: string; p_role: string }
        Returns: string
      }
      settle_goal: { Args: { p_goal_id: string }; Returns: string }
      skip_next_auto_run: { Args: { p_plan_id: string }; Returns: string }
      skip_scheduled_auto_run: { Args: { p_run_id: string }; Returns: string }
      sns_spend_this_month: {
        Args: { p_owner_id?: string; p_sns: unknown }
        Returns: number
      }
      sns_weekly_totals: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          followers_now: number
          followers_week_ago: number
          has_account_metrics: boolean
          has_post_metrics: boolean
          views_last_week: number
          views_this_week: number
        }[]
      }
      start_goal: {
        Args: {
          p_actions: Json
          p_goal: Json
          p_kpis: Json
          p_milestones: Json
          p_project_id: string
          p_source: string
        }
        Returns: string
      }
      start_milestone: {
        Args: { p_project_id: string; p_target: number }
        Returns: string
      }
      storage_upload_allowed: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      store_period_totals: {
        Args: { p_days: number; p_end: string; p_project_id: string }
        Returns: {
          downloads_now: number
          downloads_prev: number
          page_views_now: number
          page_views_prev: number
        }[]
      }
      store_weekly_totals: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          downloads_last_week: number
          downloads_this_week: number
          page_views_last_week: number
          page_views_this_week: number
          revenue_currency: string
          revenue_latest: number
          revenue_week_ago: number
        }[]
      }
      switch_project_sns_account: {
        Args: { p_account_id: string; p_owner_id: string; p_project_id: string }
        Returns: {
          moved_targets: number
          old_account_id: string
          old_display_name: string
          old_handle: string
          still_used: boolean
        }[]
      }
      time_band_of: { Args: { p_at: string }; Returns: string }
      top_posts_by_clicks: {
        Args: {
          p_days?: number
          p_limit?: number
          p_project_id: string
          p_today: string
        }
        Returns: {
          clicks: number
          post_id: string
        }[]
      }
      top_posts_by_views: {
        Args: {
          p_days?: number
          p_limit?: number
          p_project_id: string
          p_today: string
        }
        Returns: {
          post_id: string
          views: number
        }[]
      }
      video_orphan_bytes: { Args: { p_owner_id: string }; Returns: number }
      video_upload_check: {
        Args: { p_owner_id: string; p_scope_owner?: string }
        Returns: string
      }
      weekly_post_totals: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          manual_views_last_week: number
          manual_views_this_week: number
          published_last_week: number
          published_this_week: number
        }[]
      }
      x_metrics_room: {
        Args: {
          p_budget_usd: number
          p_cost_usd: number
          p_owner_id: string
          p_scope_owner: string
          p_user_budget_usd: number
        }
        Returns: boolean
      }
      x_post_spend_this_month: { Args: { p_owner_id: string }; Returns: number }
      x_search_quota: {
        Args: { p_as_of?: string; p_owner_id: string; p_scope_owner?: string }
        Returns: {
          limit_count: number
          resets_on: string
          status: string
          used: number
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

