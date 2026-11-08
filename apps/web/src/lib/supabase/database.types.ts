// Generated from the live Supabase schema (Supabase MCP `generate_typescript_types`). Do not edit by hand.

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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          data: Json
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          data?: Json
          entity: string
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          data?: Json
          entity?: string
          entity_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          chain_badge_id: number
          event_id: string
          id: string
          minted_at: string
          public_key: string
          tx_hash: string
          user_id: string | null
        }
        Insert: {
          chain_badge_id: number
          event_id: string
          id?: string
          minted_at?: string
          public_key: string
          tx_hash: string
          user_id?: string | null
        }
        Update: {
          chain_badge_id?: number
          event_id?: string
          id?: string
          minted_at?: string
          public_key?: string
          tx_hash?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "badges_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chain_cursors: {
        Row: {
          contract_id: string
          last_ledger: number
          paging_token: string | null
          updated_at: string
        }
        Insert: {
          contract_id: string
          last_ledger?: number
          paging_token?: string | null
          updated_at?: string
        }
        Update: {
          contract_id?: string
          last_ledger?: number
          paging_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      checkins: {
        Row: {
          chain_status: Database["public"]["Enums"]["chain_sync_status"] | null
          client_scan_id: string
          device_label: string | null
          error: string | null
          event_id: string
          id: string
          received_at: string
          result: Database["public"]["Enums"]["checkin_result"]
          scanned_at: string
          scanner_user_id: string
          ticket_id: string | null
          tx_hash: string | null
        }
        Insert: {
          chain_status?: Database["public"]["Enums"]["chain_sync_status"] | null
          client_scan_id: string
          device_label?: string | null
          error?: string | null
          event_id: string
          id?: string
          received_at?: string
          result: Database["public"]["Enums"]["checkin_result"]
          scanned_at: string
          scanner_user_id: string
          ticket_id?: string | null
          tx_hash?: string | null
        }
        Update: {
          chain_status?: Database["public"]["Enums"]["chain_sync_status"] | null
          client_scan_id?: string
          device_label?: string | null
          error?: string | null
          event_id?: string
          id?: string
          received_at?: string
          result?: Database["public"]["Enums"]["checkin_result"]
          scanned_at?: string
          scanner_user_id?: string
          ticket_id?: string | null
          tx_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_scanner_user_id_fkey"
            columns: ["scanner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      custodial_keys: {
        Row: {
          auth_tag: string
          ciphertext: string
          created_at: string
          iv: string
          key_version: number
          wallet_id: string
        }
        Insert: {
          auth_tag: string
          ciphertext: string
          created_at?: string
          iv: string
          key_version?: number
          wallet_id: string
        }
        Update: {
          auth_tag?: string
          ciphertext?: string
          created_at?: string
          iv?: string
          key_version?: number
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custodial_keys_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: true
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      event_scanners: {
        Row: {
          added_by: string | null
          chain_synced_at: string | null
          created_at: string
          enabled: boolean
          event_id: string
          scanner_public_key: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          chain_synced_at?: string | null
          created_at?: string
          enabled?: boolean
          event_id: string
          scanner_public_key: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          chain_synced_at?: string | null
          created_at?: string
          enabled?: boolean
          event_id?: string
          scanner_public_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_scanners_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_scanners_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_scanners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          artist_name: string | null
          capacity: number
          category: string
          chain_event_id: number | null
          checked_in_count: number
          city: string
          country: string
          cover_path: string | null
          create_tx_hash: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          fee_bps: number | null
          id: string
          latitude: number | null
          longitude: number | null
          max_transfers: number
          metadata_hash: string | null
          organizer_id: string
          resale_cap_units: number
          sales_open: boolean
          search: unknown
          slug: string
          splits: Json
          starts_at: string
          status: Database["public"]["Enums"]["event_status"]
          summary: string | null
          tickets_sold: number
          timezone: string
          title: string
          updated_at: string
          venue_address: string | null
          venue_name: string
        }
        Insert: {
          artist_name?: string | null
          capacity: number
          category?: string
          chain_event_id?: number | null
          checked_in_count?: number
          city: string
          country?: string
          cover_path?: string | null
          create_tx_hash?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          fee_bps?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          max_transfers?: number
          metadata_hash?: string | null
          organizer_id: string
          resale_cap_units?: number
          sales_open?: boolean
          search?: unknown
          slug: string
          splits?: Json
          starts_at: string
          status?: Database["public"]["Enums"]["event_status"]
          summary?: string | null
          tickets_sold?: number
          timezone?: string
          title: string
          updated_at?: string
          venue_address?: string | null
          venue_name: string
        }
        Update: {
          artist_name?: string | null
          capacity?: number
          category?: string
          chain_event_id?: number | null
          checked_in_count?: number
          city?: string
          country?: string
          cover_path?: string | null
          create_tx_hash?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          fee_bps?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          max_transfers?: number
          metadata_hash?: string | null
          organizer_id?: string
          resale_cap_units?: number
          sales_open?: boolean
          search?: unknown
          slug?: string
          splits?: Json
          starts_at?: string
          status?: Database["public"]["Enums"]["event_status"]
          summary?: string | null
          tickets_sold?: number
          timezone?: string
          title?: string
          updated_at?: string
          venue_address?: string | null
          venue_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          request_hash: string
          response: Json | null
          route: string
          status_code: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          request_hash: string
          response?: Json | null
          route: string
          status_code?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          request_hash?: string
          response?: Json | null
          route?: string
          status_code?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          display_total_zmw: number | null
          error: string | null
          event_id: string
          expires_at: string
          id: string
          idempotency_key: string
          owner_public_key: string | null
          payer_public_key: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          quantity: number
          ramp_reference: string | null
          status: Database["public"]["Enums"]["order_status"]
          tier_id: string
          total_units: number
          tx_hash: string | null
          unit_price_units: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          display_total_zmw?: number | null
          error?: string | null
          event_id: string
          expires_at?: string
          id?: string
          idempotency_key: string
          owner_public_key?: string | null
          payer_public_key?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          quantity?: number
          ramp_reference?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tier_id: string
          total_units: number
          tx_hash?: string | null
          unit_price_units: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          display_total_zmw?: number | null
          error?: string | null
          event_id?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          owner_public_key?: string | null
          payer_public_key?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          quantity?: number
          ramp_reference?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tier_id?: string
          total_units?: number
          tx_hash?: string | null
          unit_price_units?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "ticket_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizers: {
        Row: {
          bio: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          logo_path: string | null
          name: string
          on_chain_approved_at: string | null
          payout_public_key: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string
          status: Database["public"]["Enums"]["organizer_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          on_chain_approved_at?: string | null
          payout_public_key?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug: string
          status?: Database["public"]["Enums"]["organizer_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          on_chain_approved_at?: string | null
          payout_public_key?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["organizer_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizers_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      perks: {
        Row: {
          active: boolean
          chain_perk_id: number | null
          cost_units: number
          created_at: string
          description: string | null
          event_id: string | null
          id: string
          image_path: string | null
          sponsor_name: string
          sponsor_user_id: string | null
          stock: number | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          chain_perk_id?: number | null
          cost_units: number
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          image_path?: string | null
          sponsor_name: string
          sponsor_user_id?: string | null
          stock?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          chain_perk_id?: number | null
          cost_units?: number
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          image_path?: string | null
          sponsor_name?: string
          sponsor_user_id?: string | null
          stock?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "perks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "perks_sponsor_user_id_fkey"
            columns: ["sponsor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          amount_units: number
          created_at: string
          id: string
          public_key: string
          reason: string
          ticket_id: string | null
          tx_hash: string
          user_id: string | null
        }
        Insert: {
          amount_units: number
          created_at?: string
          id?: string
          public_key: string
          reason: string
          ticket_id?: string | null
          tx_hash: string
          user_id?: string | null
        }
        Update: {
          amount_units?: number
          created_at?: string
          id?: string
          public_key?: string
          reason?: string
          ticket_id?: string | null
          tx_hash?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          city: string | null
          country: string
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          city?: string | null
          country?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          city?: string | null
          country?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      redemptions: {
        Row: {
          chain_redemption_id: number | null
          code: string
          created_at: string
          fulfilled_at: string | null
          id: string
          perk_id: string
          status: Database["public"]["Enums"]["redemption_status"]
          tx_hash: string | null
          user_id: string
        }
        Insert: {
          chain_redemption_id?: number | null
          code: string
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          perk_id: string
          status?: Database["public"]["Enums"]["redemption_status"]
          tx_hash?: string | null
          user_id: string
        }
        Update: {
          chain_redemption_id?: number | null
          code?: string
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          perk_id?: string
          status?: Database["public"]["Enums"]["redemption_status"]
          tx_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "redemptions_perk_id_fkey"
            columns: ["perk_id"]
            isOneToOne: false
            referencedRelation: "perks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ramp_transactions: {
        Row: {
          amount: number
          anchor_tx_id: string | null
          asset_code: string
          asset_issuer: string | null
          created_at: string
          extra: Json
          home_domain: string | null
          id: string
          interactive_url: string | null
          kind: Database["public"]["Enums"]["ramp_kind"]
          memo: string | null
          order_id: string | null
          provider: string
          status: Database["public"]["Enums"]["ramp_tx_status"]
          updated_at: string
          user_id: string
          withdraw_account: string | null
        }
        Insert: {
          amount: number
          anchor_tx_id?: string | null
          asset_code: string
          asset_issuer?: string | null
          created_at?: string
          extra?: Json
          home_domain?: string | null
          id?: string
          interactive_url?: string | null
          kind: Database["public"]["Enums"]["ramp_kind"]
          memo?: string | null
          order_id?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["ramp_tx_status"]
          updated_at?: string
          user_id: string
          withdraw_account?: string | null
        }
        Update: {
          amount?: number
          anchor_tx_id?: string | null
          asset_code?: string
          asset_issuer?: string | null
          created_at?: string
          extra?: Json
          home_domain?: string | null
          id?: string
          interactive_url?: string | null
          kind?: Database["public"]["Enums"]["ramp_kind"]
          memo?: string | null
          order_id?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["ramp_tx_status"]
          updated_at?: string
          user_id?: string
          withdraw_account?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ramp_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ramp_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_credentials: {
        Row: {
          device_public_key: string
          expires_at: string
          id: string
          issued_at: string
          revoked_at: string | null
          ticket_id: string
          user_id: string
        }
        Insert: {
          device_public_key: string
          expires_at: string
          id?: string
          issued_at?: string
          revoked_at?: string | null
          ticket_id: string
          user_id: string
        }
        Update: {
          device_public_key?: string
          expires_at?: string
          id?: string
          issued_at?: string
          revoked_at?: string | null
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_credentials_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_tiers: {
        Row: {
          capacity: number
          chain_tier: number | null
          created_at: string
          description: string | null
          event_id: string
          id: string
          name: string
          price_units: number
          sales_end_at: string | null
          sales_start_at: string | null
          sold: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          capacity: number
          chain_tier?: number | null
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          name: string
          price_units: number
          sales_end_at?: string | null
          sales_start_at?: string | null
          sold?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          capacity?: number
          chain_tier?: number | null
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          name?: string
          price_units?: number
          sales_end_at?: string | null
          sales_start_at?: string | null
          sold?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_transfers: {
        Row: {
          created_at: string
          from_public_key: string
          from_user_id: string | null
          id: string
          price_units: number
          ticket_id: string
          to_public_key: string
          to_user_id: string | null
          tx_hash: string
        }
        Insert: {
          created_at?: string
          from_public_key: string
          from_user_id?: string | null
          id?: string
          price_units?: number
          ticket_id: string
          to_public_key: string
          to_user_id?: string | null
          tx_hash: string
        }
        Update: {
          created_at?: string
          from_public_key?: string
          from_user_id?: string | null
          id?: string
          price_units?: number
          ticket_id?: string
          to_public_key?: string
          to_user_id?: string | null
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_transfers_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          chain_ticket_id: number
          checked_in_at: string | null
          created_at: string
          event_id: string
          id: string
          mint_tx_hash: string
          order_id: string | null
          owner_public_key: string
          owner_user_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          tier_id: string
          transfers: number
          updated_at: string
        }
        Insert: {
          chain_ticket_id: number
          checked_in_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          mint_tx_hash: string
          order_id?: string | null
          owner_public_key: string
          owner_user_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tier_id: string
          transfers?: number
          updated_at?: string
        }
        Update: {
          chain_ticket_id?: number
          checked_in_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          mint_tx_hash?: string
          order_id?: string | null
          owner_public_key?: string
          owner_user_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tier_id?: string
          transfers?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "ticket_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_challenges: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          nonce: string
          public_key: string
          purpose: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          nonce: string
          public_key: string
          purpose?: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string
          public_key?: string
          purpose?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          is_primary: boolean
          kind: Database["public"]["Enums"]["wallet_kind"]
          public_key: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          kind: Database["public"]["Enums"]["wallet_kind"]
          public_key: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["wallet_kind"]
          public_key?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_organizers: {
        Args: { p_status?: Database["public"]["Enums"]["organizer_status"] }
        Returns: {
          city: string
          contact_email: string
          contact_phone: string
          country: string
          created_at: string
          id: string
          name: string
          on_chain_approved_at: string
          payout_public_key: string
          review_note: string
          reviewed_at: string
          slug: string
          status: Database["public"]["Enums"]["organizer_status"]
          user_email: string
          user_id: string
        }[]
      }
      admin_review_organizer: {
        Args: {
          p_note?: string
          p_organizer_id: string
          p_status: Database["public"]["Enums"]["organizer_status"]
        }
        Returns: {
          bio: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          logo_path: string | null
          name: string
          on_chain_approved_at: string | null
          payout_public_key: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string
          status: Database["public"]["Enums"]["organizer_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "organizers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_role: {
        Args: {
          p_enabled: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      admin_stats: { Args: never; Returns: Json }
      admin_update_setting: {
        Args: { p_key: string; p_value: Json }
        Returns: undefined
      }
      my_organizer: {
        Args: never
        Returns: {
          bio: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          logo_path: string | null
          name: string
          on_chain_approved_at: string | null
          payout_public_key: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string
          status: Database["public"]["Enums"]["organizer_status"]
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "organizers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      resubmit_organizer: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "customer" | "organizer" | "scanner" | "admin"
      chain_sync_status: "pending" | "confirmed" | "failed"
      checkin_result: "accepted" | "duplicate" | "invalid" | "not_scanner"
      event_status: "draft" | "published" | "cancelled" | "completed"
      order_status:
        | "pending"
        | "submitted"
        | "confirmed"
        | "failed"
        | "expired"
        | "refunded"
      organizer_status: "pending" | "approved" | "rejected" | "suspended"
      payment_method: "stellar_usdc" | "stellar_xlm" | "mobile_money"
      ramp_kind: "deposit" | "withdraw"
      ramp_tx_status:
        | "pending"
        | "awaiting_customer"
        | "settled"
        | "failed"
        | "error"
        | "refunded"
        | "expired"
      redemption_status: "pending" | "confirmed" | "fulfilled" | "failed"
      ticket_status: "valid" | "checked_in" | "void"
      wallet_kind: "custodial" | "freighter"
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
      app_role: ["customer", "organizer", "scanner", "admin"],
      chain_sync_status: ["pending", "confirmed", "failed"],
      checkin_result: ["accepted", "duplicate", "invalid", "not_scanner"],
      event_status: ["draft", "published", "cancelled", "completed"],
      order_status: [
        "pending",
        "submitted",
        "confirmed",
        "failed",
        "expired",
        "refunded",
      ],
      organizer_status: ["pending", "approved", "rejected", "suspended"],
      payment_method: ["stellar_usdc", "stellar_xlm", "mobile_money"],
      ramp_kind: ["deposit", "withdraw"],
      ramp_tx_status: [
        "pending",
        "awaiting_customer",
        "settled",
        "failed",
        "error",
        "refunded",
        "expired",
      ],
      redemption_status: ["pending", "confirmed", "fulfilled", "failed"],
      ticket_status: ["valid", "checked_in", "void"],
      wallet_kind: ["custodial", "freighter"],
    },
  },
} as const
