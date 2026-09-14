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
      application_artifacts: {
        Row: {
          content: Json
          created_at: string
          evidence_fact_ids: string[]
          id: string
          kind: Database["public"]["Enums"]["application_artifact_kind"]
          pack_id: string
          plain_text: string
          style: string | null
          title: string
          truth_gate_status: string
          updated_at: string
          version: number
        }
        Insert: {
          content: Json
          created_at?: string
          evidence_fact_ids?: string[]
          id?: string
          kind: Database["public"]["Enums"]["application_artifact_kind"]
          pack_id: string
          plain_text: string
          style?: string | null
          title: string
          truth_gate_status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          content?: Json
          created_at?: string
          evidence_fact_ids?: string[]
          id?: string
          kind?: Database["public"]["Enums"]["application_artifact_kind"]
          pack_id?: string
          plain_text?: string
          style?: string | null
          title?: string
          truth_gate_status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "application_artifacts_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "application_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_events: {
        Row: {
          application_id: string
          created_at: string
          event_type: string
          id: string
          new_stage: Database["public"]["Enums"]["application_stage"] | null
          note: string | null
          occurred_at: string
          previous_stage:
            Database["public"]["Enums"]["application_stage"] | null
          request_id: string | null
          user_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          event_type: string
          id?: string
          new_stage?: Database["public"]["Enums"]["application_stage"] | null
          note?: string | null
          occurred_at?: string
          previous_stage?:
            Database["public"]["Enums"]["application_stage"] | null
          request_id?: string | null
          user_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          event_type?: string
          id?: string
          new_stage?: Database["public"]["Enums"]["application_stage"] | null
          note?: string | null
          occurred_at?: string
          previous_stage?:
            Database["public"]["Enums"]["application_stage"] | null
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_packs: {
        Row: {
          career_profile_id: string
          created_at: string
          error_code: string | null
          evidence_fact_ids: string[]
          generated_at: string | null
          id: string
          job_id: string
          job_updated_at: string
          match_snapshot: Json
          model_version: string | null
          profile_version: number
          prompt_version: string | null
          status: Database["public"]["Enums"]["application_pack_status"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          error_code?: string | null
          evidence_fact_ids?: string[]
          generated_at?: string | null
          id?: string
          job_id: string
          job_updated_at: string
          match_snapshot?: Json
          model_version?: string | null
          profile_version: number
          prompt_version?: string | null
          status?: Database["public"]["Enums"]["application_pack_status"]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          error_code?: string | null
          evidence_fact_ids?: string[]
          generated_at?: string | null
          id?: string
          job_id?: string
          job_updated_at?: string
          match_snapshot?: Json
          model_version?: string | null
          profile_version?: number
          prompt_version?: string | null
          status?: Database["public"]["Enums"]["application_pack_status"]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "application_packs_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_packs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
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
      career_certifications: {
        Row: {
          career_profile_id: string
          created_at: string
          credential_id: string | null
          credential_url: string | null
          expires_on: string | null
          id: string
          issued_on: string | null
          issuer: string | null
          name: string
          updated_at: string
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          credential_id?: string | null
          credential_url?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          credential_id?: string | null
          credential_url?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_certifications_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_documents: {
        Row: {
          bucket_id: string
          career_profile_id: string | null
          checksum_sha256: string
          created_at: string
          document_kind: Database["public"]["Enums"]["career_document_kind"]
          id: string
          is_active: boolean
          mime_type: string
          object_path: string
          original_filename: string
          page_count: number | null
          parse_error_code: string | null
          parsed_at: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["career_document_status"]
          updated_at: string
          user_id: string
          version: number
          word_count: number | null
        }
        Insert: {
          bucket_id?: string
          career_profile_id?: string | null
          checksum_sha256: string
          created_at?: string
          document_kind?: Database["public"]["Enums"]["career_document_kind"]
          id?: string
          is_active?: boolean
          mime_type: string
          object_path: string
          original_filename: string
          page_count?: number | null
          parse_error_code?: string | null
          parsed_at?: string | null
          size_bytes: number
          status?: Database["public"]["Enums"]["career_document_status"]
          updated_at?: string
          user_id: string
          version?: number
          word_count?: number | null
        }
        Update: {
          bucket_id?: string
          career_profile_id?: string | null
          checksum_sha256?: string
          created_at?: string
          document_kind?: Database["public"]["Enums"]["career_document_kind"]
          id?: string
          is_active?: boolean
          mime_type?: string
          object_path?: string
          original_filename?: string
          page_count?: number | null
          parse_error_code?: string | null
          parsed_at?: string | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["career_document_status"]
          updated_at?: string
          user_id?: string
          version?: number
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "career_documents_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_education: {
        Row: {
          career_profile_id: string
          created_at: string
          degree: string | null
          description: string | null
          end_year: number | null
          field_of_study: string | null
          grade: string | null
          id: string
          institution: string
          is_current: boolean
          start_year: number | null
          updated_at: string
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          degree?: string | null
          description?: string | null
          end_year?: number | null
          field_of_study?: string | null
          grade?: string | null
          id?: string
          institution: string
          is_current?: boolean
          start_year?: number | null
          updated_at?: string
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          degree?: string | null
          description?: string | null
          end_year?: number | null
          field_of_study?: string | null
          grade?: string | null
          id?: string
          institution?: string
          is_current?: boolean
          start_year?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_education_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_employment_history: {
        Row: {
          career_profile_id: string
          company_name: string
          company_url: string | null
          country_code: string | null
          created_at: string
          display_order: number
          employment_type: Database["public"]["Enums"]["employment_type"]
          end_date: string | null
          highlights: string[]
          id: string
          industry: string | null
          is_current: boolean
          location: string | null
          role_title: string
          skills: string[]
          start_date: string
          summary: string | null
          updated_at: string
          work_arrangement:
            Database["public"]["Enums"]["work_arrangement"] | null
        }
        Insert: {
          career_profile_id: string
          company_name: string
          company_url?: string | null
          country_code?: string | null
          created_at?: string
          display_order?: number
          employment_type?: Database["public"]["Enums"]["employment_type"]
          end_date?: string | null
          highlights?: string[]
          id?: string
          industry?: string | null
          is_current?: boolean
          location?: string | null
          role_title: string
          skills?: string[]
          start_date: string
          summary?: string | null
          updated_at?: string
          work_arrangement?:
            Database["public"]["Enums"]["work_arrangement"] | null
        }
        Update: {
          career_profile_id?: string
          company_name?: string
          company_url?: string | null
          country_code?: string | null
          created_at?: string
          display_order?: number
          employment_type?: Database["public"]["Enums"]["employment_type"]
          end_date?: string | null
          highlights?: string[]
          id?: string
          industry?: string | null
          is_current?: boolean
          location?: string | null
          role_title?: string
          skills?: string[]
          start_date?: string
          summary?: string | null
          updated_at?: string
          work_arrangement?:
            Database["public"]["Enums"]["work_arrangement"] | null
        }
        Relationships: [
          {
            foreignKeyName: "career_employment_history_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_facts: {
        Row: {
          career_profile_id: string
          category: Database["public"]["Enums"]["career_fact_category"]
          confidence: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          document_id: string | null
          evidence: Json
          id: string
          metric_context: string | null
          metric_unit: string | null
          metric_value: number | null
          source: Database["public"]["Enums"]["career_fact_source"]
          statement: string
          status: Database["public"]["Enums"]["career_fact_status"]
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          career_profile_id: string
          category?: Database["public"]["Enums"]["career_fact_category"]
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          document_id?: string | null
          evidence?: Json
          id?: string
          metric_context?: string | null
          metric_unit?: string | null
          metric_value?: number | null
          source: Database["public"]["Enums"]["career_fact_source"]
          statement: string
          status?: Database["public"]["Enums"]["career_fact_status"]
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          career_profile_id?: string
          category?: Database["public"]["Enums"]["career_fact_category"]
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          document_id?: string | null
          evidence?: Json
          id?: string
          metric_context?: string | null
          metric_unit?: string | null
          metric_value?: number | null
          source?: Database["public"]["Enums"]["career_fact_source"]
          statement?: string
          status?: Database["public"]["Enums"]["career_fact_status"]
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_facts_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_facts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "career_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_facts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "career_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      career_profile_links: {
        Row: {
          career_profile_id: string
          created_at: string
          display_order: number
          id: string
          label: string | null
          link_kind: Database["public"]["Enums"]["career_link_kind"]
          updated_at: string
          url: string
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          display_order?: number
          id?: string
          label?: string | null
          link_kind: Database["public"]["Enums"]["career_link_kind"]
          updated_at?: string
          url: string
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          display_order?: number
          id?: string
          label?: string | null
          link_kind?: Database["public"]["Enums"]["career_link_kind"]
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_profile_links_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_profiles: {
        Row: {
          availability:
            Database["public"]["Enums"]["availability_status"] | null
          career_goals: string | null
          career_level: Database["public"]["Enums"]["career_level"] | null
          completeness_percent: number
          created_at: string
          current_role_title: string | null
          excluded_role_titles: string[]
          headline: string | null
          id: string
          industries: string[]
          is_primary: boolean
          last_reviewed_at: string | null
          name: string
          open_to_international: boolean
          open_to_relocation: boolean
          preferred_employment_types: Database["public"]["Enums"]["employment_type"][]
          preferred_locations: string[]
          preferred_work_arrangement:
            Database["public"]["Enums"]["work_arrangement"] | null
          salary_currency: string
          salary_expectation_max_minor: number | null
          salary_expectation_min_minor: number | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          status: Database["public"]["Enums"]["career_profile_status"]
          summary: string | null
          target_role_titles: string[]
          updated_at: string
          user_id: string
          version: number
          work_authorizations: string[]
          years_experience: number | null
        }
        Insert: {
          availability?:
            Database["public"]["Enums"]["availability_status"] | null
          career_goals?: string | null
          career_level?: Database["public"]["Enums"]["career_level"] | null
          completeness_percent?: number
          created_at?: string
          current_role_title?: string | null
          excluded_role_titles?: string[]
          headline?: string | null
          id?: string
          industries?: string[]
          is_primary?: boolean
          last_reviewed_at?: string | null
          name: string
          open_to_international?: boolean
          open_to_relocation?: boolean
          preferred_employment_types?: Database["public"]["Enums"]["employment_type"][]
          preferred_locations?: string[]
          preferred_work_arrangement?:
            Database["public"]["Enums"]["work_arrangement"] | null
          salary_currency?: string
          salary_expectation_max_minor?: number | null
          salary_expectation_min_minor?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          status?: Database["public"]["Enums"]["career_profile_status"]
          summary?: string | null
          target_role_titles?: string[]
          updated_at?: string
          user_id: string
          version?: number
          work_authorizations?: string[]
          years_experience?: number | null
        }
        Update: {
          availability?:
            Database["public"]["Enums"]["availability_status"] | null
          career_goals?: string | null
          career_level?: Database["public"]["Enums"]["career_level"] | null
          completeness_percent?: number
          created_at?: string
          current_role_title?: string | null
          excluded_role_titles?: string[]
          headline?: string | null
          id?: string
          industries?: string[]
          is_primary?: boolean
          last_reviewed_at?: string | null
          name?: string
          open_to_international?: boolean
          open_to_relocation?: boolean
          preferred_employment_types?: Database["public"]["Enums"]["employment_type"][]
          preferred_locations?: string[]
          preferred_work_arrangement?:
            Database["public"]["Enums"]["work_arrangement"] | null
          salary_currency?: string
          salary_expectation_max_minor?: number | null
          salary_expectation_min_minor?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          status?: Database["public"]["Enums"]["career_profile_status"]
          summary?: string | null
          target_role_titles?: string[]
          updated_at?: string
          user_id?: string
          version?: number
          work_authorizations?: string[]
          years_experience?: number | null
        }
        Relationships: []
      }
      career_projects: {
        Row: {
          career_profile_id: string
          created_at: string
          description: string | null
          display_order: number
          end_date: string | null
          highlights: string[]
          id: string
          is_featured: boolean
          name: string
          project_url: string | null
          repository_url: string | null
          role_title: string | null
          skills: string[]
          start_date: string | null
          updated_at: string
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          highlights?: string[]
          id?: string
          is_featured?: boolean
          name: string
          project_url?: string | null
          repository_url?: string | null
          role_title?: string | null
          skills?: string[]
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          highlights?: string[]
          id?: string
          is_featured?: boolean
          name?: string
          project_url?: string | null
          repository_url?: string | null
          role_title?: string | null
          skills?: string[]
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_projects_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_skills: {
        Row: {
          career_profile_id: string
          created_at: string
          display_order: number
          id: string
          is_primary: boolean
          last_used_year: number | null
          name: string
          proficiency: Database["public"]["Enums"]["proficiency_level"] | null
          skill_kind: Database["public"]["Enums"]["career_skill_kind"]
          updated_at: string
          years_experience: number | null
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_primary?: boolean
          last_used_year?: number | null
          name: string
          proficiency?: Database["public"]["Enums"]["proficiency_level"] | null
          skill_kind?: Database["public"]["Enums"]["career_skill_kind"]
          updated_at?: string
          years_experience?: number | null
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_primary?: boolean
          last_used_year?: number | null
          name?: string
          proficiency?: Database["public"]["Enums"]["proficiency_level"] | null
          skill_kind?: Database["public"]["Enums"]["career_skill_kind"]
          updated_at?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "career_skills_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      career_sub_careers: {
        Row: {
          career_profile_id: string
          created_at: string
          focus: string | null
          id: string
          keywords: string[]
          name: string
          priority: number
          updated_at: string
        }
        Insert: {
          career_profile_id: string
          created_at?: string
          focus?: string | null
          id?: string
          keywords?: string[]
          name: string
          priority?: number
          updated_at?: string
        }
        Update: {
          career_profile_id?: string
          created_at?: string
          focus?: string | null
          id?: string
          keywords?: string[]
          name?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_sub_careers_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          country_code: string | null
          created_at: string
          display_name: string
          domain: string | null
          id: string
          is_verified: boolean
          normalized_name: string
          updated_at: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          display_name: string
          domain?: string | null
          id?: string
          is_verified?: boolean
          normalized_name: string
          updated_at?: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          display_name?: string
          domain?: string | null
          id?: string
          is_verified?: boolean
          normalized_name?: string
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
      job_applications: {
        Row: {
          applied_at: string | null
          career_profile_id: string | null
          created_at: string
          id: string
          job_id: string
          next_action_at: string | null
          next_action_note: string | null
          notes: string | null
          outcome_note: string | null
          pack_id: string | null
          source: Database["public"]["Enums"]["application_source_kind"]
          stage: Database["public"]["Enums"]["application_stage"]
          stage_changed_at: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          applied_at?: string | null
          career_profile_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          next_action_at?: string | null
          next_action_note?: string | null
          notes?: string | null
          outcome_note?: string | null
          pack_id?: string | null
          source?: Database["public"]["Enums"]["application_source_kind"]
          stage?: Database["public"]["Enums"]["application_stage"]
          stage_changed_at?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          applied_at?: string | null
          career_profile_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          next_action_at?: string | null
          next_action_note?: string | null
          notes?: string | null
          outcome_note?: string | null
          pack_id?: string | null
          source?: Database["public"]["Enums"]["application_source_kind"]
          stage?: Database["public"]["Enums"]["application_stage"]
          stage_changed_at?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "application_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dedup_candidates: {
        Row: {
          created_at: string
          duplicate_job_id: string
          id: string
          job_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          score: number
          signals: Json
        }
        Insert: {
          created_at?: string
          duplicate_job_id: string
          id?: string
          job_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score: number
          signals?: Json
        }
        Update: {
          created_at?: string
          duplicate_job_id?: string
          id?: string
          job_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number
          signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "job_dedup_candidates_duplicate_job_id_fkey"
            columns: ["duplicate_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dedup_candidates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_feedback: {
        Row: {
          active: boolean
          career_profile_id: string | null
          created_at: string
          feedback: Database["public"]["Enums"]["job_feedback_kind"]
          id: string
          job_id: string
          reason: string | null
          superseded_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          career_profile_id?: string | null
          created_at?: string
          feedback: Database["public"]["Enums"]["job_feedback_kind"]
          id?: string
          job_id: string
          reason?: string | null
          superseded_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          career_profile_id?: string | null
          created_at?: string
          feedback?: Database["public"]["Enums"]["job_feedback_kind"]
          id?: string
          job_id?: string
          reason?: string | null
          superseded_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_feedback_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_feedback_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_ingestion_runs: {
        Row: {
          created_count: number
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          fetched_count: number
          finished_at: string | null
          id: string
          merged_count: number
          rejected_count: number
          request_id: string | null
          requested_by: string | null
          skipped_count: number
          source_id: string
          started_at: string
          status: Database["public"]["Enums"]["job_ingestion_run_status"]
          trigger: Database["public"]["Enums"]["job_ingestion_trigger"]
          updated_count: number
        }
        Insert: {
          created_count?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          merged_count?: number
          rejected_count?: number
          request_id?: string | null
          requested_by?: string | null
          skipped_count?: number
          source_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_ingestion_run_status"]
          trigger?: Database["public"]["Enums"]["job_ingestion_trigger"]
          updated_count?: number
        }
        Update: {
          created_count?: number
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          merged_count?: number
          rejected_count?: number
          request_id?: string | null
          requested_by?: string | null
          skipped_count?: number
          source_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_ingestion_run_status"]
          trigger?: Database["public"]["Enums"]["job_ingestion_trigger"]
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_ingestion_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      job_matches: {
        Row: {
          blockers: Json
          career_profile_id: string
          computed_at: string
          confidence: Database["public"]["Enums"]["job_match_confidence"]
          created_at: string
          data_quality: Json
          dimensions: Json
          evidence_fact_ids: string[]
          gaps: Json
          id: string
          job_id: string
          job_updated_at: string
          model_version: string
          profile_version: number
          recommended_action: string
          rejection_risks: Json
          requirement_mapping: Json
          score: number
          strengths: Json
          updated_at: string
          user_id: string
          verdict: Database["public"]["Enums"]["job_match_verdict"]
        }
        Insert: {
          blockers?: Json
          career_profile_id: string
          computed_at?: string
          confidence: Database["public"]["Enums"]["job_match_confidence"]
          created_at?: string
          data_quality?: Json
          dimensions?: Json
          evidence_fact_ids?: string[]
          gaps?: Json
          id?: string
          job_id: string
          job_updated_at: string
          model_version: string
          profile_version: number
          recommended_action: string
          rejection_risks?: Json
          requirement_mapping?: Json
          score: number
          strengths?: Json
          updated_at?: string
          user_id: string
          verdict: Database["public"]["Enums"]["job_match_verdict"]
        }
        Update: {
          blockers?: Json
          career_profile_id?: string
          computed_at?: string
          confidence?: Database["public"]["Enums"]["job_match_confidence"]
          created_at?: string
          data_quality?: Json
          dimensions?: Json
          evidence_fact_ids?: string[]
          gaps?: Json
          id?: string
          job_id?: string
          job_updated_at?: string
          model_version?: string
          profile_version?: number
          recommended_action?: string
          rejection_risks?: Json
          requirement_mapping?: Json
          score?: number
          strengths?: Json
          updated_at?: string
          user_id?: string
          verdict?: Database["public"]["Enums"]["job_match_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "job_matches_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_source_records: {
        Row: {
          created_at: string
          first_seen_at: string
          id: string
          is_primary: boolean
          job_id: string
          last_seen_at: string
          last_verified_at: string | null
          payload_checksum: string
          raw_payload: Json
          source_id: string
          source_job_id: string
          source_url: string
          status: Database["public"]["Enums"]["job_source_record_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_seen_at?: string
          id?: string
          is_primary?: boolean
          job_id: string
          last_seen_at?: string
          last_verified_at?: string | null
          payload_checksum: string
          raw_payload: Json
          source_id: string
          source_job_id: string
          source_url: string
          status?: Database["public"]["Enums"]["job_source_record_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_seen_at?: string
          id?: string
          is_primary?: boolean
          job_id?: string
          last_seen_at?: string
          last_verified_at?: string | null
          payload_checksum?: string
          raw_payload?: Json
          source_id?: string
          source_job_id?: string
          source_url?: string
          status?: Database["public"]["Enums"]["job_source_record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_source_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_source_records_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          attribution: string
          base_url: string
          batch_size: number
          circuit_open_until: string | null
          code: string
          config: Json
          consecutive_failures: number
          created_at: string
          credential_env_var: string | null
          display_name: string
          id: string
          last_error_code: string | null
          last_failure_at: string | null
          last_success_at: string | null
          min_scan_interval_minutes: number
          requests_per_minute: number
          requires_credentials: boolean
          source_kind: Database["public"]["Enums"]["job_source_kind"]
          status: Database["public"]["Enums"]["job_source_status"]
          terms_url: string | null
          total_jobs_ingested: number
          updated_at: string
        }
        Insert: {
          attribution: string
          base_url: string
          batch_size?: number
          circuit_open_until?: string | null
          code: string
          config?: Json
          consecutive_failures?: number
          created_at?: string
          credential_env_var?: string | null
          display_name: string
          id?: string
          last_error_code?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          min_scan_interval_minutes?: number
          requests_per_minute?: number
          requires_credentials?: boolean
          source_kind: Database["public"]["Enums"]["job_source_kind"]
          status?: Database["public"]["Enums"]["job_source_status"]
          terms_url?: string | null
          total_jobs_ingested?: number
          updated_at?: string
        }
        Update: {
          attribution?: string
          base_url?: string
          batch_size?: number
          circuit_open_until?: string | null
          code?: string
          config?: Json
          consecutive_failures?: number
          created_at?: string
          credential_env_var?: string | null
          display_name?: string
          id?: string
          last_error_code?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          min_scan_interval_minutes?: number
          requests_per_minute?: number
          requires_credentials?: boolean
          source_kind?: Database["public"]["Enums"]["job_source_kind"]
          status?: Database["public"]["Enums"]["job_source_status"]
          terms_url?: string | null
          total_jobs_ingested?: number
          updated_at?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          apply_url: string
          canonical_url: string
          city: string | null
          company_id: string
          content_fingerprint: string
          country_code: string | null
          created_at: string
          dedup_key: string
          description: string
          description_excerpt: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          experience_years_max: number | null
          experience_years_min: number | null
          expires_at: string | null
          first_seen_at: string
          freshness_checked_at: string | null
          id: string
          is_international: boolean
          is_philippines: boolean
          language: string
          last_seen_at: string
          last_verified_at: string | null
          location_raw: string | null
          normalized_title: string
          posted_at: string | null
          preferred_qualifications: string[]
          region: string | null
          remote_state: Database["public"]["Enums"]["job_remote_state"]
          requirements: string[]
          salary_currency: string | null
          salary_is_estimate: boolean
          salary_max_minor: number | null
          salary_min_minor: number | null
          salary_period: Database["public"]["Enums"]["salary_period"] | null
          seniority: Database["public"]["Enums"]["job_seniority"]
          skills: string[]
          source_count: number
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
        }
        Insert: {
          apply_url: string
          canonical_url: string
          city?: string | null
          company_id: string
          content_fingerprint: string
          country_code?: string | null
          created_at?: string
          dedup_key: string
          description: string
          description_excerpt?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          experience_years_max?: number | null
          experience_years_min?: number | null
          expires_at?: string | null
          first_seen_at?: string
          freshness_checked_at?: string | null
          id?: string
          is_international?: boolean
          is_philippines?: boolean
          language?: string
          last_seen_at?: string
          last_verified_at?: string | null
          location_raw?: string | null
          normalized_title: string
          posted_at?: string | null
          preferred_qualifications?: string[]
          region?: string | null
          remote_state?: Database["public"]["Enums"]["job_remote_state"]
          requirements?: string[]
          salary_currency?: string | null
          salary_is_estimate?: boolean
          salary_max_minor?: number | null
          salary_min_minor?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          seniority?: Database["public"]["Enums"]["job_seniority"]
          skills?: string[]
          source_count?: number
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
        }
        Update: {
          apply_url?: string
          canonical_url?: string
          city?: string | null
          company_id?: string
          content_fingerprint?: string
          country_code?: string | null
          created_at?: string
          dedup_key?: string
          description?: string
          description_excerpt?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          experience_years_max?: number | null
          experience_years_min?: number | null
          expires_at?: string | null
          first_seen_at?: string
          freshness_checked_at?: string | null
          id?: string
          is_international?: boolean
          is_philippines?: boolean
          language?: string
          last_seen_at?: string
          last_verified_at?: string | null
          location_raw?: string | null
          normalized_title?: string
          posted_at?: string | null
          preferred_qualifications?: string[]
          region?: string | null
          remote_state?: Database["public"]["Enums"]["job_remote_state"]
          requirements?: string[]
          salary_currency?: string | null
          salary_is_estimate?: boolean
          salary_max_minor?: number | null
          salary_min_minor?: number | null
          salary_period?: Database["public"]["Enums"]["salary_period"] | null
          seniority?: Database["public"]["Enums"]["job_seniority"]
          skills?: string[]
          source_count?: number
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          available_at: string
          category: string
          claim_token: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          failure_code: string | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          provider_message_id: string | null
          status: string
          template_id: string
          template_version: string
          updated_at: string
          user_id: string
          variables: Json
        }
        Insert: {
          attempts?: number
          available_at?: string
          category: string
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          provider_message_id?: string | null
          status?: string
          template_id: string
          template_version?: string
          updated_at?: string
          user_id: string
          variables?: Json
        }
        Update: {
          attempts?: number
          available_at?: string
          category?: string
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          provider_message_id?: string | null
          status?: string
          template_id?: string
          template_version?: string
          updated_at?: string
          user_id?: string
          variables?: Json
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
            Database["public"]["Enums"]["payment_submission_status"] | null
          previous_status:
            Database["public"]["Enums"]["payment_submission_status"] | null
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
            Database["public"]["Enums"]["payment_submission_status"] | null
          previous_status?:
            Database["public"]["Enums"]["payment_submission_status"] | null
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
            Database["public"]["Enums"]["payment_submission_status"] | null
          previous_status?:
            Database["public"]["Enums"]["payment_submission_status"] | null
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
      saved_jobs: {
        Row: {
          career_profile_id: string | null
          created_at: string
          id: string
          job_id: string
          note: string | null
          saved_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          career_profile_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          note?: string | null
          saved_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          career_profile_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          note?: string | null
          saved_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_jobs_career_profile_id_fkey"
            columns: ["career_profile_id"]
            isOneToOne: false
            referencedRelation: "career_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
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
      usage_counters: {
        Row: {
          created_at: string
          feature: Database["public"]["Enums"]["usage_feature"]
          id: string
          limit_snapshot: number
          period_start: string
          updated_at: string
          used: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: Database["public"]["Enums"]["usage_feature"]
          id?: string
          limit_snapshot: number
          period_start: string
          updated_at?: string
          used?: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: Database["public"]["Enums"]["usage_feature"]
          id?: string
          limit_snapshot?: number
          period_start?: string
          updated_at?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          application_pack_id: string | null
          created_at: string
          feature: Database["public"]["Enums"]["usage_feature"]
          id: string
          idempotency_key: string
          metadata: Json
          period_start: string
          units: number
          user_id: string
        }
        Insert: {
          application_pack_id?: string | null
          created_at?: string
          feature: Database["public"]["Enums"]["usage_feature"]
          id?: string
          idempotency_key: string
          metadata?: Json
          period_start: string
          units?: number
          user_id: string
        }
        Update: {
          application_pack_id?: string | null
          created_at?: string
          feature?: Database["public"]["Enums"]["usage_feature"]
          id?: string
          idempotency_key?: string
          metadata?: Json
          period_start?: string
          units?: number
          user_id?: string
        }
        Relationships: []
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
          daily_digest: boolean
          future_daily_digest: boolean
          future_job_alerts: boolean
          instant_alerts: boolean
          job_alerts: boolean
          marketing_emails: boolean
          product_updates: boolean
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          updated_at: string
          user_id: string
          weekly_strategy: boolean
        }
        Insert: {
          created_at?: string
          daily_digest?: boolean
          future_daily_digest?: boolean
          future_job_alerts?: boolean
          instant_alerts?: boolean
          job_alerts?: boolean
          marketing_emails?: boolean
          product_updates?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          updated_at?: string
          user_id: string
          weekly_strategy?: boolean
        }
        Update: {
          created_at?: string
          daily_digest?: boolean
          future_daily_digest?: boolean
          future_job_alerts?: boolean
          instant_alerts?: boolean
          job_alerts?: boolean
          marketing_emails?: boolean
          product_updates?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          updated_at?: string
          user_id?: string
          weekly_strategy?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_ingestion_lock: {
        Args: {
          requested_lock_key: string
          requested_holder: string
          ttl_seconds?: number
        }
        Returns: boolean
      }
      admin_attach_payment_method_qr: {
        Args: {
          actor_user_id: string
          target_payment_method_id: string
          requested_object_path: string
          requested_mime_type: string
          requested_checksum_sha256: string
          requested_size_bytes: number
          requested_width: number
          requested_height: number
          action_request_id?: string
        }
        Returns: Json
      }
      admin_audit_event_directory: {
        Args: {
          actor_user_id: string
          filter_actor_user_id?: string
          filter_action?: string
          filter_target_type?: string
          filter_target_id?: string
          filter_request_id?: string
          occurred_from?: string
          occurred_to?: string
          page_size?: number
          page_offset?: number
        }
        Returns: {
          event_id: string
          event_actor_user_id: string
          event_actor_type: Database["public"]["Enums"]["audit_actor_type"]
          action: string
          target_type: string
          target_id: string
          request_id: string
          before_state: Json
          after_state: Json
          metadata: Json
          created_at: string
          total_count: number
        }[]
      }
      admin_create_payment_method: {
        Args: {
          actor_user_id: string
          requested_method: Json
          action_request_id?: string
        }
        Returns: string
      }
      admin_overview: {
        Args: {
          actor_user_id: string
        }
        Returns: {
          registered_users: number
          verified_users: number
          suspended_users: number
          active_administrators: number
          auth_events_last_24_hours: number
        }[]
      }
      admin_revoke_user_sessions: {
        Args: {
          actor_user_id: string
          target_user_id: string
          action_reason: string
          action_request_id?: string
        }
        Returns: number
      }
      admin_set_account_status: {
        Args: {
          actor_user_id: string
          target_user_id: string
          requested_status: Database["public"]["Enums"]["account_status"]
          action_reason: string
          action_request_id?: string
        }
        Returns: boolean
      }
      admin_set_payment_method_state: {
        Args: {
          actor_user_id: string
          target_payment_method_id: string
          expected_version: number
          requested_action: string
          action_reason: string
          action_request_id?: string
        }
        Returns: number
      }
      admin_update_payment_method: {
        Args: {
          actor_user_id: string
          target_payment_method_id: string
          expected_version: number
          requested_method: Json
          action_request_id?: string
        }
        Returns: number
      }
      admin_user_detail: {
        Args: {
          actor_user_id: string
          target_user_id: string
        }
        Returns: {
          user_id: string
          email: string
          email_verified: boolean
          email_verified_at: string
          first_name: string
          last_name: string
          display_name: string
          locale: string
          timezone: string
          country_code: string
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          account_status: Database["public"]["Enums"]["account_status"]
          subscription_plan_code: string
          subscription_status: string
          subscription_starts_at: string
          subscription_ends_at: string
          admin_membership_status: string
          admin_roles: string[]
          created_at: string
          updated_at: string
        }[]
      }
      admin_user_directory: {
        Args: {
          actor_user_id: string
          search_query?: string
          verification_filter?: string
          status_filter?: Database["public"]["Enums"]["account_status"]
          created_from?: string
          created_to?: string
          page_size?: number
          page_offset?: number
        }
        Returns: {
          user_id: string
          email: string
          email_verified: boolean
          email_verified_at: string
          first_name: string
          last_name: string
          display_name: string
          account_status: Database["public"]["Enums"]["account_status"]
          subscription_plan_code: string
          subscription_status: string
          admin_roles: string[]
          created_at: string
          updated_at: string
          total_count: number
        }[]
      }
      application_pack_detail: {
        Args: {
          actor_user_id: string
          target_pack_id: string
        }
        Returns: Json
      }
      application_pack_directory: {
        Args: {
          actor_user_id: string
        }
        Returns: Json
      }
      application_timeline: {
        Args: {
          actor_user_id: string
          target_application_id: string
        }
        Returns: Json
      }
      application_tracker: {
        Args: {
          actor_user_id: string
        }
        Returns: Json
      }
      approve_payment_submission: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          action_reason: string
          internal_note?: string
          action_request_id?: string
        }
        Returns: Json
      }
      archive_career_document: {
        Args: {
          actor_user_id: string
          target_document_id: string
          action_request_id?: string
        }
        Returns: string
      }
      attach_payment_proof: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          requested_object_path: string
          requested_checksum_sha256: string
          requested_mime_type: string
          requested_size_bytes: number
          requested_original_filename: string
          requested_width: number
          requested_height: number
          requested_scan_status?: string
          action_request_id?: string
        }
        Returns: Json
      }
      authorize_admin_payment_access: {
        Args: {
          actor_user_id: string
          required_permission: string
        }
        Returns: boolean
      }
      bootstrap_first_super_admin: {
        Args: {
          target_user_id: string
          target_email: string
          confirmation: string
        }
        Returns: boolean
      }
      cancel_payment_submission: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          action_request_id?: string
        }
        Returns: Json
      }
      career_document_detail: {
        Args: {
          actor_user_id: string
          target_document_id: string
        }
        Returns: Json
      }
      career_document_directory: {
        Args: {
          actor_user_id: string
        }
        Returns: Json
      }
      career_fact_directory: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          status_filter?: Database["public"]["Enums"]["career_fact_status"]
        }
        Returns: Json
      }
      career_profile_detail: {
        Args: {
          actor_user_id: string
          target_profile_id: string
        }
        Returns: Json
      }
      career_profile_directory: {
        Args: {
          actor_user_id: string
        }
        Returns: Json
      }
      claim_notification_outbox: {
        Args: {
          requested_claim_token: string
          requested_batch_size?: number
        }
        Returns: {
          id: string
          user_id: string
          category: string
          template_id: string
          template_version: string
          idempotency_key: string
          variables: Json
          attempts: number
        }[]
      }
      claim_payment_notifications: {
        Args: {
          requested_claim_token: string
          requested_batch_size?: number
        }
        Returns: {
          id: string
          user_id: string
          payment_submission_id: string
          subscription_id: string
          template_id: string
          template_version: string
          idempotency_key: string
          variables: Json
          attempts: number
        }[]
      }
      claim_storage_cleanup_jobs: {
        Args: {
          requested_claim_token: string
          requested_batch_size?: number
        }
        Returns: {
          id: string
          bucket_id: string
          object_path: string
          attempts: number
        }[]
      }
      complete_application_pack: {
        Args: {
          actor_user_id: string
          target_pack_id: string
          outcome: string
          error_code?: string
        }
        Returns: boolean
      }
      complete_career_document_processing: {
        Args: {
          actor_user_id: string
          target_document_id: string
          outcome: string
          error_code?: string
        }
        Returns: boolean
      }
      complete_ingestion_run: {
        Args: {
          target_run_id: string
          outcome: Json
        }
        Returns: boolean
      }
      complete_notification_outbox: {
        Args: {
          target_notification_id: string
          requested_claim_token: string
          requested_status: string
          requested_provider_message_id?: string
          requested_failure_code?: string
          requested_attempts?: number
        }
        Returns: boolean
      }
      complete_payment_notification: {
        Args: {
          target_notification_id: string
          requested_claim_token: string
          requested_status: string
          requested_provider_message_id: string
          requested_failure_code: string
          requested_attempts: number
        }
        Returns: boolean
      }
      complete_storage_cleanup_job: {
        Args: {
          target_job_id: string
          requested_claim_token: string
          requested_status: Database["public"]["Enums"]["storage_cleanup_status"]
          requested_error_code?: string
        }
        Returns: boolean
      }
      confirmed_career_evidence: {
        Args: {
          actor_user_id: string
          target_profile_id: string
        }
        Returns: Json
      }
      consume_auth_rate_limit: {
        Args: {
          rate_bucket: string
          rate_key_hash: string
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          remaining: number
        }[]
      }
      correct_subscription: {
        Args: {
          actor_user_id: string
          target_subscription_id: string
          expected_version: number
          requested_starts_at: string
          requested_ends_at: string
          action_reason: string
          internal_note?: string
          restore_reversed?: boolean
          action_request_id?: string
        }
        Returns: number
      }
      create_application_pack: {
        Args: {
          actor_user_id: string
          target_job_id: string
          target_career_profile_id: string
          idempotency_key: string
          action_request_id?: string
        }
        Returns: Json
      }
      create_career_profile: {
        Args: {
          actor_user_id: string
          profile_input: Json
          action_request_id?: string
        }
        Returns: string
      }
      create_payment_draft: {
        Args: {
          actor_user_id: string
          draft_input: Json
          action_request_id?: string
        }
        Returns: string
      }
      decide_career_fact: {
        Args: {
          actor_user_id: string
          target_fact_id: string
          decision: string
          override_statement?: string
          override_metric_unit?: string
          override_metric_value?: number
          action_request_id?: string
        }
        Returns: Json
      }
      delete_career_profile: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          action_request_id?: string
        }
        Returns: boolean
      }
      delete_career_record: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          record_kind: string
          record_id: string
          action_request_id?: string
        }
        Returns: boolean
      }
      expire_subscriptions: {
        Args: {
          evaluated_at?: string
          action_request_id?: string
        }
        Returns: number
      }
      get_my_admin_access: {
        Args: Record<PropertyKey, never>
        Returns: {
          roles: string[]
          permissions: string[]
        }[]
      }
      is_auth_session_active: {
        Args: {
          target_user_id: string
          target_session_id: string
        }
        Returns: boolean
      }
      job_detail: {
        Args: {
          actor_user_id: string
          target_job_id: string
          target_career_profile_id?: string
        }
        Returns: Json
      }
      job_ingestion_schedule: {
        Args: Record<PropertyKey, never>
        Returns: {
          source_id: string
          source_code: string
          effective_interval_minutes: number
          fastest_subscriber_interval_minutes: number
          due: boolean
        }[]
      }
      job_radar: {
        Args: {
          actor_user_id: string
          filters?: Json
        }
        Returns: Json
      }
      list_my_sessions: {
        Args: Record<PropertyKey, never>
        Returns: {
          session_id: string
          created_at: string
          last_seen_at: string
          user_agent: string
          current_session: boolean
        }[]
      }
      matching_job_candidates: {
        Args: {
          actor_user_id: string
          target_career_profile_id: string
          batch_size?: number
        }
        Returns: Json
      }
      matching_subjects: {
        Args: {
          batch_size?: number
          stale_after_hours?: number
        }
        Returns: {
          user_id: string
          career_profile_id: string
          plan_code: string
          priority: number
        }[]
      }
      queue_job_alert_notifications: {
        Args: {
          evaluated_at?: string
          window_minutes?: number
          minimum_score?: number
          batch_size?: number
        }
        Returns: number
      }
      queue_job_digest_notifications: {
        Args: {
          evaluated_at?: string
          minimum_score?: number
          batch_size?: number
        }
        Returns: number
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
        Args: {
          evaluated_at?: string
          reminder_days?: number
        }
        Returns: number
      }
      reconcile_my_profile: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      record_application_artifact: {
        Args: {
          actor_user_id: string
          target_pack_id: string
          artifact_input: Json
          action_request_id?: string
        }
        Returns: string
      }
      record_career_document_extraction: {
        Args: {
          actor_user_id: string
          target_document_id: string
          extraction_input: Json
          action_request_id?: string
        }
        Returns: string
      }
      record_career_facts: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          facts: Json
          requested_source: Database["public"]["Enums"]["career_fact_source"]
          source_document_id?: string
          action_request_id?: string
        }
        Returns: Json
      }
      record_job_feedback: {
        Args: {
          actor_user_id: string
          target_job_id: string
          requested_feedback: Database["public"]["Enums"]["job_feedback_kind"]
          requested_reason?: string
          target_career_profile_id?: string
          action_request_id?: string
        }
        Returns: string
      }
      record_job_matches: {
        Args: {
          actor_user_id: string
          match_input: Json
          action_request_id?: string
        }
        Returns: number
      }
      record_my_auth_event: {
        Args: {
          requested_event_type: string
          requested_request_id?: string
        }
        Returns: string
      }
      record_payment_refund: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          refunded_amount_minor: number
          external_reference: string
          refunded_at: string
          requested_subscription_impact: Database["public"]["Enums"]["payment_subscription_impact"]
          action_reason: string
          internal_note?: string
          action_request_id?: string
        }
        Returns: number
      }
      refresh_job_freshness: {
        Args: {
          evaluated_at?: string
          stale_after_hours?: number
          expire_after_hours?: number
        }
        Returns: Json
      }
      register_career_document: {
        Args: {
          actor_user_id: string
          document_input: Json
          action_request_id?: string
        }
        Returns: string
      }
      reject_payment_submission: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          requested_rejection_reason_code: string
          public_message: string
          internal_note?: string
          action_reason?: string
          action_request_id?: string
        }
        Returns: number
      }
      release_ingestion_lock: {
        Args: {
          requested_lock_key: string
          requested_holder: string
        }
        Returns: boolean
      }
      release_notification_outbox: {
        Args: {
          target_notification_id: string
          requested_claim_token: string
          retry_at: string
        }
        Returns: boolean
      }
      release_payment_notification_claim: {
        Args: {
          target_notification_id: string
          requested_claim_token: string
          retry_at: string
        }
        Returns: boolean
      }
      release_storage_cleanup_job: {
        Args: {
          target_job_id: string
          requested_claim_token: string
          retry_at: string
        }
        Returns: boolean
      }
      request_payment_information: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          reason_category: string
          public_message: string
          internal_note?: string
          action_reason?: string
          action_request_id?: string
        }
        Returns: number
      }
      resolve_career_document_object: {
        Args: {
          actor_user_id: string
          target_document_id: string
        }
        Returns: {
          bucket_id: string
          object_path: string
          mime_type: string
          original_filename: string
        }[]
      }
      resolve_payment_method_qr_object: {
        Args: {
          actor_user_id: string
          target_payment_method_id: string
          administrator_access?: boolean
        }
        Returns: {
          bucket_id: string
          object_path: string
          mime_type: string
        }[]
      }
      resolve_payment_proof_object: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          administrator_access?: boolean
        }
        Returns: {
          bucket_id: string
          object_path: string
          mime_type: string
          original_filename: string
        }[]
      }
      resubmit_payment_submission: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          requested_response: string
          declaration_accepted: boolean
          action_request_id?: string
        }
        Returns: number
      }
      reverse_payment_approval: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          action_reason: string
          internal_note?: string
          action_request_id?: string
        }
        Returns: number
      }
      save_job: {
        Args: {
          actor_user_id: string
          target_job_id: string
          target_career_profile_id?: string
          requested_note?: string
          action_request_id?: string
        }
        Returns: boolean
      }
      set_application_stage: {
        Args: {
          actor_user_id: string
          target_application_id: string
          requested_stage: Database["public"]["Enums"]["application_stage"]
          expected_version: number
          requested_note?: string
          action_request_id?: string
        }
        Returns: Json
      }
      set_career_profile_status: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          requested_status: Database["public"]["Enums"]["career_profile_status"]
          action_request_id?: string
        }
        Returns: number
      }
      set_onboarding_status: {
        Args: {
          actor_user_id: string
          requested_status: Database["public"]["Enums"]["onboarding_status"]
          action_request_id?: string
        }
        Returns: boolean
      }
      set_primary_career_profile: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          action_request_id?: string
        }
        Returns: boolean
      }
      start_ingestion_run: {
        Args: {
          target_source_id: string
          requested_trigger?: Database["public"]["Enums"]["job_ingestion_trigger"]
          requested_by?: string
          action_request_id?: string
        }
        Returns: string
      }
      start_payment_review: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          action_request_id?: string
        }
        Returns: number
      }
      submit_payment_submission: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          declaration_accepted: boolean
          action_request_id?: string
        }
        Returns: number
      }
      unsave_job: {
        Args: {
          actor_user_id: string
          target_job_id: string
          action_request_id?: string
        }
        Returns: boolean
      }
      update_career_profile: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          expected_version: number
          profile_input: Json
          action_request_id?: string
        }
        Returns: number
      }
      update_my_notification_preferences: {
        Args: {
          requested_product_updates?: boolean
          requested_marketing_emails?: boolean
          requested_job_alerts?: boolean
          requested_daily_digest?: boolean
          requested_instant_alerts?: boolean
          requested_weekly_strategy?: boolean
          requested_quiet_hours_start?: number
          requested_quiet_hours_end?: number
          requested_request_id?: string
        }
        Returns: Database["public"]["Tables"]["user_notification_preferences"]["Row"]
      }
      update_payment_draft: {
        Args: {
          actor_user_id: string
          target_submission_id: string
          expected_version: number
          draft_input: Json
          action_request_id?: string
        }
        Returns: number
      }
      upsert_career_record: {
        Args: {
          actor_user_id: string
          target_profile_id: string
          record_kind: string
          record_id: string
          record_input: Json
          action_request_id?: string
        }
        Returns: string
      }
      upsert_ingested_job: {
        Args: {
          target_source_id: string
          job_input: Json
          action_request_id?: string
        }
        Returns: Json
      }
      upsert_job_application: {
        Args: {
          actor_user_id: string
          application_input: Json
          action_request_id?: string
        }
        Returns: Json
      }
      usage_summary: {
        Args: {
          actor_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "disabled" | "pending_deletion"
      admin_membership_status: "active" | "suspended" | "revoked"
      application_artifact_kind:
        | "resume"
        | "cover_letter"
        | "strategy"
        | "requirement_map"
        | "recruiter_message"
        | "interview_prep"
      application_pack_status:
        "queued" | "generating" | "ready" | "failed" | "archived"
      application_source_kind: "hanaply" | "external" | "referral"
      application_stage:
        | "saved"
        | "preparing"
        | "applied"
        | "interviewing"
        | "offer"
        | "rejected"
        | "withdrawn"
        | "archived"
      audit_actor_type: "user" | "admin" | "service" | "system"
      availability_status:
        | "immediately"
        | "two_weeks"
        | "one_month"
        | "three_months"
        | "not_looking"
      billing_period: "monthly" | "annual"
      career_document_kind: "resume" | "cover_letter" | "portfolio" | "other"
      career_document_status:
        | "uploaded"
        | "processing"
        | "parsed"
        | "needs_review"
        | "failed"
        | "rejected"
        | "archived"
      career_fact_category:
        | "experience"
        | "responsibility"
        | "achievement"
        | "metric"
        | "skill"
        | "education"
        | "certification"
        | "preference"
        | "goal"
      career_fact_source:
        "user_entered" | "resume_extraction" | "ai_inference" | "imported"
      career_fact_status: "candidate" | "confirmed" | "rejected" | "superseded"
      career_level:
        | "student"
        | "entry"
        | "junior"
        | "mid"
        | "senior"
        | "lead"
        | "manager"
        | "director"
        | "executive"
      career_link_kind:
        | "github"
        | "gitlab"
        | "linkedin"
        | "portfolio"
        | "personal_website"
        | "behance"
        | "dribbble"
        | "stackoverflow"
        | "other"
      career_profile_status: "draft" | "active" | "archived"
      career_skill_kind:
        "skill" | "tool" | "technology" | "language" | "soft_skill" | "domain"
      employment_type:
        | "full_time"
        | "part_time"
        | "contract"
        | "freelance"
        | "internship"
        | "temporary"
        | "volunteer"
      entitlement_value_type: "boolean" | "integer" | "string"
      job_feedback_kind:
        | "interested"
        | "not_interested"
        | "wrong_role"
        | "wrong_seniority"
        | "wrong_location"
        | "salary_too_low"
        | "already_applied"
        | "irrelevant"
        | "saved"
      job_ingestion_run_status: "running" | "succeeded" | "partial" | "failed"
      job_ingestion_trigger: "schedule" | "manual" | "backfill" | "retry"
      job_match_confidence: "high" | "medium" | "low"
      job_match_verdict:
        | "strong_match"
        | "good_match"
        | "stretch"
        | "weak_match"
        | "not_recommended"
      job_remote_state: "remote" | "hybrid" | "onsite" | "unspecified"
      job_requirement_status: "met" | "partially_met" | "unmet" | "unknown"
      job_seniority:
        | "internship"
        | "entry"
        | "junior"
        | "mid"
        | "senior"
        | "lead"
        | "principal"
        | "manager"
        | "director"
        | "executive"
        | "unspecified"
      job_source_kind:
        | "remotive"
        | "arbeitnow"
        | "greenhouse"
        | "lever"
        | "ashby"
        | "hn_algolia"
        | "adzuna"
        | "jooble"
        | "partner_feed"
        | "manual"
      job_source_record_status: "active" | "removed" | "stale"
      job_source_status: "active" | "paused" | "disabled"
      job_status:
        "active" | "stale" | "expired" | "closed" | "duplicate" | "rejected"
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
      proficiency_level: "beginner" | "intermediate" | "advanced" | "expert"
      salary_period: "hourly" | "daily" | "monthly" | "annual"
      storage_cleanup_status: "pending" | "completed" | "failed"
      subscription_source:
        "manual_payment" | "admin_grant" | "migration" | "promotion"
      subscription_status:
        | "pending_activation"
        | "active"
        | "grace_period"
        | "expired"
        | "cancelled"
        | "suspended"
        | "refunded"
        | "reversed"
      usage_feature:
        | "application_pack"
        | "resume_variant"
        | "cover_letter"
        | "ai_analysis"
        | "interview_prep"
        | "recruiter_message"
        | "coach_message"
      work_arrangement: "remote" | "hybrid" | "onsite" | "flexible"
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
    Enums: {
      account_status: ["active", "suspended", "disabled", "pending_deletion"],
      admin_membership_status: ["active", "suspended", "revoked"],
      application_artifact_kind: [
        "resume",
        "cover_letter",
        "strategy",
        "requirement_map",
        "recruiter_message",
        "interview_prep",
      ],
      application_pack_status: [
        "queued",
        "generating",
        "ready",
        "failed",
        "archived",
      ],
      application_source_kind: ["hanaply", "external", "referral"],
      application_stage: [
        "saved",
        "preparing",
        "applied",
        "interviewing",
        "offer",
        "rejected",
        "withdrawn",
        "archived",
      ],
      audit_actor_type: ["user", "admin", "service", "system"],
      availability_status: [
        "immediately",
        "two_weeks",
        "one_month",
        "three_months",
        "not_looking",
      ],
      billing_period: ["monthly", "annual"],
      career_document_kind: ["resume", "cover_letter", "portfolio", "other"],
      career_document_status: [
        "uploaded",
        "processing",
        "parsed",
        "needs_review",
        "failed",
        "rejected",
        "archived",
      ],
      career_fact_category: [
        "experience",
        "responsibility",
        "achievement",
        "metric",
        "skill",
        "education",
        "certification",
        "preference",
        "goal",
      ],
      career_fact_source: [
        "user_entered",
        "resume_extraction",
        "ai_inference",
        "imported",
      ],
      career_fact_status: ["candidate", "confirmed", "rejected", "superseded"],
      career_level: [
        "student",
        "entry",
        "junior",
        "mid",
        "senior",
        "lead",
        "manager",
        "director",
        "executive",
      ],
      career_link_kind: [
        "github",
        "gitlab",
        "linkedin",
        "portfolio",
        "personal_website",
        "behance",
        "dribbble",
        "stackoverflow",
        "other",
      ],
      career_profile_status: ["draft", "active", "archived"],
      career_skill_kind: [
        "skill",
        "tool",
        "technology",
        "language",
        "soft_skill",
        "domain",
      ],
      employment_type: [
        "full_time",
        "part_time",
        "contract",
        "freelance",
        "internship",
        "temporary",
        "volunteer",
      ],
      entitlement_value_type: ["boolean", "integer", "string"],
      job_feedback_kind: [
        "interested",
        "not_interested",
        "wrong_role",
        "wrong_seniority",
        "wrong_location",
        "salary_too_low",
        "already_applied",
        "irrelevant",
        "saved",
      ],
      job_ingestion_run_status: ["running", "succeeded", "partial", "failed"],
      job_ingestion_trigger: ["schedule", "manual", "backfill", "retry"],
      job_match_confidence: ["high", "medium", "low"],
      job_match_verdict: [
        "strong_match",
        "good_match",
        "stretch",
        "weak_match",
        "not_recommended",
      ],
      job_remote_state: ["remote", "hybrid", "onsite", "unspecified"],
      job_requirement_status: ["met", "partially_met", "unmet", "unknown"],
      job_seniority: [
        "internship",
        "entry",
        "junior",
        "mid",
        "senior",
        "lead",
        "principal",
        "manager",
        "director",
        "executive",
        "unspecified",
      ],
      job_source_kind: [
        "remotive",
        "arbeitnow",
        "greenhouse",
        "lever",
        "ashby",
        "hn_algolia",
        "adzuna",
        "jooble",
        "partner_feed",
        "manual",
      ],
      job_source_record_status: ["active", "removed", "stale"],
      job_source_status: ["active", "paused", "disabled"],
      job_status: [
        "active",
        "stale",
        "expired",
        "closed",
        "duplicate",
        "rejected",
      ],
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
      proficiency_level: ["beginner", "intermediate", "advanced", "expert"],
      salary_period: ["hourly", "daily", "monthly", "annual"],
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
      usage_feature: [
        "application_pack",
        "resume_variant",
        "cover_letter",
        "ai_analysis",
        "interview_prep",
        "recruiter_message",
        "coach_message",
      ],
      work_arrangement: ["remote", "hybrid", "onsite", "flexible"],
    },
  },
} as const
