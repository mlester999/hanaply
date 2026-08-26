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
      account_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_status: Database["public"]["Enums"]["account_status"]
          previous_status: Database["public"]["Enums"]["account_status"]
          reason: string
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status: Database["public"]["Enums"]["account_status"]
          previous_status: Database["public"]["Enums"]["account_status"]
          reason: string
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status?: Database["public"]["Enums"]["account_status"]
          previous_status?: Database["public"]["Enums"]["account_status"]
          reason?: string
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      account_suspensions: {
        Row: {
          id: string
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          suspended_at: string
          suspended_by: string
          user_id: string
        }
        Insert: {
          id?: string
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          suspended_at?: string
          suspended_by: string
          user_id: string
        }
        Update: {
          id?: string
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          suspended_at?: string
          suspended_by?: string
          user_id?: string
        }
        Relationships: []
      }
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
      authentication_events: {
        Row: {
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json
          occurred_at: string
          outcome: string
          request_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          occurred_at?: string
          outcome: string
          request_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          occurred_at?: string
          outcome?: string
          request_id?: string | null
          user_agent?: string | null
          user_id?: string | null
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
      email_delivery_events: {
        Row: {
          category: string
          created_at: string
          failure_code: string | null
          id: string
          idempotency_key_hash: string
          metadata: Json
          provider: string
          provider_message_id: string | null
          status: string
          template_id: string
          template_version: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key_hash: string
          metadata?: Json
          provider: string
          provider_message_id?: string | null
          status: string
          template_id: string
          template_version: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key_hash?: string
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          status?: string
          template_id?: string
          template_version?: string
          updated_at?: string
          user_id?: string | null
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
      entitlement_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          effective_at: string
          event_type: string
          id: string
          new_state: Json
          payment_submission_id: string | null
          plan_id: string
          previous_state: Json
          request_id: string | null
          subscription_id: string
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          effective_at: string
          event_type: string
          id?: string
          new_state?: Json
          payment_submission_id?: string | null
          plan_id: string
          previous_state?: Json
          request_id?: string | null
          subscription_id: string
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          effective_at?: string
          event_type?: string
          id?: string
          new_state?: Json
          payment_submission_id?: string | null
          plan_id?: string
          previous_state?: Json
          request_id?: string | null
          subscription_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_events_payment_submission_id_fkey"
            columns: ["payment_submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
      payment_method_versions: {
        Row: {
          change_type: string
          changed_by: string | null
          created_at: string
          id: string
          payment_method_id: string
          request_id: string | null
          snapshot: Json
          version: number
        }
        Insert: {
          change_type: string
          changed_by?: string | null
          created_at?: string
          id?: string
          payment_method_id: string
          request_id?: string | null
          snapshot: Json
          version: number
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          payment_method_id?: string
          request_id?: string | null
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_versions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          account_holder_name: string | null
          account_identifier: string | null
          archived_at: string | null
          bank_name: string | null
          branch_details: string | null
          created_at: string
          created_by: string | null
          currency: string
          display_name: string
          display_order: number
          effective_end_at: string | null
          effective_start_at: string | null
          enabled: boolean
          id: string
          maximum_amount_minor: number | null
          method_type: Database["public"]["Enums"]["payment_method_type"]
          minimum_amount_minor: number | null
          private_notes: string | null
          public_instructions: string
          public_notes: string | null
          qr_checksum_sha256: string | null
          qr_height: number | null
          qr_mime_type: string | null
          qr_object_path: string | null
          qr_size_bytes: number | null
          qr_version: number
          qr_width: number | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          account_holder_name?: string | null
          account_identifier?: string | null
          archived_at?: string | null
          bank_name?: string | null
          branch_details?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          display_name: string
          display_order?: number
          effective_end_at?: string | null
          effective_start_at?: string | null
          enabled?: boolean
          id?: string
          maximum_amount_minor?: number | null
          method_type: Database["public"]["Enums"]["payment_method_type"]
          minimum_amount_minor?: number | null
          private_notes?: string | null
          public_instructions: string
          public_notes?: string | null
          qr_checksum_sha256?: string | null
          qr_height?: number | null
          qr_mime_type?: string | null
          qr_object_path?: string | null
          qr_size_bytes?: number | null
          qr_version?: number
          qr_width?: number | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          account_holder_name?: string | null
          account_identifier?: string | null
          archived_at?: string | null
          bank_name?: string | null
          branch_details?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          display_name?: string
          display_order?: number
          effective_end_at?: string | null
          effective_start_at?: string | null
          enabled?: boolean
          id?: string
          maximum_amount_minor?: number | null
          method_type?: Database["public"]["Enums"]["payment_method_type"]
          minimum_amount_minor?: number | null
          private_notes?: string | null
          public_instructions?: string
          public_notes?: string | null
          qr_checksum_sha256?: string | null
          qr_height?: number | null
          qr_mime_type?: string | null
          qr_object_path?: string | null
          qr_size_bytes?: number | null
          qr_version?: number
          qr_width?: number | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      payment_notifications: {
        Row: {
          attempts: number
          available_at: string
          claim_token: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          failure_code: string | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          payment_submission_id: string | null
          provider_message_id: string | null
          status: string
          subscription_id: string | null
          template_id: string
          template_version: string
          updated_at: string
          user_id: string
          variables: Json
        }
        Insert: {
          attempts?: number
          available_at?: string
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          payment_submission_id?: string | null
          provider_message_id?: string | null
          status?: string
          subscription_id?: string | null
          template_id: string
          template_version?: string
          updated_at?: string
          user_id: string
          variables?: Json
        }
        Update: {
          attempts?: number
          available_at?: string
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          payment_submission_id?: string | null
          provider_message_id?: string | null
          status?: string
          subscription_id?: string | null
          template_id?: string
          template_version?: string
          updated_at?: string
          user_id?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_notifications_payment_submission_id_fkey"
            columns: ["payment_submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_notifications_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          created_at: string
          external_reference: string | null
          id: string
          internal_note: string | null
          reason: string
          recorded_by: string | null
          refunded_amount_minor: number
          refunded_at: string
          request_id: string | null
          submission_id: string
          subscription_impact: Database["public"]["Enums"]["payment_subscription_impact"]
        }
        Insert: {
          created_at?: string
          external_reference?: string | null
          id?: string
          internal_note?: string | null
          reason: string
          recorded_by?: string | null
          refunded_amount_minor: number
          refunded_at: string
          request_id?: string | null
          submission_id: string
          subscription_impact: Database["public"]["Enums"]["payment_subscription_impact"]
        }
        Update: {
          created_at?: string
          external_reference?: string | null
          id?: string
          internal_note?: string | null
          reason?: string
          recorded_by?: string | null
          refunded_amount_minor?: number
          refunded_at?: string
          request_id?: string | null
          submission_id?: string
          subscription_impact?: Database["public"]["Enums"]["payment_subscription_impact"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_review_assignments: {
        Row: {
          assigned_at: string
          id: string
          lock_expires_at: string
          release_reason: string | null
          released_at: string | null
          request_id: string | null
          reviewer_id: string
          submission_id: string
        }
        Insert: {
          assigned_at?: string
          id?: string
          lock_expires_at: string
          release_reason?: string | null
          released_at?: string | null
          request_id?: string | null
          reviewer_id: string
          submission_id: string
        }
        Update: {
          assigned_at?: string
          id?: string
          lock_expires_at?: string
          release_reason?: string | null
          released_at?: string | null
          request_id?: string | null
          reviewer_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_review_assignments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_review_flags: {
        Row: {
          created_at: string
          details: Json
          flag_type: Database["public"]["Enums"]["payment_review_flag_type"]
          id: string
          matched_submission_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          submission_id: string
          warning: string
        }
        Insert: {
          created_at?: string
          details?: Json
          flag_type: Database["public"]["Enums"]["payment_review_flag_type"]
          id?: string
          matched_submission_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          submission_id: string
          warning: string
        }
        Update: {
          created_at?: string
          details?: Json
          flag_type?: Database["public"]["Enums"]["payment_review_flag_type"]
          id?: string
          matched_submission_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          submission_id?: string
          warning?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_review_flags_matched_submission_id_fkey"
            columns: ["matched_submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_review_flags_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_submission_events: {
        Row: {
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          internal_note: string | null
          new_status:
            | Database["public"]["Enums"]["payment_submission_status"]
            | null
          previous_status:
            | Database["public"]["Enums"]["payment_submission_status"]
            | null
          public_message: string | null
          reason_code: string | null
          request_id: string | null
          snapshot: Json
          submission_id: string
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          internal_note?: string | null
          new_status?:
            | Database["public"]["Enums"]["payment_submission_status"]
            | null
          previous_status?:
            | Database["public"]["Enums"]["payment_submission_status"]
            | null
          public_message?: string | null
          reason_code?: string | null
          request_id?: string | null
          snapshot?: Json
          submission_id: string
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          internal_note?: string | null
          new_status?:
            | Database["public"]["Enums"]["payment_submission_status"]
            | null
          previous_status?:
            | Database["public"]["Enums"]["payment_submission_status"]
            | null
          public_message?: string | null
          reason_code?: string | null
          request_id?: string | null
          snapshot?: Json
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_submission_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_submission_files: {
        Row: {
          active: boolean
          checksum_sha256: string
          created_at: string
          height: number
          id: string
          mime_type: string
          object_path: string
          original_filename: string
          replaced_at: string | null
          scan_status: string
          size_bytes: number
          submission_id: string
          uploaded_by: string
          width: number
        }
        Insert: {
          active?: boolean
          checksum_sha256: string
          created_at?: string
          height: number
          id?: string
          mime_type: string
          object_path: string
          original_filename: string
          replaced_at?: string | null
          scan_status?: string
          size_bytes: number
          submission_id: string
          uploaded_by: string
          width: number
        }
        Update: {
          active?: boolean
          checksum_sha256?: string
          created_at?: string
          height?: number
          id?: string
          mime_type?: string
          object_path?: string
          original_filename?: string
          replaced_at?: string | null
          scan_status?: string
          size_bytes?: number
          submission_id?: string
          uploaded_by?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_submissions: {
        Row: {
          approval_transaction_id: string | null
          billing_period: Database["public"]["Enums"]["billing_period"]
          created_at: string
          currency: string
          declaration_accepted_at: string | null
          duplicate_proof: boolean
          duplicate_reference: boolean
          id: string
          information_response: string | null
          internal_review_note: string | null
          normalized_reference: string | null
          original_reference: string | null
          paid_at: string | null
          payment_method_id: string
          payment_method_snapshot: Json
          payment_method_version: number
          plan_id: string
          proof_file_id: string | null
          public_review_message: string | null
          quoted_amount_minor: number
          rejection_reason_code: string | null
          review_lock_expires_at: string | null
          review_started_at: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["payment_submission_status"]
          submitted_at: string | null
          subscription_id: string | null
          updated_at: string
          user_id: string
          user_note: string | null
          version: number
        }
        Insert: {
          approval_transaction_id?: string | null
          billing_period: Database["public"]["Enums"]["billing_period"]
          created_at?: string
          currency: string
          declaration_accepted_at?: string | null
          duplicate_proof?: boolean
          duplicate_reference?: boolean
          id?: string
          information_response?: string | null
          internal_review_note?: string | null
          normalized_reference?: string | null
          original_reference?: string | null
          paid_at?: string | null
          payment_method_id: string
          payment_method_snapshot: Json
          payment_method_version: number
          plan_id: string
          proof_file_id?: string | null
          public_review_message?: string | null
          quoted_amount_minor: number
          rejection_reason_code?: string | null
          review_lock_expires_at?: string | null
          review_started_at?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["payment_submission_status"]
          submitted_at?: string | null
          subscription_id?: string | null
          updated_at?: string
          user_id: string
          user_note?: string | null
          version?: number
        }
        Update: {
          approval_transaction_id?: string | null
          billing_period?: Database["public"]["Enums"]["billing_period"]
          created_at?: string
          currency?: string
          declaration_accepted_at?: string | null
          duplicate_proof?: boolean
          duplicate_reference?: boolean
          id?: string
          information_response?: string | null
          internal_review_note?: string | null
          normalized_reference?: string | null
          original_reference?: string | null
          paid_at?: string | null
          payment_method_id?: string
          payment_method_snapshot?: Json
          payment_method_version?: number
          plan_id?: string
          proof_file_id?: string | null
          public_review_message?: string | null
          quoted_amount_minor?: number
          rejection_reason_code?: string | null
          review_lock_expires_at?: string | null
          review_started_at?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["payment_submission_status"]
          submitted_at?: string | null
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
          user_note?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_submissions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_proof_file_fk"
            columns: ["proof_file_id"]
            isOneToOne: false
            referencedRelation: "payment_submission_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_submissions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
          email_verified_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          last_password_changed_at: string | null
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
          email_verified_at?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          last_password_changed_at?: string | null
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
          email_verified_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_password_changed_at?: string | null
          locale?: string
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_corrections: {
        Row: {
          after_state: Json
          before_state: Json
          corrected_by: string | null
          created_at: string
          id: string
          internal_note: string | null
          reason: string
          request_id: string | null
          subscription_id: string
        }
        Insert: {
          after_state: Json
          before_state: Json
          corrected_by?: string | null
          created_at?: string
          id?: string
          internal_note?: string | null
          reason: string
          request_id?: string | null
          subscription_id: string
        }
        Update: {
          after_state?: Json
          before_state?: Json
          corrected_by?: string | null
          created_at?: string
          id?: string
          internal_note?: string | null
          reason?: string
          request_id?: string | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_corrections_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id: string | null
          created_at: string
          effective_at: string
          event_type: string
          id: string
          new_state: Json
          payment_submission_id: string | null
          previous_state: Json
          reason: string | null
          request_id: string | null
          subscription_id: string
          user_id: string
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id?: string | null
          created_at?: string
          effective_at: string
          event_type: string
          id?: string
          new_state?: Json
          payment_submission_id?: string | null
          previous_state?: Json
          reason?: string | null
          request_id?: string | null
          subscription_id: string
          user_id: string
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          actor_user_id?: string | null
          created_at?: string
          effective_at?: string
          event_type?: string
          id?: string
          new_state?: Json
          payment_submission_id?: string | null
          previous_state?: Json
          reason?: string | null
          request_id?: string | null
          subscription_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_payment_submission_id_fkey"
            columns: ["payment_submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
          version: number
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
          version?: number
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
          version?: number
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
      user_legal_acceptances: {
        Row: {
          accepted_at: string
          created_at: string
          id: string
          policy_type: string
          policy_version: string
          source: string
          user_id: string
        }
        Insert: {
          accepted_at: string
          created_at?: string
          id?: string
          policy_type: string
          policy_version: string
          source: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          id?: string
          policy_type?: string
          policy_version?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notification_preferences: {
        Row: {
          created_at: string
          future_daily_digest: boolean
          future_job_alerts: boolean
          marketing_emails: boolean
          product_updates: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          future_daily_digest?: boolean
          future_job_alerts?: boolean
          marketing_emails?: boolean
          product_updates?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          future_daily_digest?: boolean
          future_job_alerts?: boolean
          marketing_emails?: boolean
          product_updates?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_attach_payment_method_qr: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          requested_checksum_sha256: string
          requested_height: number
          requested_mime_type: string
          requested_object_path: string
          requested_size_bytes: number
          requested_width: number
          target_payment_method_id: string
        }
        Returns: Json
      }
      admin_audit_event_directory: {
        Args: {
          actor_user_id: string
          filter_action?: string
          filter_actor_user_id?: string
          filter_request_id?: string
          filter_target_id?: string
          filter_target_type?: string
          occurred_from?: string
          occurred_to?: string
          page_offset?: number
          page_size?: number
        }
        Returns: {
          action: string
          after_state: Json
          before_state: Json
          created_at: string
          event_actor_type: Database["public"]["Enums"]["audit_actor_type"]
          event_actor_user_id: string
          event_id: string
          metadata: Json
          request_id: string
          target_id: string
          target_type: string
          total_count: number
        }[]
      }
      admin_create_payment_method: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          requested_method: Json
        }
        Returns: string
      }
      admin_overview: {
        Args: { actor_user_id: string }
        Returns: {
          active_administrators: number
          auth_events_last_24_hours: number
          registered_users: number
          suspended_users: number
          verified_users: number
        }[]
      }
      admin_revoke_user_sessions: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          target_user_id: string
        }
        Returns: number
      }
      admin_set_account_status: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          requested_status: Database["public"]["Enums"]["account_status"]
          target_user_id: string
        }
        Returns: boolean
      }
      admin_set_payment_method_state: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          requested_action: string
          target_payment_method_id: string
        }
        Returns: number
      }
      admin_update_payment_method: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          requested_method: Json
          target_payment_method_id: string
        }
        Returns: number
      }
      admin_user_detail: {
        Args: { actor_user_id: string; target_user_id: string }
        Returns: {
          account_status: Database["public"]["Enums"]["account_status"]
          admin_membership_status: string
          admin_roles: string[]
          country_code: string
          created_at: string
          display_name: string
          email: string
          email_verified: boolean
          email_verified_at: string
          first_name: string
          last_name: string
          locale: string
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          subscription_ends_at: string
          subscription_plan_code: string
          subscription_starts_at: string
          subscription_status: string
          timezone: string
          updated_at: string
          user_id: string
        }[]
      }
      admin_user_directory: {
        Args: {
          actor_user_id: string
          created_from?: string
          created_to?: string
          page_offset?: number
          page_size?: number
          search_query?: string
          status_filter?: Database["public"]["Enums"]["account_status"]
          verification_filter?: string
        }
        Returns: {
          account_status: Database["public"]["Enums"]["account_status"]
          admin_roles: string[]
          created_at: string
          display_name: string
          email: string
          email_verified: boolean
          email_verified_at: string
          first_name: string
          last_name: string
          subscription_plan_code: string
          subscription_status: string
          total_count: number
          updated_at: string
          user_id: string
        }[]
      }
      approve_payment_submission: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          internal_note?: string
          target_submission_id: string
        }
        Returns: Json
      }
      attach_payment_proof: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          requested_checksum_sha256: string
          requested_height: number
          requested_mime_type: string
          requested_object_path: string
          requested_original_filename: string
          requested_scan_status?: string
          requested_size_bytes: number
          requested_width: number
          target_submission_id: string
        }
        Returns: Json
      }
      authorize_admin_payment_access: {
        Args: { actor_user_id: string; required_permission: string }
        Returns: boolean
      }
      bootstrap_first_super_admin: {
        Args: {
          confirmation: string
          target_email: string
          target_user_id: string
        }
        Returns: boolean
      }
      cancel_payment_submission: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          target_submission_id: string
        }
        Returns: Json
      }
      claim_payment_notifications: {
        Args: { requested_batch_size?: number; requested_claim_token: string }
        Returns: {
          attempts: number
          id: string
          idempotency_key: string
          payment_submission_id: string
          subscription_id: string
          template_id: string
          template_version: string
          user_id: string
          variables: Json
        }[]
      }
      claim_storage_cleanup_jobs: {
        Args: { requested_batch_size?: number; requested_claim_token: string }
        Returns: {
          attempts: number
          bucket_id: string
          id: string
          object_path: string
        }[]
      }
      complete_payment_notification: {
        Args: {
          requested_attempts: number
          requested_claim_token: string
          requested_failure_code: string
          requested_provider_message_id: string
          requested_status: string
          target_notification_id: string
        }
        Returns: boolean
      }
      complete_storage_cleanup_job: {
        Args: {
          requested_claim_token: string
          requested_error_code?: string
          requested_status: Database["public"]["Enums"]["storage_cleanup_status"]
          target_job_id: string
        }
        Returns: boolean
      }
      consume_auth_rate_limit: {
        Args: { rate_bucket: string; rate_key_hash: string }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
      correct_subscription: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          internal_note?: string
          requested_ends_at: string
          requested_starts_at: string
          restore_reversed?: boolean
          target_subscription_id: string
        }
        Returns: number
      }
      create_payment_draft: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          draft_input: Json
        }
        Returns: string
      }
      expire_subscriptions: {
        Args: { action_request_id?: string; evaluated_at?: string }
        Returns: number
      }
      get_my_admin_access: {
        Args: never
        Returns: {
          permissions: string[]
          roles: string[]
        }[]
      }
      is_auth_session_active: {
        Args: { target_session_id: string; target_user_id: string }
        Returns: boolean
      }
      list_my_sessions: {
        Args: never
        Returns: {
          created_at: string
          current_session: boolean
          last_seen_at: string
          session_id: string
          user_agent: string
        }[]
      }
      queue_storage_cleanup: {
        Args: {
          requested_bucket_id: string
          requested_object_path: string
          requested_reason: string
        }
        Returns: string
      }
      queue_subscription_expiry_reminders: {
        Args: { evaluated_at?: string; reminder_days?: number }
        Returns: number
      }
      reconcile_my_profile: { Args: never; Returns: boolean }
      record_my_auth_event: {
        Args: { requested_event_type: string; requested_request_id?: string }
        Returns: string
      }
      record_payment_refund: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          external_reference: string
          internal_note?: string
          refunded_amount_minor: number
          refunded_at: string
          requested_subscription_impact: Database["public"]["Enums"]["payment_subscription_impact"]
          target_submission_id: string
        }
        Returns: number
      }
      reject_payment_submission: {
        Args: {
          action_reason?: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          internal_note?: string
          public_message: string
          requested_rejection_reason_code: string
          target_submission_id: string
        }
        Returns: number
      }
      release_payment_notification_claim: {
        Args: {
          requested_claim_token: string
          retry_at: string
          target_notification_id: string
        }
        Returns: boolean
      }
      release_storage_cleanup_job: {
        Args: {
          requested_claim_token: string
          retry_at: string
          target_job_id: string
        }
        Returns: boolean
      }
      request_payment_information: {
        Args: {
          action_reason?: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          internal_note?: string
          public_message: string
          reason_category: string
          target_submission_id: string
        }
        Returns: number
      }
      resolve_payment_method_qr_object: {
        Args: {
          actor_user_id: string
          administrator_access?: boolean
          target_payment_method_id: string
        }
        Returns: {
          bucket_id: string
          mime_type: string
          object_path: string
        }[]
      }
      resolve_payment_proof_object: {
        Args: {
          actor_user_id: string
          administrator_access?: boolean
          target_submission_id: string
        }
        Returns: {
          bucket_id: string
          mime_type: string
          object_path: string
          original_filename: string
        }[]
      }
      resubmit_payment_submission: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          declaration_accepted: boolean
          expected_version: number
          requested_response: string
          target_submission_id: string
        }
        Returns: number
      }
      reverse_payment_approval: {
        Args: {
          action_reason: string
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          internal_note?: string
          target_submission_id: string
        }
        Returns: number
      }
      start_payment_review: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          expected_version: number
          target_submission_id: string
        }
        Returns: number
      }
      submit_payment_submission: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          declaration_accepted: boolean
          expected_version: number
          target_submission_id: string
        }
        Returns: number
      }
      update_my_notification_preferences: {
        Args: {
          requested_marketing_emails: boolean
          requested_product_updates: boolean
          requested_request_id?: string
        }
        Returns: {
          created_at: string
          future_daily_digest: boolean
          future_job_alerts: boolean
          marketing_emails: boolean
          product_updates: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_notification_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_payment_draft: {
        Args: {
          action_request_id?: string
          actor_user_id: string
          draft_input: Json
          expected_version: number
          target_submission_id: string
        }
        Returns: number
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "disabled" | "pending_deletion"
      admin_membership_status: "active" | "suspended" | "revoked"
      audit_actor_type: "user" | "admin" | "service" | "system"
      billing_period: "monthly" | "annual"
      entitlement_value_type: "boolean" | "integer" | "string"
      onboarding_status: "not_started" | "in_progress" | "complete"
      payment_method_type: "gcash" | "maya" | "bank_transfer" | "other"
      payment_review_flag_type: "duplicate_reference" | "duplicate_proof"
      payment_submission_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "needs_information"
        | "resubmitted"
        | "approved"
        | "rejected"
        | "cancelled"
        | "expired"
        | "refunded"
        | "reversed"
      payment_subscription_impact: "none" | "end_access_now"
      plan_tier: "plus" | "pro"
      platform_kind: "web" | "ios" | "android"
      platform_lifecycle: "planned" | "active" | "maintenance" | "retired"
      storage_cleanup_status: "pending" | "completed" | "failed"
      subscription_source:
        | "manual_payment"
        | "admin_grant"
        | "migration"
        | "promotion"
      subscription_status:
        | "pending_activation"
        | "active"
        | "grace_period"
        | "expired"
        | "cancelled"
        | "suspended"
        | "refunded"
        | "reversed"
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
      account_status: ["active", "suspended", "disabled", "pending_deletion"],
      admin_membership_status: ["active", "suspended", "revoked"],
      audit_actor_type: ["user", "admin", "service", "system"],
      billing_period: ["monthly", "annual"],
      entitlement_value_type: ["boolean", "integer", "string"],
      onboarding_status: ["not_started", "in_progress", "complete"],
      payment_method_type: ["gcash", "maya", "bank_transfer", "other"],
      payment_review_flag_type: ["duplicate_reference", "duplicate_proof"],
      payment_submission_status: [
        "draft",
        "submitted",
        "under_review",
        "needs_information",
        "resubmitted",
        "approved",
        "rejected",
        "cancelled",
        "expired",
        "refunded",
        "reversed",
      ],
      payment_subscription_impact: ["none", "end_access_now"],
      plan_tier: ["plus", "pro"],
      platform_kind: ["web", "ios", "android"],
      platform_lifecycle: ["planned", "active", "maintenance", "retired"],
      storage_cleanup_status: ["pending", "completed", "failed"],
      subscription_source: [
        "manual_payment",
        "admin_grant",
        "migration",
        "promotion",
      ],
      subscription_status: [
        "pending_activation",
        "active",
        "grace_period",
        "expired",
        "cancelled",
        "suspended",
        "refunded",
        "reversed",
      ],
    },
  },
} as const

