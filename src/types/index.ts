export type UserRole = 'super_admin' | 'admin' | 'editor' | 'member'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  member_id?: string
  active: boolean
  last_login?: string
  created_at: string
}

export interface Member {
  id: string
  code?: string
  committee_id?: string
  name_th: string
  name_en?: string
  nickname?: string
  position_yec?: string
  position_committee?: string
  email?: string
  phone?: string
  photo_url?: string
  lot?: string
  province?: string
  sort_order?: number
  active: boolean
  committees?: Committee
}

export interface Committee {
  id: string
  code?: string
  name: string
  name_en?: string
  color?: string
  icon?: string
  head_name?: string
  head_email?: string
  active: boolean
}

export interface MasterMember {
  id: string
  master_id: string
  region?: string
  province?: string
  seq_no?: string
  org_info?: string
  entity_type?: string
  business_name?: string
  tax_id?: string
  business_type_tsic?: string
  business_type_network?: string
  business_detail?: string
  has_tcc_connect?: string
  prefix?: string
  first_name?: string
  last_name?: string
  national_id?: string
  is_yec_provincial?: string
  yec_position?: string
  phone?: string
  email?: string
  current_address?: string
  birth_date?: string
  member_since_date?: string
  member_expiry_date?: string
  verified_by_chair?: string
  payment_status?: string
  is_chamber_member?: string
  synced_at?: string
  deleted: boolean
}

export interface Section {
  id: string
  code?: string
  title: string
  color?: string
  icon?: string
  sort_order: number
  active: boolean
}

export interface TaskType {
  id: string
  name: string
  color: string
}

export interface Attachment {
  id?: string
  name: string
  viewUrl: string
  mimeType: string
  driveFileId?: string
  uploadedAt?: string
  dataUrl?: string
  linkType?: string
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Task {
  id: string
  code?: string
  section_id?: string
  title: string
  description?: string
  start_date?: string
  end_date?: string
  start_time?: string
  end_time?: string
  task_type_id?: string
  owner_id?: string
  parent_task_id?: string
  tags: string[]
  checklist: ChecklistItem[]
  attachments: Attachment[]
  drive_folder_url?: string
  calendar_event_id?: string
  calendar_event_url?: string
  calendar_sync_status?: string
  completed: boolean
  completed_at?: string
  deleted: boolean
  deleted_at?: string
  deleted_by?: string
  created_by?: string
  created_at: string
  updated_at: string
  _optimistic?: boolean
  // joins
  sections?: Section
  task_types?: TaskType
  task_members?: TaskMember[]
  task_staff?: TaskStaff[]
}

export interface TaskMember {
  id: string
  task_id: string
  member_id?: string
  committee_id?: string
  role: 'assignee' | 'watcher'
  members?: Member
  committees?: Committee
}

export interface TaskStaff {
  id: string
  task_id: string
  user_id: string
  sort_order?: number
  created_at?: string
  users?: User & {
    members?: Pick<Member, 'id' | 'name_th' | 'nickname' | 'email' | 'position_committee' | 'province'> | null
  }
}

export interface TodoItem {
  id: string
  code?: string
  owner_id?: string
  owner_email?: string
  owner_name?: string
  created_by?: string
  created_by_email?: string
  title: string
  note?: string | null
  status: 'open' | 'done' | 'archived'
  priority: 'normal' | 'high'
  due_date?: string | null
  due_time?: string | null
  pinned: boolean
  sort_order?: number
  completed_at?: string | null
  deleted: boolean
  deleted_at?: string
  created_at: string
  updated_at: string
}

export interface KanbanCard {
  id: string
  title: string
  description?: string | null
  status: 'todo' | 'in_progress' | 'done'
  position: number
  due_date?: string | null
  assignee_ids: string[]
  assignee_names: string[]
  committee_ids: string[]
  created_by?: string | null
  deleted: boolean
  created_at: string
  updated_at: string
}

export interface BudgetCategory {
  id: string
  accounting_code: string
  name: string
  kind: 'revenue' | 'expense'
  sort_order?: number
  active: boolean
}

export interface BudgetProject {
  id: string
  code?: string
  fiscal_year: number
  department_code: string
  project_name: string
  external_code?: string
  budget_filter?: string
  budget_category?: string
  project_type?: string
  planned_revenue: number
  planned_expense: number
  planned_net: number
  owner_member_id?: string
  status: string
  approved_date?: string
  source_file?: string
  created_at: string
  updated_at: string
}

export interface BudgetPlan {
  id: string
  project_id: string
  accounting_code: string
  kind: 'revenue' | 'expense'
  month: number
  planned_amount: number
}

export interface BudgetTransaction {
  id: string
  code?: string
  project_id: string
  accounting_code: string
  kind: 'revenue' | 'expense'
  transaction_date: string
  amount: number
  vendor?: string
  description?: string
  receipt_url?: string
  receipt_file_id?: string
  created_by?: string
  deleted: boolean
  deleted_at?: string
  created_at: string
  updated_at: string
}

export type ApprovalStatus = 'draft' | 'pending' | 'approved' | 'revision_requested' | 'cancelled'
export type ApproverStatus = 'waiting' | 'approved' | 'revision_requested'

export interface ApprovalApprover {
  id: string
  approval_id: string
  order_no: number
  approver_name: string
  approver_email: string
  member_id?: string
  token?: string
  status: ApproverStatus
  acted_at?: string
  note?: string
  sent_at?: string
}

export interface ApprovalDocument {
  id: string
  code?: string
  title: string
  description?: string
  drive_file_id?: string
  file_url?: string
  file_name?: string
  mime_type?: string
  version: number
  status: ApprovalStatus
  doc_type: 'sign' | 'disbursement'
  deleted: boolean
  deleted_at?: string
  created_by?: string
  created_by_email?: string
  created_at: string
  updated_at: string
  approval_approvers?: ApprovalApprover[]
}

export interface ApprovalVersion {
  id: string
  approval_id: string
  version: number
  drive_file_id?: string
  file_url?: string
  file_name?: string
  uploaded_by?: string
  uploaded_at: string
  change_note?: string
}

export interface ApprovalLog {
  id: string
  approval_id: string
  approver_id?: string
  action: string
  detail?: string
  actor_email?: string
  meta?: Record<string, unknown>
  created_at: string
}
