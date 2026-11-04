
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"before": Json | null,"campaign_id": string | null,"created_at": string,"created_by": string | null,"entity_id": string | null,"entity_type": string,"id": string,"summary": string | null,"updated_at": string,"version": number,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type": string,"id"?: string,"summary"?: string | null,"updated_at"?: string,"version"?: number,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string,"id"?: string,"summary"?: string | null,"updated_at"?: string,"version"?: number,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_logs_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"approvals": {
                  Row: {
                    "approver": string,"campaign_id": string,"client_contact": string | null,"created_at": string,"created_by": string | null,"decided_on": string,"decision": Database["public"]['Enums']["approval_decision"],"id": string,"journey_id": string | null,"note": string | null,"subject_id": string | null,"subject_label": string,"subject_type": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approver": string,"campaign_id": string,"client_contact"?: string | null,"created_at"?: string,"created_by"?: string | null,"decided_on"?: string,"decision": Database["public"]['Enums']["approval_decision"],"id"?: string,"journey_id"?: string | null,"note"?: string | null,"subject_id"?: string | null,"subject_label": string,"subject_type": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "approver"?: string,"campaign_id"?: string,"client_contact"?: string | null,"created_at"?: string,"created_by"?: string | null,"decided_on"?: string,"decision"?: Database["public"]['Enums']["approval_decision"],"id"?: string,"journey_id"?: string | null,"note"?: string | null,"subject_id"?: string | null,"subject_label"?: string,"subject_type"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "approvals_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approvals_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_counters": {
                  Row: {
                    "campaign_id": string,"kind": string,"n": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"kind": string,"n"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"kind"?: string,"n"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_counters_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_members": {
                  Row: {
                    "campaign_id": string,"campaign_role": Database["public"]['Enums']["campaign_role"],"created_at": string,"created_by": string | null,"id": string,"updated_at": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"campaign_role"?: Database["public"]['Enums']["campaign_role"],"created_at"?: string,"created_by"?: string | null,"id"?: string,"updated_at"?: string,"user_id": string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"campaign_role"?: Database["public"]['Enums']["campaign_role"],"created_at"?: string,"created_by"?: string | null,"id"?: string,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_members_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "client_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"design_status": Database["public"]['Enums']["track_status"],"development_status": Database["public"]['Enums']["track_status"],"health": Database["public"]['Enums']["health"],"id": string,"is_demo": boolean,"name": string,"notes": string | null,"priority": Database["public"]['Enums']["priority"],"production_url": string | null,"qa_status": Database["public"]['Enums']["track_status"],"stage": Database["public"]['Enums']["campaign_stage"],"staging_url": string | null,"start_date": string | null,"status": Database["public"]['Enums']["campaign_status"],"target_launch_date": string | null,"uat_status": Database["public"]['Enums']["track_status"],"updated_at": string,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"design_status"?: Database["public"]['Enums']["track_status"],"development_status"?: Database["public"]['Enums']["track_status"],"health"?: Database["public"]['Enums']["health"],"id"?: string,"is_demo"?: boolean,"name": string,"notes"?: string | null,"priority"?: Database["public"]['Enums']["priority"],"production_url"?: string | null,"qa_status"?: Database["public"]['Enums']["track_status"],"stage"?: Database["public"]['Enums']["campaign_stage"],"staging_url"?: string | null,"start_date"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"target_launch_date"?: string | null,"uat_status"?: Database["public"]['Enums']["track_status"],"updated_at"?: string,"version"?: number,"workspace_id": string
                  }
                  Update: {
                    "client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"design_status"?: Database["public"]['Enums']["track_status"],"development_status"?: Database["public"]['Enums']["track_status"],"health"?: Database["public"]['Enums']["health"],"id"?: string,"is_demo"?: boolean,"name"?: string,"notes"?: string | null,"priority"?: Database["public"]['Enums']["priority"],"production_url"?: string | null,"qa_status"?: Database["public"]['Enums']["track_status"],"stage"?: Database["public"]['Enums']["campaign_stage"],"staging_url"?: string | null,"start_date"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"target_launch_date"?: string | null,"uat_status"?: Database["public"]['Enums']["track_status"],"updated_at"?: string,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaigns_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"client_feedback": {
                  Row: {
                    "campaign_id": string,"channel": string,"client_contact": string | null,"created_at": string,"created_by": string | null,"details": string | null,"id": string,"journey_id": string | null,"received_on": string,"status": Database["public"]['Enums']["feedback_status"],"summary": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"channel"?: string,"client_contact"?: string | null,"created_at"?: string,"created_by"?: string | null,"details"?: string | null,"id"?: string,"journey_id"?: string | null,"received_on"?: string,"status"?: Database["public"]['Enums']["feedback_status"],"summary": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"channel"?: string,"client_contact"?: string | null,"created_at"?: string,"created_by"?: string | null,"details"?: string | null,"id"?: string,"journey_id"?: string | null,"received_on"?: string,"status"?: Database["public"]['Enums']["feedback_status"],"summary"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_feedback_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_feedback_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"notes": string | null,"updated_at": string,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"updated_at"?: string,"version"?: number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"updated_at"?: string,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"deployments": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"deployed_at": string | null,"environment": string,"id": string,"notes": string | null,"planned_for": string | null,"status": Database["public"]['Enums']["deployment_status"],"updated_at": string,"url": string,"version": number,"version_label": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"deployed_at"?: string | null,"environment"?: string,"id"?: string,"notes"?: string | null,"planned_for"?: string | null,"status"?: Database["public"]['Enums']["deployment_status"],"updated_at"?: string,"url": string,"version"?: number,"version_label"?: string | null
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"deployed_at"?: string | null,"environment"?: string,"id"?: string,"notes"?: string | null,"planned_for"?: string | null,"status"?: Database["public"]['Enums']["deployment_status"],"updated_at"?: string,"url"?: string,"version"?: number,"version_label"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "deployments_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"design_assets": {
                  Row: {
                    "bucket": string,"campaign_id": string,"content_hash": string,"created_at": string,"created_by": string | null,"height": number,"id": string,"mime_type": string,"original_height": number,"original_width": number,"page_number": number | null,"screen_name": string,"screen_type": string,"sort_order": number,"source_file": string | null,"storage_path": string,"submission_id": string,"updated_at": string,"version": number,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket"?: string,"campaign_id": string,"content_hash": string,"created_at"?: string,"created_by"?: string | null,"height": number,"id"?: string,"mime_type": string,"original_height": number,"original_width": number,"page_number"?: number | null,"screen_name": string,"screen_type"?: string,"sort_order"?: number,"source_file"?: string | null,"storage_path": string,"submission_id": string,"updated_at"?: string,"version"?: number,"width": number
                  }
                  Update: {
                    "bucket"?: string,"campaign_id"?: string,"content_hash"?: string,"created_at"?: string,"created_by"?: string | null,"height"?: number,"id"?: string,"mime_type"?: string,"original_height"?: number,"original_width"?: number,"page_number"?: number | null,"screen_name"?: string,"screen_type"?: string,"sort_order"?: number,"source_file"?: string | null,"storage_path"?: string,"submission_id"?: string,"updated_at"?: string,"version"?: number,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_assets_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "design_assets_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "design_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"design_submissions": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"figma_url": string | null,"finalized_at": string | null,"id": string,"journey_id": string | null,"notes": string | null,"source": string,"status": Database["public"]['Enums']["submission_status"],"title": string,"updated_at": string,"version": number,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"figma_url"?: string | null,"finalized_at"?: string | null,"id"?: string,"journey_id"?: string | null,"notes"?: string | null,"source"?: string,"status"?: Database["public"]['Enums']["submission_status"],"title": string,"updated_at"?: string,"version"?: number,"version_no"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"figma_url"?: string | null,"finalized_at"?: string | null,"id"?: string,"journey_id"?: string | null,"notes"?: string | null,"source"?: string,"status"?: Database["public"]['Enums']["submission_status"],"title"?: string,"updated_at"?: string,"version"?: number,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_submissions_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "design_submissions_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    }
                  ]
                },"dev_captures": {
                  Row: {
                    "campaign_id": string,"console_messages": NonNullable<Json>,"created_at": string,"created_by": string | null,"design_asset_id": string | null,"development_submission_id": string,"diff_ratio": number | null,"diff_regions": NonNullable<Json>,"failed_requests": NonNullable<Json>,"height": number | null,"id": string,"review_job_id": string | null,"storage_path": string | null,"updated_at": string,"url": string,"version": number,"viewport": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"console_messages"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"design_asset_id"?: string | null,"development_submission_id": string,"diff_ratio"?: number | null,"diff_regions"?: NonNullable<Json>,"failed_requests"?: NonNullable<Json>,"height"?: number | null,"id"?: string,"review_job_id"?: string | null,"storage_path"?: string | null,"updated_at"?: string,"url": string,"version"?: number,"viewport": string,"width"?: number | null
                  }
                  Update: {
                    "campaign_id"?: string,"console_messages"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"design_asset_id"?: string | null,"development_submission_id"?: string,"diff_ratio"?: number | null,"diff_regions"?: NonNullable<Json>,"failed_requests"?: NonNullable<Json>,"height"?: number | null,"id"?: string,"review_job_id"?: string | null,"storage_path"?: string | null,"updated_at"?: string,"url"?: string,"version"?: number,"viewport"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "dev_captures_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dev_captures_design_asset_id_fkey"
      columns: ["design_asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dev_captures_development_submission_id_fkey"
      columns: ["development_submission_id"]
isOneToOne: false
      referencedRelation: "development_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"development_submissions": {
                  Row: {
                    "browsers": (string)[],"campaign_id": string,"created_at": string,"created_by": string | null,"design_submission_id": string | null,"developer_id": string | null,"devices": (string)[],"environment_id": string | null,"id": string,"journey_id": string | null,"notes": string | null,"page_paths": (string)[],"staging_url": string,"status": Database["public"]['Enums']["submission_status"],"updated_at": string,"version": number,"version_label": string
                  }
                  ComputedFields: never
                  Insert: {
                    "browsers"?: (string)[],"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"design_submission_id"?: string | null,"developer_id"?: string | null,"devices"?: (string)[],"environment_id"?: string | null,"id"?: string,"journey_id"?: string | null,"notes"?: string | null,"page_paths"?: (string)[],"staging_url": string,"status"?: Database["public"]['Enums']["submission_status"],"updated_at"?: string,"version"?: number,"version_label": string
                  }
                  Update: {
                    "browsers"?: (string)[],"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"design_submission_id"?: string | null,"developer_id"?: string | null,"devices"?: (string)[],"environment_id"?: string | null,"id"?: string,"journey_id"?: string | null,"notes"?: string | null,"page_paths"?: (string)[],"staging_url"?: string,"status"?: Database["public"]['Enums']["submission_status"],"updated_at"?: string,"version"?: number,"version_label"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "development_submissions_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "development_submissions_design_submission_id_fkey"
      columns: ["design_submission_id"]
isOneToOne: false
      referencedRelation: "design_submissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "development_submissions_developer_id_fkey"
      columns: ["developer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "development_submissions_environment_id_fkey"
      columns: ["environment_id"]
isOneToOne: false
      referencedRelation: "test_environments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "development_submissions_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"file_name": string,"id": string,"kind": string,"mime_type": string,"size_bytes": number,"storage_path": string,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"file_name": string,"id"?: string,"kind"?: string,"mime_type": string,"size_bytes": number,"storage_path": string,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"file_name"?: string,"id"?: string,"kind"?: string,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"finding_evidence": {
                  Row: {
                    "approximate": boolean,"campaign_id": string,"created_at": string,"created_by": string | null,"data": Json | null,"design_asset_id": string | null,"dev_capture_id": string | null,"finding_id": string,"id": string,"kind": string,"region": Json | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approximate"?: boolean,"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"data"?: Json | null,"design_asset_id"?: string | null,"dev_capture_id"?: string | null,"finding_id": string,"id"?: string,"kind"?: string,"region"?: Json | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "approximate"?: boolean,"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"data"?: Json | null,"design_asset_id"?: string | null,"dev_capture_id"?: string | null,"finding_id"?: string,"id"?: string,"kind"?: string,"region"?: Json | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "finding_evidence_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finding_evidence_design_asset_id_fkey"
      columns: ["design_asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finding_evidence_dev_capture_id_fkey"
      columns: ["dev_capture_id"]
isOneToOne: false
      referencedRelation: "dev_captures"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finding_evidence_finding_id_fkey"
      columns: ["finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["id"]
    }
                  ]
                },"findings": {
                  Row: {
                    "additional_observation": boolean,"affected_page": string | null,"ai_original": Json | null,"campaign_id": string,"confidence": Database["public"]['Enums']["confidence"],"created_at": string,"created_by": string | null,"decided_at": string | null,"decided_by": string | null,"description": string,"design_asset_id": string | null,"design_submission_id": string | null,"dev_capture_id": string | null,"development_submission_id": string | null,"edited_at": string | null,"edited_by": string | null,"evidence_note": string | null,"expected": string | null,"feedback": Json | null,"id": string,"journey_id": string | null,"observed": string | null,"owner_id": string | null,"ref": string,"reproducibility": string | null,"requirement_id": string | null,"review_job_id": string | null,"review_type": Database["public"]['Enums']["review_type"],"severity": Database["public"]['Enums']["severity"],"status": Database["public"]['Enums']["finding_status"],"suggested_correction": string | null,"test_scenario": string | null,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "additional_observation"?: boolean,"affected_page"?: string | null,"ai_original"?: Json | null,"campaign_id": string,"confidence"?: Database["public"]['Enums']["confidence"],"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"description"?: string,"design_asset_id"?: string | null,"design_submission_id"?: string | null,"dev_capture_id"?: string | null,"development_submission_id"?: string | null,"edited_at"?: string | null,"edited_by"?: string | null,"evidence_note"?: string | null,"expected"?: string | null,"feedback"?: Json | null,"id"?: string,"journey_id"?: string | null,"observed"?: string | null,"owner_id"?: string | null,"ref": string,"reproducibility"?: string | null,"requirement_id"?: string | null,"review_job_id"?: string | null,"review_type": Database["public"]['Enums']["review_type"],"severity"?: Database["public"]['Enums']["severity"],"status"?: Database["public"]['Enums']["finding_status"],"suggested_correction"?: string | null,"test_scenario"?: string | null,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "additional_observation"?: boolean,"affected_page"?: string | null,"ai_original"?: Json | null,"campaign_id"?: string,"confidence"?: Database["public"]['Enums']["confidence"],"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"description"?: string,"design_asset_id"?: string | null,"design_submission_id"?: string | null,"dev_capture_id"?: string | null,"development_submission_id"?: string | null,"edited_at"?: string | null,"edited_by"?: string | null,"evidence_note"?: string | null,"expected"?: string | null,"feedback"?: Json | null,"id"?: string,"journey_id"?: string | null,"observed"?: string | null,"owner_id"?: string | null,"ref"?: string,"reproducibility"?: string | null,"requirement_id"?: string | null,"review_job_id"?: string | null,"review_type"?: Database["public"]['Enums']["review_type"],"severity"?: Database["public"]['Enums']["severity"],"status"?: Database["public"]['Enums']["finding_status"],"suggested_correction"?: string | null,"test_scenario"?: string | null,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "findings_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_design_asset_id_fkey"
      columns: ["design_asset_id"]
isOneToOne: false
      referencedRelation: "design_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_design_submission_id_fkey"
      columns: ["design_submission_id"]
isOneToOne: false
      referencedRelation: "design_submissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_dev_capture_id_fkey"
      columns: ["dev_capture_id"]
isOneToOne: false
      referencedRelation: "dev_captures"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_development_submission_id_fkey"
      columns: ["development_submission_id"]
isOneToOne: false
      referencedRelation: "development_submissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_edited_by_fkey"
      columns: ["edited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"journeys": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"description": string | null,"design_status": Database["public"]['Enums']["track_status"],"development_status": Database["public"]['Enums']["track_status"],"id": string,"name": string,"qa_status": Database["public"]['Enums']["track_status"],"sort_order": number,"stage": Database["public"]['Enums']["campaign_stage"],"uat_status": Database["public"]['Enums']["track_status"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"design_status"?: Database["public"]['Enums']["track_status"],"development_status"?: Database["public"]['Enums']["track_status"],"id"?: string,"name": string,"qa_status"?: Database["public"]['Enums']["track_status"],"sort_order"?: number,"stage"?: Database["public"]['Enums']["campaign_stage"],"uat_status"?: Database["public"]['Enums']["track_status"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"design_status"?: Database["public"]['Enums']["track_status"],"development_status"?: Database["public"]['Enums']["track_status"],"id"?: string,"name"?: string,"qa_status"?: Database["public"]['Enums']["track_status"],"sort_order"?: number,"stage"?: Database["public"]['Enums']["campaign_stage"],"uat_status"?: Database["public"]['Enums']["track_status"],"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "journeys_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"milestones": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"done_at": string | null,"due_date": string,"id": string,"journey_id": string | null,"stage": Database["public"]['Enums']["campaign_stage"] | null,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"due_date": string,"id"?: string,"journey_id"?: string | null,"stage"?: Database["public"]['Enums']["campaign_stage"] | null,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"due_date"?: string,"id"?: string,"journey_id"?: string | null,"stage"?: Database["public"]['Enums']["campaign_stage"] | null,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestones_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestones_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "campaign_id": string | null,"created_at": string,"created_by": string | null,"entity_id": string | null,"entity_type": string | null,"id": string,"kind": string,"read_at": string | null,"title": string,"updated_at": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"kind": string,"read_at"?: string | null,"title": string,"updated_at"?: string,"user_id": string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"kind"?: string,"read_at"?: string | null,"title"?: string,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"created_by": string | null,"email": string,"full_name": string,"id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string,"full_name"?: string,"id": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string,"full_name"?: string,"id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"qa_test_cases": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"enabled": boolean,"expected": string,"id": string,"journey_id": string | null,"requirement_id": string | null,"steps": NonNullable<Json>,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"expected"?: string,"id"?: string,"journey_id"?: string | null,"requirement_id"?: string | null,"steps"?: NonNullable<Json>,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"expected"?: string,"id"?: string,"journey_id"?: string | null,"requirement_id"?: string | null,"steps"?: NonNullable<Json>,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "qa_test_cases_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "qa_test_cases_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "qa_test_cases_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"qa_test_results": {
                  Row: {
                    "actual": string | null,"campaign_id": string,"created_at": string,"created_by": string | null,"duration_ms": number | null,"error": string | null,"evidence": NonNullable<Json>,"id": string,"result": Database["public"]['Enums']["verification_state"],"run_id": string,"test_case_id": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actual"?: string | null,"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"error"?: string | null,"evidence"?: NonNullable<Json>,"id"?: string,"result": Database["public"]['Enums']["verification_state"],"run_id": string,"test_case_id"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "actual"?: string | null,"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"error"?: string | null,"evidence"?: NonNullable<Json>,"id"?: string,"result"?: Database["public"]['Enums']["verification_state"],"run_id"?: string,"test_case_id"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "qa_test_results_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "qa_test_results_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "qa_test_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "qa_test_results_test_case_id_fkey"
      columns: ["test_case_id"]
isOneToOne: false
      referencedRelation: "qa_test_cases"
      referencedColumns: ["id"]
    }
                  ]
                },"qa_test_runs": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"development_submission_id": string | null,"id": string,"review_job_id": string | null,"summary": NonNullable<Json>,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"development_submission_id"?: string | null,"id"?: string,"review_job_id"?: string | null,"summary"?: NonNullable<Json>,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"development_submission_id"?: string | null,"id"?: string,"review_job_id"?: string | null,"summary"?: NonNullable<Json>,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "qa_test_runs_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "qa_test_runs_development_submission_id_fkey"
      columns: ["development_submission_id"]
isOneToOne: false
      referencedRelation: "development_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"requirement_checks": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"id": string,"method": Database["public"]['Enums']["check_method"] | null,"note": string | null,"requirement_id": string,"result": Database["public"]['Enums']["verification_state"],"review_job_id": string | null,"review_type": Database["public"]['Enums']["review_type"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method"?: Database["public"]['Enums']["check_method"] | null,"note"?: string | null,"requirement_id": string,"result": Database["public"]['Enums']["verification_state"],"review_job_id"?: string | null,"review_type": Database["public"]['Enums']["review_type"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method"?: Database["public"]['Enums']["check_method"] | null,"note"?: string | null,"requirement_id"?: string,"result"?: Database["public"]['Enums']["verification_state"],"review_job_id"?: string | null,"review_type"?: Database["public"]['Enums']["review_type"],"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "requirement_checks_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirement_checks_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"requirements": {
                  Row: {
                    "acceptance_criteria": string | null,"ai_original": Json | null,"campaign_id": string,"category": Database["public"]['Enums']["requirement_category"],"confidence": Database["public"]['Enums']["confidence"] | null,"created_at": string,"created_by": string | null,"decided_at": string | null,"decided_by": string | null,"description": string,"id": string,"journey_hint": string | null,"journey_id": string | null,"origin": string,"priority": Database["public"]['Enums']["priority"],"ref": string,"review_job_id": string | null,"source_pages": (number)[],"source_text": string | null,"source_version_id": string | null,"status": Database["public"]['Enums']["requirement_status"],"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "acceptance_criteria"?: string | null,"ai_original"?: Json | null,"campaign_id": string,"category"?: Database["public"]['Enums']["requirement_category"],"confidence"?: Database["public"]['Enums']["confidence"] | null,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"description"?: string,"id"?: string,"journey_hint"?: string | null,"journey_id"?: string | null,"origin"?: string,"priority"?: Database["public"]['Enums']["priority"],"ref": string,"review_job_id"?: string | null,"source_pages"?: (number)[],"source_text"?: string | null,"source_version_id"?: string | null,"status"?: Database["public"]['Enums']["requirement_status"],"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "acceptance_criteria"?: string | null,"ai_original"?: Json | null,"campaign_id"?: string,"category"?: Database["public"]['Enums']["requirement_category"],"confidence"?: Database["public"]['Enums']["confidence"] | null,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"description"?: string,"id"?: string,"journey_hint"?: string | null,"journey_id"?: string | null,"origin"?: string,"priority"?: Database["public"]['Enums']["priority"],"ref"?: string,"review_job_id"?: string | null,"source_pages"?: (number)[],"source_text"?: string | null,"source_version_id"?: string | null,"status"?: Database["public"]['Enums']["requirement_status"],"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "requirements_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirements_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirements_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirements_source_version_id_fkey"
      columns: ["source_version_id"]
isOneToOne: false
      referencedRelation: "sow_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"review_jobs": {
                  Row: {
                    "attempts": number,"campaign_id": string,"cancel_requested": boolean,"claimed_by": string | null,"context_size": number | null,"created_at": string,"created_by": string | null,"duration_ms": number | null,"error": string | null,"error_detail": Json | null,"finished_at": string | null,"heartbeat_at": string | null,"id": string,"input": NonNullable<Json>,"max_attempts": number,"model": string | null,"next_attempt_at": string,"object_paths": (string)[],"prompt_version": string | null,"result_summary": Json | null,"review_type": Database["public"]['Enums']["review_type"],"run_again": boolean,"source": NonNullable<Json>,"source_hash": string,"started_at": string | null,"status": Database["public"]['Enums']["job_status"],"tokens_in": number | null,"tokens_out": number | null,"triggered_by": string,"updated_at": string,"version": number,"worker_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"campaign_id": string,"cancel_requested"?: boolean,"claimed_by"?: string | null,"context_size"?: number | null,"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"error"?: string | null,"error_detail"?: Json | null,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input"?: NonNullable<Json>,"max_attempts"?: number,"model"?: string | null,"next_attempt_at"?: string,"object_paths"?: (string)[],"prompt_version"?: string | null,"result_summary"?: Json | null,"review_type": Database["public"]['Enums']["review_type"],"run_again"?: boolean,"source": NonNullable<Json>,"source_hash": string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"tokens_in"?: number | null,"tokens_out"?: number | null,"triggered_by"?: string,"updated_at"?: string,"version"?: number,"worker_name"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"campaign_id"?: string,"cancel_requested"?: boolean,"claimed_by"?: string | null,"context_size"?: number | null,"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"error"?: string | null,"error_detail"?: Json | null,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input"?: NonNullable<Json>,"max_attempts"?: number,"model"?: string | null,"next_attempt_at"?: string,"object_paths"?: (string)[],"prompt_version"?: string | null,"result_summary"?: Json | null,"review_type"?: Database["public"]['Enums']["review_type"],"run_again"?: boolean,"source"?: NonNullable<Json>,"source_hash"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"tokens_in"?: number | null,"tokens_out"?: number | null,"triggered_by"?: string,"updated_at"?: string,"version"?: number,"worker_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_jobs_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"sow_documents": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"id": string,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sow_documents_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"sow_pages": {
                  Row: {
                    "campaign_id": string,"created_at": string,"created_by": string | null,"id": string,"method": string,"page_no": number,"sow_version_id": string,"text": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method": string,"page_no": number,"sow_version_id": string,"text"?: string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method"?: string,"page_no"?: number,"sow_version_id"?: string,"text"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sow_pages_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sow_pages_sow_version_id_fkey"
      columns: ["sow_version_id"]
isOneToOne: false
      referencedRelation: "sow_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"sow_versions": {
                  Row: {
                    "campaign_id": string,"content_hash": string,"created_at": string,"created_by": string | null,"extraction_status": string,"file_name": string,"id": string,"page_count": number | null,"size_bytes": number,"sow_document_id": string,"storage_path": string,"updated_at": string,"version": number,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"content_hash": string,"created_at"?: string,"created_by"?: string | null,"extraction_status"?: string,"file_name": string,"id"?: string,"page_count"?: number | null,"size_bytes": number,"sow_document_id": string,"storage_path": string,"updated_at"?: string,"version"?: number,"version_no": number
                  }
                  Update: {
                    "campaign_id"?: string,"content_hash"?: string,"created_at"?: string,"created_by"?: string | null,"extraction_status"?: string,"file_name"?: string,"id"?: string,"page_count"?: number | null,"size_bytes"?: number,"sow_document_id"?: string,"storage_path"?: string,"updated_at"?: string,"version"?: number,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sow_versions_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sow_versions_sow_document_id_fkey"
      columns: ["sow_document_id"]
isOneToOne: false
      referencedRelation: "sow_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"task_comments": {
                  Row: {
                    "body": string,"campaign_id": string,"created_at": string,"created_by": string | null,"id": string,"task_id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"task_id": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "body"?: string,"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"task_id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_comments_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comments_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "assignee_id": string | null,"campaign_id": string,"completed_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"due_date": string | null,"evidence": Json | null,"id": string,"journey_id": string | null,"priority": Database["public"]['Enums']["priority"],"ref": string | null,"source_feedback_id": string | null,"source_finding_id": string | null,"source_requirement_id": string | null,"source_submission_id": string | null,"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"campaign_id": string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string | null,"evidence"?: Json | null,"id"?: string,"journey_id"?: string | null,"priority"?: Database["public"]['Enums']["priority"],"ref"?: string | null,"source_feedback_id"?: string | null,"source_finding_id"?: string | null,"source_requirement_id"?: string | null,"source_submission_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "assignee_id"?: string | null,"campaign_id"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string | null,"evidence"?: Json | null,"id"?: string,"journey_id"?: string | null,"priority"?: Database["public"]['Enums']["priority"],"ref"?: string | null,"source_feedback_id"?: string | null,"source_finding_id"?: string | null,"source_requirement_id"?: string | null,"source_submission_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_journey_id_fkey"
      columns: ["journey_id"]
isOneToOne: false
      referencedRelation: "journeys"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_source_feedback_fk"
      columns: ["source_feedback_id"]
isOneToOne: false
      referencedRelation: "client_feedback"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_source_finding_fk"
      columns: ["source_finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_source_requirement_fk"
      columns: ["source_requirement_id"]
isOneToOne: false
      referencedRelation: "requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"test_environments": {
                  Row: {
                    "access_notes": string | null,"allowed_domains": (string)[],"base_url": string,"campaign_id": string,"created_at": string,"created_by": string | null,"credentials_secret_id": string | null,"has_credentials": boolean,"id": string,"name": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "access_notes"?: string | null,"allowed_domains"?: (string)[],"base_url": string,"campaign_id": string,"created_at"?: string,"created_by"?: string | null,"credentials_secret_id"?: string | null,"has_credentials"?: boolean,"id"?: string,"name": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "access_notes"?: string | null,"allowed_domains"?: (string)[],"base_url"?: string,"campaign_id"?: string,"created_at"?: string,"created_by"?: string | null,"credentials_secret_id"?: string | null,"has_credentials"?: boolean,"id"?: string,"name"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "test_environments_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"worker_status": {
                  Row: {
                    "accelerator": string,"busy": boolean,"created_at": string,"created_by": string | null,"current_job_id": string | null,"id": string,"info": NonNullable<Json>,"last_seen_at": string,"model": string | null,"model_message": string | null,"model_ready": boolean,"updated_at": string,"version": number,"worker_name": string,"worker_user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accelerator"?: string,"busy"?: boolean,"created_at"?: string,"created_by"?: string | null,"current_job_id"?: string | null,"id"?: string,"info"?: NonNullable<Json>,"last_seen_at"?: string,"model"?: string | null,"model_message"?: string | null,"model_ready"?: boolean,"updated_at"?: string,"version"?: number,"worker_name": string,"worker_user_id": string
                  }
                  Update: {
                    "accelerator"?: string,"busy"?: boolean,"created_at"?: string,"created_by"?: string | null,"current_job_id"?: string | null,"id"?: string,"info"?: NonNullable<Json>,"last_seen_at"?: string,"model"?: string | null,"model_message"?: string | null,"model_ready"?: boolean,"updated_at"?: string,"version"?: number,"worker_name"?: string,"worker_user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"workspace_members": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deactivated_at": string | null,"id": string,"role": Database["public"]['Enums']["workspace_role"],"updated_at": string,"user_id": string,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deactivated_at"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"updated_at"?: string,"user_id": string,"version"?: number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deactivated_at"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"updated_at"?: string,"user_id"?: string,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_settings": {
                  Row: {
                    "allowed_domains": (string)[],"auto_triggers": NonNullable<Json>,"created_at": string,"created_by": string | null,"figma_enabled": boolean,"limits": NonNullable<Json>,"updated_at": string,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_domains"?: (string)[],"auto_triggers"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"figma_enabled"?: boolean,"limits"?: NonNullable<Json>,"updated_at"?: string,"version"?: number,"workspace_id": string
                  }
                  Update: {
                    "allowed_domains"?: (string)[],"auto_triggers"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"figma_enabled"?: boolean,"limits"?: NonNullable<Json>,"updated_at"?: string,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_settings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "pg_all_foreign_keys": {
                  Row: {
                    "fk_columns": (unknown)[] | null,"fk_constraint_name": unknown,"fk_schema_name": unknown,"fk_table_name": unknown,"fk_table_oid": unknown,"is_deferrable": boolean | null,"is_deferred": boolean | null,"match_type": string | null,"on_delete": string | null,"on_update": string | null,"pk_columns": (unknown)[] | null,"pk_constraint_name": unknown,"pk_index_name": unknown,"pk_schema_name": unknown,"pk_table_name": unknown,"pk_table_oid": unknown
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"tap_funky": {
                  Row: {
                    "args": string | null,"is_definer": boolean | null,"is_strict": boolean | null,"is_visible": boolean | null,"kind": unknown,"langoid": unknown,"name": unknown,"oid": unknown,"owner": unknown,"returns": string | null,"returns_set": boolean | null,"schema": unknown,"volatility": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "_auto_enabled":
{ Args: { "p_campaign": string,"p_type": Database["public"]['Enums']["review_type"] }; Returns: boolean
                           },
"_auto_enqueue":
{ Args: { "p_campaign": string,"p_source": Json,"p_types": (Database["public"]['Enums']["review_type"])[] }; Returns: number
                           },
"_cleanup":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"_contract_on":
{ Args: { "": string }; Returns: unknown
                           },
"_currtest":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"_db_privs":
{ Args: Record<PropertyKey, never>; Returns: (unknown)[]
                           },
"_enqueue_review":
{ Args: { "p_actor": string,"p_campaign": string,"p_run_again": boolean,"p_source": Json,"p_trigger": string,"p_type": Database["public"]['Enums']["review_type"] }; Returns: string
                           },
"_extensions":
{ Args: Record<PropertyKey, never>; Returns: unknown[]
                           },
"_get":
{ Args: { "": string }; Returns: number
                           },
"_get_latest":
{ Args: { "": string }; Returns: (number)[]
                           },
"_get_note":
{ Args: { "": string }; Returns: string
                           },
"_is_verbose":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"_notify_job":
{ Args: { "j": Omit<Database["public"]['Tables']["review_jobs"]['Row'], Database["public"]['Tables']["review_jobs"]['ComputedFields']>,"p_title": string }; Returns: undefined
                           },
"_prokind":
{ Args: { "p_oid": unknown }; Returns: unknown
                           },
"_query":
{ Args: { "": string }; Returns: string
                           },
"_refine_vol":
{ Args: { "": string }; Returns: string
                           },
"_require_worker":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"_retval":
{ Args: { "": string }; Returns: string
                           },
"_table_privs":
{ Args: Record<PropertyKey, never>; Returns: (unknown)[]
                           },
"_temptypes":
{ Args: { "": string }; Returns: string
                           },
"_todo":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"_worker_job":
{ Args: { "p_job": string }; Returns: {
              "attempts": number,
"campaign_id": string,
"cancel_requested": boolean,
"claimed_by": string | null,
"context_size": number | null,
"created_at": string,
"created_by": string | null,
"duration_ms": number | null,
"error": string | null,
"error_detail": Json | null,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"input": NonNullable<Json>,
"max_attempts": number,
"model": string | null,
"next_attempt_at": string,
"object_paths": (string)[],
"prompt_version": string | null,
"result_summary": Json | null,
"review_type": Database["public"]['Enums']["review_type"],
"run_again": boolean,
"source": NonNullable<Json>,
"source_hash": string,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"tokens_in": number | null,
"tokens_out": number | null,
"triggered_by": string,
"updated_at": string,
"version": number,
"worker_name": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "review_jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"accepted_requirements_json":
{ Args: { "p_campaign": string,"p_journey": string }; Returns: Json
                           },
"auth_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["workspace_role"]
                           },
"auth_workspace":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"campaign_report":
{ Args: { "p_campaign": string }; Returns: Json
                           },
"can_contribute":
{ Args: { "p_campaign": string }; Returns: boolean
                           },
"can_manage_campaign":
{ Args: { "p_campaign": string }; Returns: boolean
                           },
"can_read_campaign":
{ Args: { "p_campaign": string }; Returns: boolean
                           },
"cancel_review_job":
{ Args: { "p_job": string }; Returns: undefined
                           },
"claim_review_job":
{ Args: { "p_worker_name": string }; Returns: Json
                           },
"clear_environment_credentials":
{ Args: { "p_environment": string }; Returns: undefined
                           },
"col_is_null":
{ Args: { "column_name": unknown,"description"?: string,"schema_name": unknown,"table_name": unknown }; Returns: string
                           } |
{ Args: { "column_name": unknown,"description"?: string,"table_name": unknown }; Returns: string
                           },
"col_not_null":
{ Args: { "column_name": unknown,"description"?: string,"schema_name": unknown,"table_name": unknown }; Returns: string
                           } |
{ Args: { "column_name": unknown,"description"?: string,"table_name": unknown }; Returns: string
                           },
"complete_review_job":
{ Args: { "p_job": string,"p_meta"?: Json,"p_result": Json }; Returns: Json
                           },
"dashboard_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"diag":
{ Args: { "msg": unknown }; Returns: { error: true } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
                           } |
{ Args: { "msg": string }; Returns: { error: true } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
                           },
"diag_test_name":
{ Args: { "": string }; Returns: string
                           },
"do_tap":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           } |
{ Args: { "": string }; Returns: string[]
                           },
"enqueue_review":
{ Args: { "p_campaign": string,"p_run_again"?: boolean,"p_source": Json,"p_type": Database["public"]['Enums']["review_type"] }; Returns: string
                           },
"fail":
{ Args: Record<PropertyKey, never>; Returns: string
                           } |
{ Args: { "": string }; Returns: string
                           },
"fail_review_job":
{ Args: { "p_detail"?: Json,"p_error": string,"p_job": string,"p_retryable"?: boolean }; Returns: Json
                           },
"finalize_design_submission":
{ Args: { "p_submission": string }; Returns: number
                           },
"finalize_development_submission":
{ Args: { "p_submission": string }; Returns: number
                           },
"finalize_sow_version":
{ Args: { "p_version": string }; Returns: number
                           },
"findfuncs":
{ Args: { "": string }; Returns: (string)[]
                           },
"finish":
{ Args: { "exception_on_failure"?: boolean }; Returns: string[]
                           },
"format_type_string":
{ Args: { "": string }; Returns: string
                           },
"has_unique":
{ Args: { "": string }; Returns: string
                           },
"heartbeat_job":
{ Args: { "p_job": string }; Returns: Json
                           },
"import_campaigns":
{ Args: { "p_dry_run"?: boolean,"p_rows": Json }; Returns: Json
                           },
"in_todo":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_campaign_member":
{ Args: { "p_campaign": string }; Returns: boolean
                           },
"is_empty":
{ Args: { "": string }; Returns: string
                           },
"is_human_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_manager_or_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_worker":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"isnt_empty":
{ Args: { "": string }; Returns: string
                           },
"lives_ok":
{ Args: { "": string }; Returns: string
                           },
"next_ref":
{ Args: { "p_campaign": string,"p_kind": string,"p_prefix": string }; Returns: string
                           },
"no_plan":
{ Args: Record<PropertyKey, never>; Returns: boolean[]
                           },
"num_failed":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"os_name":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"pass":
{ Args: Record<PropertyKey, never>; Returns: string
                           } |
{ Args: { "": string }; Returns: string
                           },
"pg_version":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"pg_version_num":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"pgtap_version":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"runtests":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           } |
{ Args: { "": string }; Returns: string[]
                           },
"set_environment_credentials":
{ Args: { "p_environment": string,"p_extra"?: string,"p_password": string,"p_username": string }; Returns: undefined
                           },
"set_member_active":
{ Args: { "p_active": boolean,"p_user": string }; Returns: undefined
                           },
"set_member_role":
{ Args: { "p_role": Database["public"]['Enums']["workspace_role"],"p_user": string }; Returns: undefined
                           },
"skip":
{ Args: { "": string }; Returns: string
                           } |
{ Args: { "how_many": number,"why": string }; Returns: string
                           },
"storage_campaign":
{ Args: { "p_name": string }; Returns: string
                           },
"storage_usage":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"throws_ok":
{ Args: { "": string }; Returns: string
                           },
"todo":
{ Args: { "how_many": number }; Returns: boolean[]
                           } |
{ Args: { "how_many": number,"why": string }; Returns: boolean[]
                           } |
{ Args: { "why": string }; Returns: boolean[]
                           } |
{ Args: { "how_many": number,"why": string }; Returns: boolean[]
                           },
"todo_end":
{ Args: Record<PropertyKey, never>; Returns: boolean[]
                           },
"todo_start":
{ Args: Record<PropertyKey, never>; Returns: boolean[]
                           } |
{ Args: { "": string }; Returns: boolean[]
                           },
"worker_can_read_capture":
{ Args: { "p_name": string }; Returns: boolean
                           },
"worker_can_read_object":
{ Args: { "p_bucket": string,"p_name": string }; Returns: boolean
                           },
"worker_can_write_capture":
{ Args: { "p_name": string }; Returns: boolean
                           },
"worker_get_credentials":
{ Args: { "p_job": string }; Returns: Json
                           },
"worker_heartbeat":
{ Args: { "p_accelerator": string,"p_busy": boolean,"p_current_job"?: string,"p_info"?: Json,"p_model": string,"p_model_message": string,"p_model_ready": boolean,"p_worker_name": string }; Returns: undefined
                           },
"workspace_limits":
{ Args: { "p_campaign": string }; Returns: Json
                           }
          }
          Enums: {
            "approval_decision": "approved"|"changes_requested"|"rejected","campaign_role": "primary_manager"|"supporting_manager"|"designer"|"developer"|"qa_owner"|"member","campaign_stage": "brief_planning"|"design"|"development"|"internal_qa"|"client_uat"|"live_deployment"|"completed","campaign_status": "active"|"on_hold"|"completed"|"archived","check_method": "visually_observed"|"functionally_tested"|"backend_verified"|"manual","confidence": "high"|"medium"|"low"|"needs_manual_verification","deployment_status": "planned"|"deployed"|"verified"|"rolled_back","feedback_status": "open"|"converted"|"closed","finding_status": "new"|"awaiting_review"|"accepted"|"dismissed"|"assigned"|"in_progress"|"ready_for_retest"|"fixed"|"verified"|"reopened","health": "on_track"|"at_risk"|"blocked","job_status": "queued"|"processing"|"completed"|"failed"|"cancelled","priority": "low"|"medium"|"high"|"critical","requirement_category": "user_journey"|"screen"|"ui"|"functional"|"validation"|"business_rule"|"reward_logic"|"api_integration"|"legal"|"performance"|"security"|"analytics"|"deployment","requirement_status": "draft"|"accepted"|"rejected"|"needs_clarification","review_type": "sow_analysis"|"sow_vs_design"|"design_consistency"|"design_vs_development"|"sow_vs_development"|"functional_qa"|"regression","severity": "critical"|"high"|"medium"|"low"|"informational","submission_status": "submitted"|"in_review"|"changes_requested"|"approved"|"superseded","task_status": "todo"|"in_progress"|"ready_for_review"|"done"|"blocked","track_status": "not_started"|"in_progress"|"in_review"|"awaiting_client"|"changes_requested"|"approved","verification_state": "verified"|"failed"|"needs_verification"|"not_tested"|"blocked","workspace_role": "admin"|"manager"|"team_member"|"viewer"|"worker"
          }
          CompositeTypes: {
            "_time_trial_type": {
                        "a_time": number | null
                      }
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "approval_decision": ["approved", "changes_requested", "rejected"],"campaign_role": ["primary_manager", "supporting_manager", "designer", "developer", "qa_owner", "member"],"campaign_stage": ["brief_planning", "design", "development", "internal_qa", "client_uat", "live_deployment", "completed"],"campaign_status": ["active", "on_hold", "completed", "archived"],"check_method": ["visually_observed", "functionally_tested", "backend_verified", "manual"],"confidence": ["high", "medium", "low", "needs_manual_verification"],"deployment_status": ["planned", "deployed", "verified", "rolled_back"],"feedback_status": ["open", "converted", "closed"],"finding_status": ["new", "awaiting_review", "accepted", "dismissed", "assigned", "in_progress", "ready_for_retest", "fixed", "verified", "reopened"],"health": ["on_track", "at_risk", "blocked"],"job_status": ["queued", "processing", "completed", "failed", "cancelled"],"priority": ["low", "medium", "high", "critical"],"requirement_category": ["user_journey", "screen", "ui", "functional", "validation", "business_rule", "reward_logic", "api_integration", "legal", "performance", "security", "analytics", "deployment"],"requirement_status": ["draft", "accepted", "rejected", "needs_clarification"],"review_type": ["sow_analysis", "sow_vs_design", "design_consistency", "design_vs_development", "sow_vs_development", "functional_qa", "regression"],"severity": ["critical", "high", "medium", "low", "informational"],"submission_status": ["submitted", "in_review", "changes_requested", "approved", "superseded"],"task_status": ["todo", "in_progress", "ready_for_review", "done", "blocked"],"track_status": ["not_started", "in_progress", "in_review", "awaiting_client", "changes_requested", "approved"],"verification_state": ["verified", "failed", "needs_verification", "not_tested", "blocked"],"workspace_role": ["admin", "manager", "team_member", "viewer", "worker"]
          }
        }
} as const
