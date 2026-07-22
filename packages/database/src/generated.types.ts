// Generated from the local Supabase schema. Regenerate with `pnpm db:types`.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          locale: string;
          timezone: string;
          country_code: string;
          onboarding_status: 'not_started' | 'in_progress' | 'complete';
          account_status: 'active' | 'suspended' | 'closed';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          locale?: string;
          timezone?: string;
          country_code?: string;
          onboarding_status?: 'not_started' | 'in_progress' | 'complete';
          account_status?: 'active' | 'suspended' | 'closed';
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          code: string;
          tier_code: 'plus' | 'pro';
          name: string;
          billing_period: 'monthly' | 'annual';
          currency: string;
          price_minor: number;
          active: boolean;
          display_order: number;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['plans']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['plans']['Insert']>;
        Relationships: [];
      };
      plan_entitlements: {
        Row: {
          plan_id: string;
          entitlement_key: string;
          value: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          plan_id: string;
          entitlement_key: string;
          value: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['plan_entitlements']['Insert']>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_id: string;
          status: 'pending_activation' | 'active' | 'expired' | 'cancelled' | 'suspended';
          starts_at: string;
          ends_at: string | null;
          source: 'manual_payment' | 'admin_grant' | 'migration' | 'promotion';
          activation_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['subscriptions']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['subscriptions']['Insert']>;
        Relationships: [];
      };
      feature_flags: {
        Row: {
          id: string;
          key: string;
          description: string;
          default_enabled: boolean;
          client_exposed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['feature_flags']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['feature_flags']['Insert']>;
        Relationships: [];
      };
      feature_flag_rules: {
        Row: {
          id: string;
          feature_id: string;
          enabled: boolean;
          priority: number;
          environment: string | null;
          plan_code: string | null;
          platform: 'web' | 'ios' | 'android' | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['feature_flag_rules']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['feature_flag_rules']['Insert']>;
        Relationships: [];
      };
      platform_settings: {
        Row: {
          id: string;
          environment: string;
          platform: 'web' | 'ios' | 'android';
          status: 'planned' | 'active' | 'maintenance' | 'retired';
          minimum_version: string | null;
          latest_version: string | null;
          force_update: boolean;
          maintenance_mode: boolean;
          api_compatibility_version: number;
          announcement: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['platform_settings']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['platform_settings']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      get_my_admin_access: {
        Args: Record<PropertyKey, never>;
        Returns: { roles: string[]; permissions: string[] }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
