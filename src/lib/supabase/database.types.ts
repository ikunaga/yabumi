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
          owner_id: string
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
          owner_id: string
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
          owner_id?: string
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
          updated_at: string
        }
        Insert: {
          account_login: string
          account_type?: string
          created_at?: string
          installation_id: number
          owner_id: string
          updated_at?: string
        }
        Update: {
          account_login?: string
          account_type?: string
          created_at?: string
          installation_id?: number
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
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
          published_at: string | null
          sns: string
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
          published_at?: string | null
          sns: string
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
          published_at?: string | null
          sns?: string
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
      social_account_tokens: {
        Row: {
          access_token_encrypted: string
          expires_at: string | null
          refresh_token_encrypted: string | null
          scopes: string[]
          social_account_id: string
          updated_at: string
        }
        Insert: {
          access_token_encrypted: string
          expires_at?: string | null
          refresh_token_encrypted?: string | null
          scopes?: string[]
          social_account_id: string
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string
          expires_at?: string | null
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
          sns?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_due_targets: {
        Args: { p_limit?: number; p_post_id?: string }
        Returns: {
          account_external_id: string
          account_status: string
          attempts: number
          body: string
          post_id: string
          sns: string
          social_account_id: string
          target_id: string
        }[]
      }
      invoke_job: { Args: { p_path: string }; Returns: number }
      is_manual_sns: { Args: { p_sns: string }; Returns: boolean }
      mark_manual_target_posted: {
        Args: { p_target_id: string; p_url?: string }
        Returns: undefined
      }
      requeue_failed_targets: {
        Args: { p_post_id: string; p_sns: string[] }
        Returns: number
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

