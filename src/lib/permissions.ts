import type { UserRole } from '../types'

// ─── Task Board ───────────────────────────────────────────────────────────────
/** editor, admin, super_admin สร้าง/แก้ไข Task ได้ */
export function canEditTasks(role?: UserRole | null) {
  return role === 'editor' || role === 'admin' || role === 'super_admin'
}

/** admin, super_admin ลบ Task ได้ */
export function canDeleteTasks(role?: UserRole | null) {
  return role === 'admin' || role === 'super_admin'
}

// ─── Budget ───────────────────────────────────────────────────────────────────
/** editor, admin, super_admin แก้ไขงบได้ */
export function canEditBudget(role?: UserRole | null) {
  return canEditTasks(role)
}

// ─── Approval ─────────────────────────────────────────────────────────────────
/** editor, admin, super_admin สร้าง/แก้ไข/ลบเอกสารอนุมัติ */
export function canEditApprovals(role?: UserRole | null) {
  return canEditTasks(role)
}

// ─── Directory ────────────────────────────────────────────────────────────────
/** admin, super_admin แก้ไขข้อมูลสมาชิก */
export function canManageDirectory(role?: UserRole | null) {
  return role === 'admin' || role === 'super_admin'
}

// ─── Master Data (ฐานข้อมูลสมาชิก YEC ทั่วประเทศ) ──────────────────────────────
/** admin, super_admin แก้ไขข้อมูล Master Data ได้ (มีข้อมูลอ่อนไหว เช่น เลขบัตรประชาชน) */
export function canManageMasterData(role?: UserRole | null) {
  return role === 'admin' || role === 'super_admin'
}

// ─── Meeting check-in ─────────────────────────────────────────────────────────
/** editor, admin, super_admin สร้าง/แก้ไข/ลบการประชุมได้ */
export function canEditMeetings(role?: UserRole | null) {
  return canEditTasks(role)
}

// ─── Todo ─────────────────────────────────────────────────────────────────────
/** super_admin ดู Todo dashboard ของทุกคน */
export function canViewTodoDashboard(role?: UserRole | null) {
  return role === 'super_admin'
}

// ─── AI Features ──────────────────────────────────────────────────────────────
/** editor, admin, super_admin ใช้ AI สร้าง Task / AI รายงานประจำปี */
export function canUseAiCreate(role?: UserRole | null) {
  return canEditTasks(role)
}

// ─── System / Users ───────────────────────────────────────────────────────────
/** admin, super_admin เข้า System page */
export function canManageSystem(role?: UserRole | null) {
  return role === 'admin' || role === 'super_admin'
}

/** admin, super_admin ดูรายชื่อ Users */
export function canViewUsers(role?: UserRole | null) {
  return role === 'admin' || role === 'super_admin'
}

/** super_admin เท่านั้นที่เปลี่ยน role / รหัสผ่านผู้ใช้ */
export function canManageUsers(role?: UserRole | null) {
  return role === 'super_admin'
}
