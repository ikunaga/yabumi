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
          created_at: string
          id: string
          owner_id: string
          project_id: string
          purpose: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          project_id: string
          purpose: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          project_id?: string
          purpose?: string
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
          thread_id: string | null
        }
        Insert: {
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
          thread_id?: string | null
        }
        Update: {
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
          alt_text: string
          created_at: string
          height: number
          id: string
          owner_id: string
          position: number
          post_id: string | null
          size_bytes: number
          storage_path: string
          updated_at: string
          width: number
        }
        Insert: {
          alt_text?: string
          created_at?: string
          height: number
          id?: string
          owner_id: string
          position?: number
          post_id?: string | null
          size_bytes: number
          storage_path: string
          updated_at?: string
          width: number
        }
        Update: {
          alt_text?: string
          created_at?: string
          height?: number
          id?: string
          owner_id?: string
          position?: number
          post_id?: string | null
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_files_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      media_upload_tickets: {
        Row: {
          created_at: string
          owner_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          owner_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          owner_id?: string
          storage_path?: string
        }
        Relationships: []
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
      post_targets: {
        Row: {
          attempts: number
          body_override: string | null
          created_at: string
          error_message: string | null
          external_post_id: string | null
          external_url: string | null
          id: string
          locked_at: string | null
          next_attempt_at: string | null
          owner_id: string
          post_id: string
          preparing_since: string | null
          published_at: string | null
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
          body_override?: string | null
          created_at?: string
          error_message?: string | null
          external_post_id?: string | null
          external_url?: string | null
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          owner_id?: string
          post_id: string
          preparing_since?: string | null
          published_at?: string | null
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
          body_override?: string | null
          created_at?: string
          error_message?: string | null
          external_post_id?: string | null
          external_url?: string | null
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          owner_id?: string
          post_id?: string
          preparing_since?: string | null
          published_at?: string | null
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
          body: string
          created_at: string
          id: string
          owner_id: string
          planned_at: string | null
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          owner_id?: string
          planned_at?: string | null
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          owner_id?: string
          planned_at?: string | null
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_project_id_fkey"
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
          description: string
          github_prompt_dismissed_at: string | null
          id: string
          name: string
          owner_id: string
          play_store_url: string | null
          target_audience: string
          updated_at: string
        }
        Insert: {
          app_store_provider_token?: string | null
          app_store_url?: string | null
          created_at?: string
          description?: string
          github_prompt_dismissed_at?: string | null
          id?: string
          name: string
          owner_id?: string
          play_store_url?: string | null
          target_audience?: string
          updated_at?: string
        }
        Update: {
          app_store_provider_token?: string | null
          app_store_url?: string | null
          created_at?: string
          description?: string
          github_prompt_dismissed_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          play_store_url?: string | null
          target_audience?: string
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_items: {
        Row: {
          created_at: string
          detail: string
          done_at: string | null
          id: string
          kpi: string | null
          owner_id: string
          position: number
          project_id: string
          source: string
          status: string
          target: number | null
          title: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          detail?: string
          done_at?: string | null
          id?: string
          kpi?: string | null
          owner_id?: string
          position?: number
          project_id: string
          source?: string
          status?: string
          target?: number | null
          title: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          detail?: string
          done_at?: string | null
          id?: string
          kpi?: string | null
          owner_id?: string
          position?: number
          project_id?: string
          source?: string
          status?: string
          target?: number | null
          title?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmaps: {
        Row: {
          created_at: string
          kgi: Json | null
          kpi_targets: Json
          owner_id: string
          project_id: string
          source: string
          started_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          kgi?: Json | null
          kpi_targets?: Json
          owner_id?: string
          project_id: string
          source?: string
          started_on?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          kgi?: Json | null
          kpi_targets?: Json
          owner_id?: string
          project_id?: string
          source?: string
          started_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmaps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_usage_totals: {
        Args: { p_day_start: string; p_month_start: string; p_owner_id: string }
        Returns: {
          global_month_usd: number
          owner_month_usd: number
          owner_today_count: number
        }[]
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
      claim_token_refresh: {
        Args: { p_lease_seconds?: number; p_social_account_id: string }
        Returns: {
          access_token_encrypted: string
          expires_at: string
          refresh_token_encrypted: string
        }[]
      }
      cleanup_media_candidates: {
        Args: { p_limit?: number; p_owner_id?: string }
        Returns: {
          media_id: string
          storage_path: string
        }[]
      }
      due_account_metric_accounts: {
        Args: { p_limit?: number; p_now?: string; p_owner_id?: string }
        Returns: {
          external_id: string
          owner_id: string
          sns: string
          social_account_id: string
        }[]
      }
      due_post_metric_targets: {
        Args: { p_limit?: number; p_now?: string; p_owner_id?: string }
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
      invoke_job: { Args: { p_path: string }; Returns: number }
      is_manual_sns: { Args: { p_sns: string }; Returns: boolean }
      issue_media_upload_ticket: {
        Args: {
          p_max_file_bytes: number
          p_max_pending: number
          p_max_unattached: number
          p_owner_id: string
          p_quota_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
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
      mark_manual_target_posted: {
        Args: { p_target_id: string; p_url?: string }
        Returns: undefined
      }
      media_usage_bytes: { Args: { p_owner_id: string }; Returns: number }
      purge_expired_data: {
        Args: never
        Returns: {
          ai_threads_deleted: number
          ai_usage_deleted: number
          sns_api_usage_deleted: number
        }[]
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
      requeue_failed_targets: {
        Args: { p_post_id: string; p_sns: string[] }
        Returns: number
      }
      reserve_sns_read: {
        Args: {
          p_budget_usd: number
          p_cost_usd: number
          p_daily_limit: number
          p_owner_id: string
          p_post_target_id: string
          p_scope_owner?: string
          p_sns: unknown
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
        }
        Returns: string
      }
      roadmap_daily_totals: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          day: string
          link_clicks: number
          posts: number
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
      save_post: {
        Args: {
          p_body: string
          p_planned_at: string
          p_post_id: string
          p_project_id: string
          p_status: string
          p_targets: Json
        }
        Returns: string
      }
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
      store_weekly_totals: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          downloads_last_week: number
          downloads_this_week: number
          revenue_currency: string
          revenue_latest: number
          revenue_week_ago: number
        }[]
      }
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
      weekly_post_totals: {
        Args: { p_project_id: string; p_today: string }
        Returns: {
          manual_views_last_week: number
          manual_views_this_week: number
          published_last_week: number
          published_this_week: number
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

