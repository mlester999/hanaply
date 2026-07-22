export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          status: Database["public"]["Enums"]["admin_membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          status?: Database["public"]["Enums"]["admin_membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          status?: Database["public"]["Enums"]["admin_membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          code: string
          created_at: string
          description: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
        }
        Relationships: []
      }
      admin_role_assignments: {
        Row: {
          admin_user_id: string
          assigned_by: string | null
          created_at: string
          role_id: string
        }
        Insert: {
          admin_user_id: string
          assigned_by?: string | null
          created_at?: string
          role_id: string
        }
        Update: {
          admin_user_id?: string
          assigned_by?: string | null
          created_at?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_assignments_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_memberships"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_role_permissions: {
        Row: {
          created_at: string
          permission_code: string
          role_id: string
        }
        Insert: {
          created_at?: string
          permission_code: string
          role_id: string
        }
        Update: {
          created_at?: string
          permission_code?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "admin_permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "admin_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_roles: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          name: string
          system_role: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          name: string
          system_role?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          system_role?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json
          request_id: string | null
          target_id: string | null
          target_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          request_id?: string | null
          target_id?: string | null
          target_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          request_id?: string | null
          target_id?: string | null
          target_type?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      branding_settings: {
        Row: {
          brand_name: string
          created_at: string
          environment: string
          id: string
          logo_path: string | null
          support_email: string | null
          tagline: string
          theme_overrides: Json
          updated_at: string
        }
        Insert: {
          brand_name?: string
          created_at?: string
          environment: string
          id?: string
          logo_path?: string | null
          support_email?: string | null
          tagline?: string
          theme_overrides?: Json
          updated_at?: string
        }
        Update: {
          brand_name?: string
          created_at?: string
          environment?: string
          id?: string
          logo_path?: string | null
          support_email?: string | null
          tagline?: string
          theme_overrides?: Json
          updated_at?: string
        }
        Relationships: []
      }
      entitlement_definitions: {
        Row: {
          constraints: Json
          created_at: string
          default_value: Json
          description: string
          key: string
          unit: string | null
          updated_at: string
          value_type: Database["public"]["Enums"]["entitlement_value_type"]
        }
        Insert: {
          constraints?: Json
          created_at?: string
          default_value: Json
          description: string
          key: string
          unit?: string | null
          updated_at?: string
          value_type: Database["public"]["Enums"]["entitlement_value_type"]
        }
        Update: {
          constraints?: Json
          created_at?: string
          default_value?: Json
          description?: string
          key?: string
          unit?: string | null
          updated_at?: string
          value_type?: Database["public"]["Enums"]["entitlement_value_type"]
        }
        Relationships: []
      }
      feature_flag_rules: {
        Row: {
          created_at: string
          enabled: boolean
          environment: string | null
          feature_id: string
          id: string
          plan_code: string | null
          platform: Database["public"]["Enums"]["platform_kind"] | null
          priority: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled: boolean
          environment?: string | null
          feature_id: string
          id?: string
          plan_code?: string | null
          platform?: Database["public"]["Enums"]["platform_kind"] | null
          priority: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          environment?: string | null
          feature_id?: string
          id?: string
          plan_code?: string | null
          platform?: Database["public"]["Enums"]["platform_kind"] | null
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_rules_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_rules_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      feature_flags: {
        Row: {
          client_exposed: boolean
          created_at: string
          default_enabled: boolean
          description: string
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          client_exposed?: boolean
          created_at?: string
          default_enabled?: boolean
          description: string
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          client_exposed?: boolean
          created_at?: string
          default_enabled?: boolean
          description?: string
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      plan_entitlements: {
        Row: {
          created_at: string
          entitlement_key: string
          plan_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          entitlement_key: string
          plan_id: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          entitlement_key?: string
          plan_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_entitlement_key_fkey"
            columns: ["entitlement_key"]
            isOneToOne: false
            referencedRelation: "entitlement_definitions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          billing_period: Database["public"]["Enums"]["billing_period"]
          code: string
          created_at: string
          currency: string
          display_order: number
          id: string
          metadata: Json
          name: string
          price_minor: number
          tier_code: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          billing_period: Database["public"]["Enums"]["billing_period"]
          code: string
          created_at?: string
          currency: string
          display_order?: number
          id?: string
          metadata?: Json
          name: string
          price_minor: number
          tier_code: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          billing_period?: Database["public"]["Enums"]["billing_period"]
          code?: string
          created_at?: string
          currency?: string
          display_order?: number
          id?: string
          metadata?: Json
          name?: string
          price_minor?: number
          tier_code?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          announcement: string | null
          api_compatibility_version: number
          created_at: string
          environment: string
          force_update: boolean
          id: string
          latest_version: string | null
          maintenance_mode: boolean
          minimum_version: string | null
          platform: Database["public"]["Enums"]["platform_kind"]
          status: Database["public"]["Enums"]["platform_lifecycle"]
          updated_at: string
        }
        Insert: {
          announcement?: string | null
          api_compatibility_version?: number
          created_at?: string
          environment: string
          force_update?: boolean
          id?: string
          latest_version?: string | null
          maintenance_mode?: boolean
          minimum_version?: string | null
          platform: Database["public"]["Enums"]["platform_kind"]
          status: Database["public"]["Enums"]["platform_lifecycle"]
          updated_at?: string
        }
        Update: {
          announcement?: string | null
          api_compatibility_version?: number
          created_at?: string
          environment?: string
          force_update?: boolean
          id?: string
          latest_version?: string | null
          maintenance_mode?: boolean
          minimum_version?: string | null
          platform?: Database["public"]["Enums"]["platform_kind"]
          status?: Database["public"]["Enums"]["platform_lifecycle"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          country_code: string
          created_at: string
          display_name: string | null
          id: string
          locale: string
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          country_code?: string
          created_at?: string
          display_name?: string | null
          id: string
          locale?: string
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          country_code?: string
          created_at?: string
          display_name?: string | null
          id?: string
          locale?: string
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          activation_metadata: Json
          created_at: string
          ends_at: string | null
          id: string
          plan_id: string
          source: Database["public"]["Enums"]["subscription_source"]
          starts_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activation_metadata?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          plan_id: string
          source: Database["public"]["Enums"]["subscription_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activation_metadata?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          plan_id?: string
          source?: Database["public"]["Enums"]["subscription_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_first_super_admin: {
        Args: { confirmation: string; target_user_id: string }
        Returns: boolean
      }
      get_my_admin_access: {
        Args: never
        Returns: {
          permissions: string[]
          roles: string[]
        }[]
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "closed"
      admin_membership_status: "active" | "suspended" | "revoked"
      audit_actor_type: "user" | "admin" | "service" | "system"
      billing_period: "monthly" | "annual"
      entitlement_value_type: "boolean" | "integer" | "string"
      onboarding_status: "not_started" | "in_progress" | "complete"
      plan_tier: "plus" | "pro"
      platform_kind: "web" | "ios" | "android"
      platform_lifecycle: "planned" | "active" | "maintenance" | "retired"
      subscription_source:
        | "manual_payment"
        | "admin_grant"
        | "migration"
        | "promotion"
      subscription_status:
        | "pending_activation"
        | "active"
        | "expired"
        | "cancelled"
        | "suspended"
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
      account_status: ["active", "suspended", "closed"],
      admin_membership_status: ["active", "suspended", "revoked"],
      audit_actor_type: ["user", "admin", "service", "system"],
      billing_period: ["monthly", "annual"],
      entitlement_value_type: ["boolean", "integer", "string"],
      onboarding_status: ["not_started", "in_progress", "complete"],
      plan_tier: ["plus", "pro"],
      platform_kind: ["web", "ios", "android"],
      platform_lifecycle: ["planned", "active", "maintenance", "retired"],
      subscription_source: [
        "manual_payment",
        "admin_grant",
        "migration",
        "promotion",
      ],
      subscription_status: [
        "pending_activation",
        "active",
        "expired",
        "cancelled",
        "suspended",
      ],
    },
  },
} as const

