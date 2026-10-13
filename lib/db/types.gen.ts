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
      audit_log: {
        Row: {
          action: string
          actor_kind: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          event_id: string | null
          id: number
          subject_id: string | null
        }
        Insert: {
          action: string
          actor_kind: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: never
          subject_id?: string | null
        }
        Update: {
          action?: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: never
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      checkpoints: {
        Row: {
          capacity: number | null
          event_id: string
          id: string
          is_open: boolean
          kind: Database["public"]["Enums"]["checkpoint_kind"]
          name: string
          points: number
          requires_checkin: boolean
          seconds_open: boolean
          sort_order: number
          starts_at: string | null
        }
        Insert: {
          capacity?: number | null
          event_id: string
          id?: string
          is_open?: boolean
          kind: Database["public"]["Enums"]["checkpoint_kind"]
          name: string
          points?: number
          requires_checkin?: boolean
          seconds_open?: boolean
          sort_order?: number
          starts_at?: string | null
        }
        Update: {
          capacity?: number | null
          event_id?: string
          id?: string
          is_open?: boolean
          kind?: Database["public"]["Enums"]["checkpoint_kind"]
          name?: string
          points?: number
          requires_checkin?: boolean
          seconds_open?: boolean
          sort_order?: number
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkpoints_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_taps: {
        Row: {
          created_at: string
          event_id: string
          from_participant_id: string
          to_participant_id: string
          via_tag_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          from_participant_id: string
          to_participant_id: string
          via_tag_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          from_participant_id?: string
          to_participant_id?: string
          via_tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_taps_from_participant_id_event_id_fkey"
            columns: ["from_participant_id", "event_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "connection_taps_to_participant_id_event_id_fkey"
            columns: ["to_participant_id", "event_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "connection_taps_via_tag_id_fkey"
            columns: ["via_tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          kind_group: string | null
          last_error: string | null
          locked_until: string | null
          next_attempt_at: string
          participant_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["outbox_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          kind_group?: string | null
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          participant_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          kind_group?: string | null
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          participant_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_staff: {
        Row: {
          added_at: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Insert: {
          added_at?: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Update: {
          added_at?: string
          event_id?: string
          role?: Database["public"]["Enums"]["staff_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          badge_unlock_password: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          leaderboard_frozen_at: string | null
          leaderboard_refresh_minutes: number
          name: string
          organizer_connection_bonus: number
          organizers_compete: boolean
          profile_retention_days: number
          recap_message: string | null
          sheet_id: string | null
          slug: string
          starts_at: string
          timezone: string
          venue: string
        }
        Insert: {
          badge_unlock_password?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          leaderboard_frozen_at?: string | null
          leaderboard_refresh_minutes?: number
          name: string
          organizer_connection_bonus?: number
          organizers_compete?: boolean
          profile_retention_days?: number
          recap_message?: string | null
          sheet_id?: string | null
          slug: string
          starts_at: string
          timezone?: string
          venue: string
        }
        Update: {
          badge_unlock_password?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          leaderboard_frozen_at?: string | null
          leaderboard_refresh_minutes?: number
          name?: string
          organizer_connection_bonus?: number
          organizers_compete?: boolean
          profile_retention_days?: number
          recap_message?: string | null
          sheet_id?: string | null
          slug?: string
          starts_at?: string
          timezone?: string
          venue?: string
        }
        Relationships: []
      }
      participant_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_seen_at: string
          participant_id: string
          revoked_at: string | null
          session_hash: string
          via: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          last_seen_at?: string
          participant_id: string
          revoked_at?: string | null
          session_hash: string
          via: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          participant_id?: string
          revoked_at?: string | null
          session_hash?: string
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_sessions_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          accessibility_notes: string | null
          badge_role: string
          created_at: string
          deleted_at: string | null
          dietary_notes: string | null
          email: string
          event_id: string
          external_id: string | null
          first_name: string
          id: string
          is_test: boolean
          last_name: string
          linkedin_url: string | null
          owner_edited: string[]
          photo_path: string | null
          photo_updated_at: string | null
          search_text: string
          source: string
          staff_user_id: string | null
          status: Database["public"]["Enums"]["participant_status"]
          updated_at: string
        }
        Insert: {
          accessibility_notes?: string | null
          badge_role?: string
          created_at?: string
          deleted_at?: string | null
          dietary_notes?: string | null
          email: string
          event_id: string
          external_id?: string | null
          first_name: string
          id?: string
          is_test?: boolean
          last_name?: string
          linkedin_url?: string | null
          owner_edited?: string[]
          photo_path?: string | null
          photo_updated_at?: string | null
          search_text: string
          source: string
          staff_user_id?: string | null
          status: Database["public"]["Enums"]["participant_status"]
          updated_at?: string
        }
        Update: {
          accessibility_notes?: string | null
          badge_role?: string
          created_at?: string
          deleted_at?: string | null
          dietary_notes?: string | null
          email?: string
          event_id?: string
          external_id?: string | null
          first_name?: string
          id?: string
          is_test?: boolean
          last_name?: string
          linkedin_url?: string | null
          owner_edited?: string[]
          photo_path?: string | null
          photo_updated_at?: string | null
          search_text?: string
          source?: string
          staff_user_id?: string | null
          status?: Database["public"]["Enums"]["participant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      passes: {
        Row: {
          id: string
          issued_at: string
          participant_id: string
          revoke_reason: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          id?: string
          issued_at?: string
          participant_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          id?: string
          issued_at?: string
          participant_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "passes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          added_at: string
          email: string
          user_id: string | null
        }
        Insert: {
          added_at?: string
          email: string
          user_id?: string | null
        }
        Update: {
          added_at?: string
          email?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profile_keys: {
        Row: {
          id: string
          issued_at: string
          key_hash: string
          participant_id: string
          revoke_reason: string | null
          revoked_at: string | null
        }
        Insert: {
          id?: string
          issued_at?: string
          key_hash: string
          participant_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
        }
        Update: {
          id?: string
          issued_at?: string
          key_hash?: string
          participant_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_keys_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ask_me_about: string[]
          bio: string | null
          discord_handle: string | null
          github_url: string | null
          hidden_by_staff_at: string | null
          linkedin_url: string | null
          looking_for: string[]
          nickname: string | null
          participant_id: string
          program: string | null
          pronouns: string | null
          public_fields: string[]
          updated_at: string
          visibility: string
          website_url: string | null
          year_label: string | null
        }
        Insert: {
          ask_me_about?: string[]
          bio?: string | null
          discord_handle?: string | null
          github_url?: string | null
          hidden_by_staff_at?: string | null
          linkedin_url?: string | null
          looking_for?: string[]
          nickname?: string | null
          participant_id: string
          program?: string | null
          pronouns?: string | null
          public_fields?: string[]
          updated_at?: string
          visibility?: string
          website_url?: string | null
          year_label?: string | null
        }
        Update: {
          ask_me_about?: string[]
          bio?: string | null
          discord_handle?: string | null
          github_url?: string | null
          hidden_by_staff_at?: string | null
          linkedin_url?: string | null
          looking_for?: string[]
          nickname?: string | null
          participant_id?: string
          program?: string | null
          pronouns?: string | null
          public_fields?: string[]
          updated_at?: string
          visibility?: string
          website_url?: string | null
          year_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits?: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      scan_attempts: {
        Row: {
          checkpoint_id: string | null
          created_at: string
          event_id: string | null
          id: number
          latency_ms: number | null
          participant_id: string | null
          result_code: string
          staff_user_id: string | null
        }
        Insert: {
          checkpoint_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: never
          latency_ms?: number | null
          participant_id?: string | null
          result_code: string
          staff_user_id?: string | null
        }
        Update: {
          checkpoint_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: never
          latency_ms?: number | null
          participant_id?: string | null
          result_code?: string
          staff_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_attempts_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_attempts_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "v_checkpoint_counts"
            referencedColumns: ["checkpoint_id"]
          },
          {
            foreignKeyName: "scan_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      scans: {
        Row: {
          checkpoint_id: string
          client_scan_id: string
          client_scanned_at: string | null
          event_id: string
          id: string
          method: Database["public"]["Enums"]["scan_method"]
          participant_id: string
          pass_id: string | null
          scanned_at: string
          scanned_by: string
          serving_no: number
          tag_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          checkpoint_id: string
          client_scan_id: string
          client_scanned_at?: string | null
          event_id: string
          id?: string
          method: Database["public"]["Enums"]["scan_method"]
          participant_id: string
          pass_id?: string | null
          scanned_at?: string
          scanned_by: string
          serving_no?: number
          tag_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          checkpoint_id?: string
          client_scan_id?: string
          client_scanned_at?: string | null
          event_id?: string
          id?: string
          method?: Database["public"]["Enums"]["scan_method"]
          participant_id?: string
          pass_id?: string | null
          scanned_at?: string
          scanned_by?: string
          serving_no?: number
          tag_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scans_checkpoint_id_event_id_fkey"
            columns: ["checkpoint_id", "event_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "scans_checkpoint_id_event_id_fkey"
            columns: ["checkpoint_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_checkpoint_counts"
            referencedColumns: ["checkpoint_id", "event_id"]
          },
          {
            foreignKeyName: "scans_participant_id_event_id_fkey"
            columns: ["participant_id", "event_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "scans_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "passes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scans_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      signin_codes: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string
          expires_at: string
          participant_id: string
          purpose: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by: string
          expires_at: string
          participant_id: string
          purpose: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          participant_id?: string
          purpose?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signin_codes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          email: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          email: string
          event_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          email?: string
          event_id?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          display_name: string
          user_id: string
        }
        Insert: {
          display_name: string
          user_id: string
        }
        Update: {
          display_name?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_stations: {
        Row: {
          checkpoint_id: string
          event_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checkpoint_id: string
          event_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checkpoint_id?: string
          event_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_stations_checkpoint_id_event_id_fkey"
            columns: ["checkpoint_id", "event_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "staff_stations_checkpoint_id_event_id_fkey"
            columns: ["checkpoint_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_checkpoint_counts"
            referencedColumns: ["checkpoint_id", "event_id"]
          },
        ]
      }
      tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          event_id: string
          id: string
          participant_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          event_id: string
          id?: string
          participant_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          event_id?: string
          id?: string
          participant_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_assignments_participant_id_event_id_fkey"
            columns: ["participant_id", "event_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "tag_assignments_tag_id_event_id_fkey"
            columns: ["tag_id", "event_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      tags: {
        Row: {
          event_id: string
          id: string
          label: string | null
          public_id: string
          registered_at: string
          registered_by: string | null
          retire_reason: string | null
          retired_at: string | null
          uid: string | null
        }
        Insert: {
          event_id: string
          id?: string
          label?: string | null
          public_id: string
          registered_at?: string
          registered_by?: string | null
          retire_reason?: string | null
          retired_at?: string | null
          uid?: string | null
        }
        Update: {
          event_id?: string
          id?: string
          label?: string | null
          public_id?: string
          registered_at?: string
          registered_by?: string | null
          retire_reason?: string | null
          retired_at?: string | null
          uid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_checkpoint_counts: {
        Row: {
          capacity: number | null
          checkpoint_id: string | null
          event_id: string | null
          kind: Database["public"]["Enums"]["checkpoint_kind"] | null
          live_scans: number | null
          name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkpoints_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _display_name: {
        Args: {
          nick: string
          pa: Database["public"]["Tables"]["participants"]["Row"]
        }
        Returns: string
      }
      _eligible: {
        Args: { pa: Database["public"]["Tables"]["participants"]["Row"] }
        Returns: boolean
      }
      _find_tag: {
        Args: { p_public_id: string; p_uid: string }
        Returns: {
          event_id: string
          id: string
          label: string | null
          public_id: string
          registered_at: string
          registered_by: string | null
          retire_reason: string | null
          retired_at: string | null
          uid: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _ingest_profile_answers: {
        Args: {
          p_looking_for: string[]
          p_participant_id: string
          p_skills: string[]
          p_update: boolean
        }
        Returns: undefined
      }
      _labels_ok: { Args: { a: string[] }; Returns: boolean }
      _prior: {
        Args: { me: string; s: Database["public"]["Tables"]["scans"]["Row"] }
        Returns: Json
      }
      _tag_holder: { Args: { p_participant_id: string }; Returns: Json }
      _who: {
        Args: {
          k: Database["public"]["Enums"]["checkpoint_kind"]
          pa: Database["public"]["Tables"]["participants"]["Row"]
        }
        Returns: Json
      }
      add_walk_in: {
        Args: {
          p_check_in: boolean
          p_email: string
          p_event_id: string
          p_first_name: string
          p_last_name: string
          p_organizer_id: string
          p_search_text: string
          p_send_pass: boolean
        }
        Returns: Json
      }
      admin_participants: {
        Args: {
          p_event_id: string
          p_no_show?: boolean
          p_query?: string
          p_status?: Database["public"]["Enums"]["participant_status"]
        }
        Returns: {
          checked_in: boolean
          created_at: string
          dietary_notes: string
          email: string
          external_id: string
          first_name: string
          id: string
          is_test: boolean
          last_name: string
          live_scans: number
          pass_state: string
          photo_path: string
          photo_updated_at: string
          source: string
          status: Database["public"]["Enums"]["participant_status"]
        }[]
      }
      assign_tag: {
        Args: {
          p_event_id: string
          p_participant_id: string
          p_public_id: string
          p_replace?: boolean
          p_staff_id: string
          p_uid: string
        }
        Returns: Json
      }
      claim_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          id: string
          kind: string
          kind_group: string | null
          last_error: string | null
          locked_until: string | null
          next_attempt_at: string
          participant_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["outbox_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "email_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      connection_stats: { Args: { p_event_id: string }; Returns: Json }
      consume_platform_admin: {
        Args: { p_email: string; p_user_id: string }
        Returns: boolean
      }
      consume_staff_invites: {
        Args: { p_email: string; p_user_id: string }
        Returns: number
      }
      create_event: {
        Args: {
          p_admin_id: string
          p_ends_at: string
          p_name: string
          p_slug: string
          p_starts_at: string
          p_timezone: string
          p_venue: string
        }
        Returns: Json
      }
      delete_checkpoint: {
        Args: { p_actor: string; p_checkpoint_id: string; p_event_id: string }
        Returns: string
      }
      delete_participant: {
        Args: { p_actor: string; p_event_id: string; p_participant_id: string }
        Returns: Json
      }
      door_link_new_tag: {
        Args: {
          p_event_id: string
          p_participant_id: string
          p_public_id: string
          p_replace?: boolean
          p_staff_id: string
          p_uid: string
        }
        Returns: Json
      }
      end_profile_session: {
        Args: { p_session_hash: string }
        Returns: undefined
      }
      enqueue_pass: {
        Args: { p_actor: string; p_event_id: string; p_participant_id: string }
        Returns: string
      }
      enqueue_recaps: {
        Args: { p_actor: string; p_event_id: string }
        Returns: number
      }
      ensure_staff_attendee: {
        Args: { p_event_id: string; p_search_text: string; p_user_id: string }
        Returns: Json
      }
      event_metrics: {
        Args: { p_event_id: string; p_now?: string }
        Returns: Json
      }
      finish_outbox: {
        Args: {
          p_id: string
          p_last_error?: string
          p_next_attempt_at?: string
          p_provider_message_id?: string
          p_status: Database["public"]["Enums"]["outbox_status"]
        }
        Returns: boolean
      }
      holder_involvement: { Args: { p_participant_id: string }; Returns: Json }
      ingest_sheet_row: {
        Args: {
          p_accessibility_notes?: string
          p_dietary_notes?: string
          p_dry_run?: boolean
          p_email: string
          p_event_id: string
          p_external_id: string
          p_first_name: string
          p_last_name: string
          p_linkedin_url?: string
          p_looking_for?: string[]
          p_search_text: string
          p_skills?: string[]
          p_status: Database["public"]["Enums"]["participant_status"]
        }
        Returns: string
      }
      invite_staff: {
        Args: {
          p_actor: string
          p_email: string
          p_event_id: string
          p_role: Database["public"]["Enums"]["staff_role"]
        }
        Returns: string
      }
      is_platform_admin: { Args: { p_user_id: string }; Returns: boolean }
      issue_pass: {
        Args: { p_participant_id: string; p_token_hash: string }
        Returns: string
      }
      issue_profile_key: {
        Args: { p_key_hash: string; p_participant_id: string }
        Returns: string
      }
      issue_signin_code: {
        Args: {
          p_code_hash: string
          p_created_by: string
          p_participant_id: string
          p_purpose: string
        }
        Returns: string
      }
      join_event_as_admin: {
        Args: { p_admin_id: string; p_event_id: string }
        Returns: string
      }
      leaderboard: {
        Args: {
          p_as_of: string
          p_event_id: string
          p_kind: string
          p_limit?: number
        }
        Returns: {
          display_name: string
          participant_id: string
          points: number
          rank: number
          reached_at: string
        }[]
      }
      list_events_for: {
        Args: { p_user_id: string }
        Returns: {
          ends_at: string
          id: string
          my_role: Database["public"]["Enums"]["staff_role"]
          name: string
          slug: string
          starts_at: string
          timezone: string
        }[]
      }
      mark_owner_edited: {
        Args: { p_fields: string[]; p_participant_id: string }
        Returns: undefined
      }
      my_connections: { Args: { p_participant_id: string }; Returns: Json }
      open_profile_session: {
        Args: { p_key_hash: string; p_session_hash: string; p_ttl: string }
        Returns: Json
      }
      pass_lookup: { Args: { p_token_hash: string }; Returns: Json }
      points_as_of: {
        Args: { p_as_of: string; p_event_id: string }
        Returns: {
          activity: number
          activity_at: string
          networking: number
          networking_at: string
          participant_id: string
        }[]
      }
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      recap_stats: { Args: { p_participant_id: string }; Returns: Json }
      record_connection: {
        Args: { p_from_participant_id: string; p_tag_public_id: string }
        Returns: Json
      }
      record_scan: {
        Args: {
          p_checkpoint_id: string
          p_client_scan_id: string
          p_client_scanned_at: string
          p_confirm_repeat?: boolean
          p_method: Database["public"]["Enums"]["scan_method"]
          p_participant_id: string
          p_staff_user_id: string
          p_tag_public_id: string
          p_tag_uid: string
          p_token_hash: string
        }
        Returns: Json
      }
      redeem_signin_code: {
        Args: { p_code_hash: string; p_session_hash: string; p_ttl: string }
        Returns: Json
      }
      register_tag: {
        Args: {
          p_event_id: string
          p_label?: string
          p_public_id: string
          p_staff_id: string
          p_uid: string
        }
        Returns: string
      }
      remove_staff: {
        Args: { p_actor: string; p_event_id: string; p_user_id: string }
        Returns: string
      }
      request_profile_link: {
        Args: { p_participant_id: string }
        Returns: string
      }
      reserve_door_tag: {
        Args: {
          p_event_id: string
          p_participant_id: string
          p_public_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      reserve_tag: {
        Args: { p_event_id: string; p_public_id: string; p_staff_id: string }
        Returns: Json
      }
      retain_event_profiles: { Args: { p_event_id: string }; Returns: Json }
      revoke_pass: {
        Args: { p_actor: string; p_event_id: string; p_participant_id: string }
        Returns: string
      }
      rotate_profile_keys: {
        Args: { p_new_key_hash: string; p_participant_id: string }
        Returns: string
      }
      search_participants: {
        Args: { p_checkpoint_id?: string; p_event_id: string; p_query: string }
        Returns: {
          email: string
          first_name: string
          id: string
          last_name: string
          photo_path: string
          scanned_here: boolean
          status: Database["public"]["Enums"]["participant_status"]
        }[]
      }
      session_participant: { Args: { p_session_hash: string }; Returns: string }
      set_staff_station: {
        Args: { p_checkpoint_id: string; p_user_id: string }
        Returns: string
      }
      tag_view: { Args: { p_public_id: string }; Returns: Json }
      unassign_tag: {
        Args: { p_assignment_id: string; p_staff_id: string }
        Returns: string
      }
      void_scan: {
        Args: { p_reason: string; p_scan_id: string; p_staff_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      checkpoint_kind: "door" | "meal" | "session" | "custom"
      outbox_status: "pending" | "sending" | "sent" | "failed" | "cancelled"
      participant_status:
        | "pending"
        | "accepted"
        | "waitlisted"
        | "rejected"
        | "withdrawn"
      scan_method: "qr" | "manual" | "nfc"
      staff_role: "organizer" | "volunteer"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      checkpoint_kind: ["door", "meal", "session", "custom"],
      outbox_status: ["pending", "sending", "sent", "failed", "cancelled"],
      participant_status: [
        "pending",
        "accepted",
        "waitlisted",
        "rejected",
        "withdrawn",
      ],
      scan_method: ["qr", "manual", "nfc"],
      staff_role: ["organizer", "volunteer"],
    },
  },
} as const

