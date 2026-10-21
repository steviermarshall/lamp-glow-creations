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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      applications: {
        Row: {
          amount_requested: number | null
          answers: Json
          assigned_at: string | null
          business_id: string | null
          business_name: string | null
          closed_at: string | null
          created_at: string
          decline_reason: string | null
          email: string | null
          first_name: string | null
          funded_at: string | null
          id: string
          phone: string | null
          phone_consent_at: string | null
          phone_consent_text: string | null
          purpose: string | null
          rep_slug: string | null
          source_rep_slug: string | null
          staff_notes: string | null
          status: Database["public"]["Enums"]["application_stage"]
          submitted_at: string | null
          updated_at: string
          user_id: string
          utm: Json
        }
        Insert: {
          amount_requested?: number | null
          answers?: Json
          assigned_at?: string | null
          business_id?: string | null
          business_name?: string | null
          closed_at?: string | null
          created_at?: string
          decline_reason?: string | null
          email?: string | null
          first_name?: string | null
          funded_at?: string | null
          id?: string
          phone?: string | null
          phone_consent_at?: string | null
          phone_consent_text?: string | null
          purpose?: string | null
          rep_slug?: string | null
          source_rep_slug?: string | null
          staff_notes?: string | null
          status?: Database["public"]["Enums"]["application_stage"]
          submitted_at?: string | null
          updated_at?: string
          user_id: string
          utm?: Json
        }
        Update: {
          amount_requested?: number | null
          answers?: Json
          assigned_at?: string | null
          business_id?: string | null
          business_name?: string | null
          closed_at?: string | null
          created_at?: string
          decline_reason?: string | null
          email?: string | null
          first_name?: string | null
          funded_at?: string | null
          id?: string
          phone?: string | null
          phone_consent_at?: string | null
          phone_consent_text?: string | null
          purpose?: string | null
          rep_slug?: string | null
          source_rep_slug?: string | null
          staff_notes?: string | null
          status?: Database["public"]["Enums"]["application_stage"]
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "applications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_rep_slug_fkey"
            columns: ["rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "applications_source_rep_slug_fkey"
            columns: ["source_rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
        ]
      }
      businesses: {
        Row: {
          created_at: string
          dba: string | null
          entity_type: string | null
          id: string
          industry: string | null
          legal_name: string | null
          monthly_deposits: number | null
          notes: string | null
          owner_user_id: string
          started_on: string | null
          state: string | null
          updated_at: string
          website: string | null
          zip: string | null
        }
        Insert: {
          created_at?: string
          dba?: string | null
          entity_type?: string | null
          id?: string
          industry?: string | null
          legal_name?: string | null
          monthly_deposits?: number | null
          notes?: string | null
          owner_user_id: string
          started_on?: string | null
          state?: string | null
          updated_at?: string
          website?: string | null
          zip?: string | null
        }
        Update: {
          created_at?: string
          dba?: string | null
          entity_type?: string | null
          id?: string
          industry?: string | null
          legal_name?: string | null
          monthly_deposits?: number | null
          notes?: string | null
          owner_user_id?: string
          started_on?: string | null
          state?: string | null
          updated_at?: string
          website?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      commission_entries: {
        Row: {
          amount: number
          counterparty: string | null
          created_at: string
          created_by: string | null
          deal_id: string
          entry_date: string
          id: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          note: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          deal_id: string
          entry_date?: string
          id?: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          note?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string
          entry_date?: string
          id?: string
          kind?: Database["public"]["Enums"]["ledger_kind"]
          note?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          application_id: string
          commission_due: number | null
          commission_points: number | null
          created_at: string
          funded_amount: number
          funded_on: string
          funder_id: string
          id: string
          notes: string | null
          offer_id: string
          payback: number
          rep_slug: string | null
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
        }
        Insert: {
          application_id: string
          commission_due?: number | null
          commission_points?: number | null
          created_at?: string
          funded_amount: number
          funded_on?: string
          funder_id: string
          id?: string
          notes?: string | null
          offer_id: string
          payback: number
          rep_slug?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
        }
        Update: {
          application_id?: string
          commission_due?: number | null
          commission_points?: number | null
          created_at?: string
          funded_amount?: number
          funded_on?: string
          funder_id?: string
          id?: string
          notes?: string | null
          offer_id?: string
          payback?: number
          rep_slug?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_funder_id_fkey"
            columns: ["funder_id"]
            isOneToOne: false
            referencedRelation: "funders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "my_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_rep_slug_fkey"
            columns: ["rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
        ]
      }
      documents: {
        Row: {
          application_id: string
          bucket: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["document_kind"]
          mime_type: string | null
          original_name: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id: string
          bucket?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          mime_type?: string | null
          original_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string
          bucket?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          mime_type?: string | null
          original_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_user_id: string | null
          application_id: string | null
          body: string | null
          created_at: string
          from_stage: Database["public"]["Enums"]["application_stage"] | null
          id: number
          kind: Database["public"]["Enums"]["event_kind"]
          lead_id: string | null
          occurred_at: string
          payload: Json
          to_stage: Database["public"]["Enums"]["application_stage"] | null
          visible_to_merchant: boolean
        }
        Insert: {
          actor_user_id?: string | null
          application_id?: string | null
          body?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["application_stage"] | null
          id?: never
          kind: Database["public"]["Enums"]["event_kind"]
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          to_stage?: Database["public"]["Enums"]["application_stage"] | null
          visible_to_merchant?: boolean
        }
        Update: {
          actor_user_id?: string | null
          application_id?: string | null
          body?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["application_stage"] | null
          id?: never
          kind?: Database["public"]["Enums"]["event_kind"]
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          to_stage?: Database["public"]["Enums"]["application_stage"] | null
          visible_to_merchant?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      funders: {
        Row: {
          active: boolean
          commission_points: number | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          industries_excluded: string[]
          max_amount: number | null
          max_positions: number | null
          min_amount: number | null
          min_credit_score: number | null
          min_monthly_deposits: number | null
          min_months_in_business: number | null
          name: string
          notes: string | null
          paper_grades: string[]
          portal_url: string | null
          states_excluded: string[]
          submission_email: string | null
          type: Database["public"]["Enums"]["funder_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          commission_points?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          industries_excluded?: string[]
          max_amount?: number | null
          max_positions?: number | null
          min_amount?: number | null
          min_credit_score?: number | null
          min_monthly_deposits?: number | null
          min_months_in_business?: number | null
          name: string
          notes?: string | null
          paper_grades?: string[]
          portal_url?: string | null
          states_excluded?: string[]
          submission_email?: string | null
          type?: Database["public"]["Enums"]["funder_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          commission_points?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          industries_excluded?: string[]
          max_amount?: number | null
          max_positions?: number | null
          min_amount?: number | null
          min_credit_score?: number | null
          min_monthly_deposits?: number | null
          min_months_in_business?: number | null
          name?: string
          notes?: string | null
          paper_grades?: string[]
          portal_url?: string | null
          states_excluded?: string[]
          submission_email?: string | null
          type?: Database["public"]["Enums"]["funder_type"]
          updated_at?: string
        }
        Relationships: []
      }
      engine_leads: {
        Row: {
          city: string | null
          email: string | null
          first_found: string | null
          id: number
          industry: string | null
          name: string | null
          need: number | null
          notes: string
          phone: string | null
          pushed_at: string
          reason: string | null
          rep_slug: string | null
          signals: Json
          source: string
          source_key: string
          state: string | null
          status: string
          tier: string | null
          worked_at: string | null
        }
        Insert: {
          city?: string | null
          email?: string | null
          first_found?: string | null
          id?: number
          industry?: string | null
          name?: string | null
          need?: number | null
          notes?: string
          phone?: string | null
          pushed_at?: string
          reason?: string | null
          rep_slug?: string | null
          signals?: Json
          source: string
          source_key: string
          state?: string | null
          status?: string
          tier?: string | null
          worked_at?: string | null
        }
        Update: {
          city?: string | null
          email?: string | null
          first_found?: string | null
          id?: number
          industry?: string | null
          name?: string | null
          need?: number | null
          notes?: string
          phone?: string | null
          pushed_at?: string
          reason?: string | null
          rep_slug?: string | null
          signals?: Json
          source?: string
          source_key?: string
          state?: string | null
          status?: string
          tier?: string | null
          worked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engine_leads_rep_slug_fkey"
            columns: ["rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
        ]
      }
      leads: {
        Row: {
          answers: Json
          converted_application_id: string | null
          converted_at: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          phone: string | null
          rep_slug: string | null
          source: string | null
          utm: Json
        }
        Insert: {
          answers?: Json
          converted_application_id?: string | null
          converted_at?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          phone?: string | null
          rep_slug?: string | null
          source?: string | null
          utm?: Json
        }
        Update: {
          answers?: Json
          converted_application_id?: string | null
          converted_at?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          phone?: string | null
          rep_slug?: string | null
          source?: string | null
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_application_id_fkey"
            columns: ["converted_application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_application_id_fkey"
            columns: ["converted_application_id"]
            isOneToOne: false
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_rep_slug_fkey"
            columns: ["rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
        ]
      }
      offers: {
        Row: {
          accepted_at: string | null
          amount: number
          application_id: string
          created_at: string
          created_by: string | null
          declined_at: string | null
          expires_at: string | null
          factor_rate: number | null
          fees: number
          frequency: Database["public"]["Enums"]["payment_frequency"]
          funder_id: string
          id: string
          notes: string | null
          payback: number
          payment: number | null
          payments: number
          presented_at: string | null
          received_net: number | null
          status: Database["public"]["Enums"]["offer_status"]
          submission_id: string | null
          terms: Json
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          amount: number
          application_id: string
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          expires_at?: string | null
          factor_rate?: number | null
          fees?: number
          frequency: Database["public"]["Enums"]["payment_frequency"]
          funder_id: string
          id?: string
          notes?: string | null
          payback: number
          payment?: number | null
          payments: number
          presented_at?: string | null
          received_net?: number | null
          status?: Database["public"]["Enums"]["offer_status"]
          submission_id?: string | null
          terms?: Json
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          amount?: number
          application_id?: string
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          expires_at?: string | null
          factor_rate?: number | null
          fees?: number
          frequency?: Database["public"]["Enums"]["payment_frequency"]
          funder_id?: string
          id?: string
          notes?: string | null
          payback?: number
          payment?: number | null
          payments?: number
          presented_at?: string | null
          received_net?: number | null
          status?: Database["public"]["Enums"]["offer_status"]
          submission_id?: string | null
          terms?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_funder_id_fkey"
            columns: ["funder_id"]
            isOneToOne: false
            referencedRelation: "funders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reps: {
        Row: {
          active: boolean
          created_at: string
          name: string
          photo_url: string | null
          slug: string
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          name: string
          photo_url?: string | null
          slug: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          name?: string
          photo_url?: string | null
          slug?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      role_invites: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          email: string
          invited_by: string | null
          rep_slug: string | null
          roles: Database["public"]["Enums"]["app_role"][]
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          email: string
          invited_by?: string | null
          rep_slug?: string | null
          roles?: Database["public"]["Enums"]["app_role"][]
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          email?: string
          invited_by?: string | null
          rep_slug?: string | null
          roles?: Database["public"]["Enums"]["app_role"][]
        }
        Relationships: [
          {
            foreignKeyName: "role_invites_rep_slug_fkey"
            columns: ["rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
        ]
      }
      submissions: {
        Row: {
          application_id: string
          created_at: string
          decided_at: string | null
          decline_reason: string | null
          funder_id: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["submission_status"]
          submitted_at: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          decided_at?: string | null
          decline_reason?: string | null
          funder_id: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          decided_at?: string | null
          decline_reason?: string | null
          funder_id?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_funder_id_fkey"
            columns: ["funder_id"]
            isOneToOne: false
            referencedRelation: "funders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      my_offers: {
        Row: {
          accepted_at: string | null
          amount: number | null
          application_id: string | null
          expires_at: string | null
          factor_rate: number | null
          fees: number | null
          frequency: Database["public"]["Enums"]["payment_frequency"] | null
          funder_name: string | null
          id: string | null
          payback: number | null
          payment: number | null
          payments: number | null
          presented_at: string | null
          received_net: number | null
          status: Database["public"]["Enums"]["offer_status"] | null
          terms: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "pipeline_board"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_board: {
        Row: {
          amount_bucket: string | null
          amount_requested: number | null
          assigned_at: string | null
          business_name: string | null
          created_at: string | null
          document_count: number | null
          documents_pending_review: number | null
          email: string | null
          first_name: string | null
          funded_at: string | null
          id: string | null
          industry: string | null
          last_activity_at: string | null
          last_touch: string | null
          offers_presented: number | null
          phone: string | null
          rep_slug: string | null
          revenue_bucket: string | null
          source_rep_slug: string | null
          status: Database["public"]["Enums"]["application_stage"] | null
          submission_count: number | null
          submitted_at: string | null
          timeline: string | null
          updated_at: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_source: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_rep_slug_fkey"
            columns: ["rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "applications_source_rep_slug_fkey"
            columns: ["source_rep_slug"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["slug"]
          },
        ]
      }
    }
    Functions: {
      accept_offer: {
        Args: { _offer_id: string }
        Returns: {
          accepted_at: string | null
          amount: number
          application_id: string
          created_at: string
          created_by: string | null
          declined_at: string | null
          expires_at: string | null
          factor_rate: number | null
          fees: number
          frequency: Database["public"]["Enums"]["payment_frequency"]
          funder_id: string
          id: string
          notes: string | null
          payback: number
          payment: number | null
          payments: number
          presented_at: string | null
          received_net: number | null
          status: Database["public"]["Enums"]["offer_status"]
          submission_id: string | null
          terms: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_rep_slug: { Args: { _user_id?: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id?: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id?: string }; Returns: boolean }
    }
    Enums: {
      app_role: "merchant" | "rep" | "admin"
      application_stage:
        | "new"
        | "reviewing"
        | "docs_needed"
        | "submitted"
        | "offers_ready"
        | "accepted"
        | "closing"
        | "funded"
        | "declined"
        | "withdrawn"
        | "closed"
      deal_status: "funded" | "paid_off" | "renewed" | "defaulted"
      document_kind:
        | "bank_statement"
        | "id"
        | "voided_check"
        | "tax_return"
        | "other"
      document_status: "received" | "accepted" | "rejected"
      event_kind:
        | "stage_change"
        | "assigned"
        | "note"
        | "call"
        | "email"
        | "sms"
        | "meeting"
        | "document_uploaded"
        | "document_reviewed"
        | "submitted_to_funder"
        | "offer_received"
        | "offer_presented"
        | "offer_accepted"
        | "offer_declined"
        | "funded"
        | "system"
      funder_type: "direct" | "iso" | "bank" | "other"
      ledger_kind: "owed" | "paid" | "clawback" | "adjustment"
      offer_status:
        | "received"
        | "presented"
        | "accepted"
        | "declined"
        | "expired"
        | "withdrawn"
      payment_frequency: "daily" | "weekly" | "biweekly" | "monthly"
      submission_status:
        | "submitted"
        | "declined"
        | "offer"
        | "withdrawn"
        | "expired"
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
    Enums: {
      app_role: ["merchant", "rep", "admin"],
      application_stage: [
        "new",
        "reviewing",
        "docs_needed",
        "submitted",
        "offers_ready",
        "accepted",
        "closing",
        "funded",
        "declined",
        "withdrawn",
        "closed",
      ],
      deal_status: ["funded", "paid_off", "renewed", "defaulted"],
      document_kind: [
        "bank_statement",
        "id",
        "voided_check",
        "tax_return",
        "other",
      ],
      document_status: ["received", "accepted", "rejected"],
      event_kind: [
        "stage_change",
        "assigned",
        "note",
        "call",
        "email",
        "sms",
        "meeting",
        "document_uploaded",
        "document_reviewed",
        "submitted_to_funder",
        "offer_received",
        "offer_presented",
        "offer_accepted",
        "offer_declined",
        "funded",
        "system",
      ],
      funder_type: ["direct", "iso", "bank", "other"],
      ledger_kind: ["owed", "paid", "clawback", "adjustment"],
      offer_status: [
        "received",
        "presented",
        "accepted",
        "declined",
        "expired",
        "withdrawn",
      ],
      payment_frequency: ["daily", "weekly", "biweekly", "monthly"],
      submission_status: [
        "submitted",
        "declined",
        "offer",
        "withdrawn",
        "expired",
      ],
    },
  },
} as const
