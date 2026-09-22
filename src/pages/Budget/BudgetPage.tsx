import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activityLog'
import { canEditBudget } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import type { BudgetCategory, BudgetPlan, BudgetProject, BudgetTransaction } from '../../types'

type ProjectWithTotals = BudgetProject & {
  actualRevenue: number
  actualExpense: number
  actualNet: number
  remainingExpense: number
  usedPct: number
}

type DetailRow = {
  code: string
  name: string
  kind: 'revenue' | 'expense'
  plan: number[]
  actual: number[]
  planTotal: number
  actualTotal: number
}

type ProjectDetail = {
  project: ProjectWithTotals
  rows: DetailRow[]
}

type DetailTotals = {
  planRevenue: number
  planExpense: number
  actualRevenue: number
  actualExpense: number
  planNet: number
  actualNet: number
  remainingExpense: number
  planRevMo: number[]
  planExpMo: number[]
  actualRevMo: number[]
  actualExpMo: number[]
}

type DetailMode = 'compare' | 'plan' | 'actual'
type RightTab = 'overview' | 'transactions' | 'manage'

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const SOFT_FIELD: CSSProperties = {
  width: '100%',
  minHeight: 44,
  borderRadius: 14,
  border: '1.5px solid #dbe4f0',
  background: '#f8fafc',
  color: '#0f172a',
  padding: '0 12px',
  fontFamily: 'Anuphan, sans-serif',
  fontSize: 14,
  outline: 'none',
}

function money(value?: number | null) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

function compactMoney(value?: number | null) {
  return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number(value ?? 0))} บาท`
}

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function numberValue(value: unknown) {
  return Number(String(value ?? '').replace(/,/g, '') || 0)
}

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function projectOrderNo(project: Pick<BudgetProject, 'budget_filter' | 'code' | 'project_name'>) {
  const code = project.budget_filter || project.code || project.project_name || ''
  const match = String(code).match(/-(\d{1,3})$/) || String(code).match(/(\d{1,3})$/)
  return match ? Number(match[1]) : 9999
}

function sortProjects(a: BudgetProject, b: BudgetProject) {
  if (a.department_code !== b.department_code) return a.department_code.localeCompare(b.department_code, 'th')
  const ao = projectOrderNo(a)
  const bo = projectOrderNo(b)
  if (ao !== bo) return ao - bo
  return (a.budget_filter || a.project_name).localeCompare(b.budget_filter || b.project_name, 'th')
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function transactionMonth(tx: BudgetTransaction) {
  const match = String(tx.transaction_date || '').match(/^\d{4}-(\d{2})-/)
  return match ? Number(match[1]) : 0
}

function buildProjectDetail(
  project: ProjectWithTotals | null | undefined,
  plans: BudgetPlan[],
  transactions: BudgetTransaction[],
  categoryByCode: Record<string, BudgetCategory>,
): ProjectDetail | null {
  if (!project) return null
  const rows: Record<string, DetailRow> = {}

  const ensure = (codeValue: string, kindValue: 'revenue' | 'expense') => {
    const code = String(codeValue || 'ไม่ระบุรหัส')
    const category = categoryByCode[code]
    const kind = kindValue || category?.kind || 'expense'
    const key = `${kind}|${code}`
    rows[key] ??= {
      code,
      name: category?.name || code,
      kind,
      plan: Array.from({ length: 13 }, () => 0),
      actual: Array.from({ length: 13 }, () => 0),
      planTotal: 0,
      actualTotal: 0,
    }
    return rows[key]
  }

  plans.forEach(plan => {
    if (plan.project_id !== project.id || plan.month < 1 || plan.month > 12) return
    const row = ensure(plan.accounting_code, plan.kind)
    row.plan[plan.month] += Number(plan.planned_amount ?? 0)
    row.planTotal += Number(plan.planned_amount ?? 0)
  })

  transactions.forEach(tx => {
    if (tx.project_id !== project.id) return
    const month = transactionMonth(tx)
    if (month < 1 || month > 12) return
    const row = ensure(tx.accounting_code, tx.kind)
    row.actual[month] += Number(tx.amount ?? 0)
    row.actualTotal += Number(tx.amount ?? 0)
  })

  return {
    project,
    rows: Object.values(rows).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'revenue' ? -1 : 1
      return a.code.localeCompare(b.code, 'th')
    }),
  }
}

function detailTotals(detail: ProjectDetail | null): DetailTotals {
  const out: DetailTotals = {
    planRevenue: 0,
    planExpense: 0,
    actualRevenue: 0,
    actualExpense: 0,
    planNet: 0,
    actualNet: 0,
    remainingExpense: 0,
    planRevMo: Array.from({ length: 13 }, () => 0),
    planExpMo: Array.from({ length: 13 }, () => 0),
    actualRevMo: Array.from({ length: 13 }, () => 0),
    actualExpMo: Array.from({ length: 13 }, () => 0),
  }

  detail?.rows.forEach(row => {
    for (let month = 1; month <= 12; month += 1) {
      if (row.kind === 'revenue') {
        out.planRevMo[month] += Number(row.plan[month] ?? 0)
        out.actualRevMo[month] += Number(row.actual[month] ?? 0)
      } else {
        out.planExpMo[month] += Number(row.plan[month] ?? 0)
        out.actualExpMo[month] += Number(row.actual[month] ?? 0)
      }
    }
    if (row.kind === 'revenue') {
      out.planRevenue += row.planTotal
      out.actualRevenue += row.actualTotal
    } else {
      out.planExpense += row.planTotal
      out.actualExpense += row.actualTotal
    }
  })

  out.planNet = out.planRevenue - out.planExpense
  out.actualNet = out.actualRevenue - out.actualExpense
  out.remainingExpense = out.planExpense - out.actualExpense
  return out
}

function printBudgetHtml(title: string, body: string, landscape = true) {
  const win = window.open('', '_blank', 'width=1280,height=820')
  if (!win) {
    window.alert('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง')
    return
  }

  win.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 9mm; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f6f8fc; color: #0f172a; font-family: Anuphan, Arial, sans-serif; }
          .sheet { background: #fff; border: 1px solid #dbe4f0; border-radius: 16px; overflow: hidden; }
          .hero { padding: 18px 22px; color: #fff; background: linear-gradient(135deg, #13244a 0%, #1f4f9a 62%, #b58f27 100%); }
          .eyebrow { font-size: 10px; letter-spacing: 4px; opacity: .8; font-weight: 900; }
          h1 { margin: 5px 0 4px; font-size: 24px; line-height: 1.18; }
          .sub { font-size: 11px; opacity: .9; }
          .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 12px; background: #f8fafc; }
          .kpi { border: 1px solid #dbe4f0; border-radius: 12px; padding: 10px; background: #fff; }
          .kpi span { display: block; color: #64748b; font-size: 10px; font-weight: 800; }
          .kpi b { display: block; margin-top: 3px; font-size: 15px; }
          .section { padding: 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 8.7px; }
          th { background: #eff6ff; color: #1e3a8a; text-align: left; font-weight: 900; border: 1px solid #bfdbfe; padding: 5px 6px; }
          td { border: 1px solid #e2e8f0; padding: 5px 6px; vertical-align: top; }
          tbody tr:nth-child(even) { background: #f8fafc; }
          .num { text-align: right; white-space: nowrap; }
          .good { color: #059669; }
          .bad { color: #dc2626; }
          .muted { color: #64748b; font-size: 8.4px; }
          .title { font-weight: 900; }
          .cell2 { line-height: 1.35; }
          .cell2 span { display: block; color: #64748b; font-size: 8px; }
          .cell2 b { display: block; font-size: 8.5px; }
          .footer { color: #64748b; font-size: 10px; padding: 0 12px 12px; }
          @media print { body { background: #fff; } .sheet { border: none; border-radius: 0; } }
        </style>
      </head>
      <body>${body}<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script></body>
    </html>`)
  win.document.close()
  win.focus()
}

export default function BudgetPage() {
  const { user } = useAuthStore()
  const [projects, setProjects] = useState<BudgetProject[]>([])
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [plans, setPlans] = useState<BudgetPlan[]>([])
  const [transactions, setTransactions] = useState<BudgetTransaction[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [budgetFilter, setBudgetFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [detailMode, setDetailMode] = useState<DetailMode>('compare')
  const [detailPopupOpen, setDetailPopupOpen] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('overview')
  const [panelWidth, setPanelWidth] = useState(640)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectEditorOpen, setProjectEditorOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [projectForm, setProjectForm] = useState({
    fiscal_year: String(new Date().getFullYear() + 543),
    department_code: '',
    project_name: '',
    external_code: '',
    budget_filter: '',
    budget_category: '',
    project_type: '',
    planned_revenue: '0',
    planned_expense: '0',
  })
  const [categoryForm, setCategoryForm] = useState({
    accounting_code: '',
    name: '',
    kind: 'expense' as 'revenue' | 'expense',
  })
  const [planCategoryCode, setPlanCategoryCode] = useState('')
  const [planAmounts, setPlanAmounts] = useState<string[]>(Array.from({ length: 12 }, () => ''))
  const [form, setForm] = useState({
    accounting_code: '',
    transaction_date: todayKey(),
    amount: '',
    vendor: '',
    description: '',
    receipt_url: '',
  })
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canEdit = canEditBudget(user?.role)

  useEffect(() => {
    let active = true

    const loadBudget = async () => {
      setLoading(true)
      setError(null)

      const [projectsRes, categoriesRes, plansRes, txRes] = await Promise.all([
        supabase.from('budget_projects').select('*').neq('status', 'deleted').order('department_code').order('budget_filter'),
        supabase.from('budget_categories').select('*').eq('active', true).order('kind').order('sort_order').order('name'),
        supabase.from('budget_plans').select('*'),
        supabase.from('budget_transactions').select('*').eq('deleted', false).order('transaction_date', { ascending: false }),
      ])

      if (!active) return

      const firstError = projectsRes.error || categoriesRes.error || plansRes.error || txRes.error
      if (firstError) {
        setError(firstError.message)
        setProjects([])
        setCategories([])
        setPlans([])
        setTransactions([])
      } else {
        const nextProjects = ((projectsRes.data ?? []) as BudgetProject[]).sort(sortProjects)
        setProjects(nextProjects)
        setCategories((categoriesRes.data ?? []) as BudgetCategory[])
        setPlans((plansRes.data ?? []) as BudgetPlan[])
        setTransactions((txRes.data ?? []) as BudgetTransaction[])

      }

      setLoading(false)
    }

    loadBudget()

    return () => {
      active = false
    }
  }, [])

  // Track right-panel width for responsive layouts
  useEffect(() => {
    const el = rightPanelRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      setPanelWidth(entries[0].contentRect.width)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const categoryByCode = useMemo(() => {
    return categories.reduce<Record<string, BudgetCategory>>((acc, item) => {
      acc[item.accounting_code] = item
      return acc
    }, {})
  }, [categories])

  const projectsWithTotals = useMemo<ProjectWithTotals[]>(() => {
    const totalsByProject = transactions.reduce<Record<string, { revenue: number; expense: number }>>((acc, tx) => {
      const bucket = acc[tx.project_id] ?? { revenue: 0, expense: 0 }
      if (tx.kind === 'revenue') bucket.revenue += Number(tx.amount ?? 0)
      else bucket.expense += Number(tx.amount ?? 0)
      acc[tx.project_id] = bucket
      return acc
    }, {})

    return projects.map(project => {
      const actual = totalsByProject[project.id] ?? { revenue: 0, expense: 0 }
      const plannedExpense = Number(project.planned_expense ?? 0)
      const actualExpense = Number(actual.expense ?? 0)

      return {
        ...project,
        actualRevenue: actual.revenue,
        actualExpense,
        actualNet: actual.revenue - actualExpense,
        remainingExpense: plannedExpense - actualExpense,
        usedPct: plannedExpense > 0 ? Math.min(999, Math.round(actualExpense * 1000 / plannedExpense) / 10) : 0,
      }
    }).sort(sortProjects)
  }, [projects, transactions])

  const filteredProjects = useMemo(() => {
    const keyword = normalize(search)
    return projectsWithTotals.filter(project => {
      if (budgetFilter && project.department_code !== budgetFilter) return false
      if (typeFilter && project.project_type !== typeFilter) return false
      const haystack = [
        project.project_name,
        project.department_code,
        project.external_code,
        project.budget_filter,
        project.budget_category,
        project.project_type,
      ].map(normalize).join(' ')
      return !keyword || haystack.includes(keyword)
    })
  }, [budgetFilter, projectsWithTotals, search, typeFilter])

  const totals = useMemo(() => filteredProjects.reduce((acc, project) => {
    acc.plannedRevenue += Number(project.planned_revenue ?? 0)
    acc.plannedExpense += Number(project.planned_expense ?? 0)
    acc.plannedNet += Number(project.planned_net ?? 0)
    acc.actualRevenue += project.actualRevenue
    acc.actualExpense += project.actualExpense
    acc.actualNet += project.actualNet
    acc.remainingExpense += project.remainingExpense
    return acc
  }, {
    plannedRevenue: 0,
    plannedExpense: 0,
    plannedNet: 0,
    actualRevenue: 0,
    actualExpense: 0,
    actualNet: 0,
    remainingExpense: 0,
  }), [filteredProjects])

  // Dynamic department filter list derived from data
  const budgetFilters = useMemo(
    () => Array.from(new Set(projectsWithTotals.map(p => p.department_code).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'th')),
    [projectsWithTotals],
  )

  const projectTypes = useMemo(
    () => Array.from(new Set(projectsWithTotals.map(project => project.project_type).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'th')),
    [projectsWithTotals],
  )

  // Group filtered projects by department for sidebar display
  const projectsByDepartment = useMemo(() => {
    const groups: Record<string, ProjectWithTotals[]> = {}
    filteredProjects.forEach(p => {
      const dept = p.department_code || 'ไม่ระบุ'
      if (!groups[dept]) groups[dept] = []
      groups[dept].push(p)
    })
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'th'))
  }, [filteredProjects])

  const selectedProject = selectedProjectId
    ? (filteredProjects.find(project => project.id === selectedProjectId) ?? null)
    : null
  const selectedTransactions = selectedProject ? transactions.filter(tx => tx.project_id === selectedProject.id) : []
  const selectedPlans = selectedProject ? plans.filter(plan => plan.project_id === selectedProject.id) : []
  const selectedDetail = useMemo(
    () => buildProjectDetail(selectedProject, plans, transactions, categoryByCode),
    [categoryByCode, plans, selectedProject, transactions],
  )
  const selectedDetailTotals = useMemo(() => detailTotals(selectedDetail), [selectedDetail])
  const visibleDetailMonths = useMemo(() => {
    const months = MONTHS_TH.map((_, index) => index + 1).filter(month => (
      selectedDetail?.rows.some(row => Number(row.plan[month] ?? 0) || Number(row.actual[month] ?? 0))
    ))
    return months.length ? months : MONTHS_TH.map((_, index) => index + 1)
  }, [selectedDetail])

  const expenseCategories = categories.filter(item => item.kind === 'expense')
  const revenueCategories = categories.filter(item => item.kind === 'revenue')
  const formCategory = categoryByCode[form.accounting_code]

  const openProjectEditor = (project?: BudgetProject) => {
    setError(null)
    setEditingProjectId(project?.id ?? null)
    setProjectForm({
      fiscal_year: String(project?.fiscal_year ?? new Date().getFullYear() + 543),
      department_code: project?.department_code ?? '',
      project_name: project?.project_name ?? '',
      external_code: project?.external_code ?? '',
      budget_filter: project?.budget_filter ?? '',
      budget_category: project?.budget_category ?? '',
      project_type: project?.project_type ?? '',
      planned_revenue: String(project?.planned_revenue ?? 0),
      planned_expense: String(project?.planned_expense ?? 0),
    })
    setProjectEditorOpen(true)
  }

  const closeProjectEditor = () => {
    if (saving) return
    setProjectEditorOpen(false)
    setEditingProjectId(null)
  }

  const saveProject = async () => {
    if (!user || !canEdit || saving) return
    const fiscalYear = Number(projectForm.fiscal_year)
    const plannedRevenue = numberValue(projectForm.planned_revenue)
    const plannedExpense = numberValue(projectForm.planned_expense)
    if (!projectForm.department_code.trim() || !projectForm.project_name.trim() || !fiscalYear) {
      setError('กรุณากรอกปีงบประมาณ รหัสงบ และชื่อโครงการ')
      return
    }

    setSaving(true)
    setError(null)
    const payload = {
      fiscal_year: fiscalYear,
      department_code: projectForm.department_code.trim(),
      project_name: projectForm.project_name.trim(),
      external_code: projectForm.external_code.trim() || null,
      budget_filter: projectForm.budget_filter.trim() || null,
      budget_category: projectForm.budget_category.trim() || null,
      project_type: projectForm.project_type.trim() || null,
      planned_revenue: plannedRevenue,
      planned_expense: plannedExpense,
      planned_net: plannedRevenue - plannedExpense,
      status: 'active',
    }

    const result = editingProjectId
      ? await supabase.from('budget_projects').update(payload).eq('id', editingProjectId).select('*').single()
      : await supabase.from('budget_projects').insert(payload).select('*').single()

    if (result.error || !result.data) {
      setError(result.error?.message ?? 'บันทึกโครงการไม่สำเร็จ')
    } else {
      const saved = result.data as BudgetProject
      setProjects(prev => {
        const next = editingProjectId ? prev.map(project => project.id === saved.id ? saved : project) : [saved, ...prev]
        return next.sort(sortProjects)
      })
      setSelectedProjectId(saved.id)
      await logActivity(user, editingProjectId ? 'budget.project.updated' : 'budget.project.created', saved.project_name, { project_id: saved.id })
      closeProjectEditor()
    }
    setSaving(false)
  }

  const saveCategory = async () => {
    if (!user || !canEdit || saving) return
    if (!categoryForm.accounting_code.trim() || !categoryForm.name.trim()) {
      setError('กรุณากรอกรหัสบัญชีและชื่อหมวด')
      return
    }

    setSaving(true)
    setError(null)
    const { data, error } = await supabase
      .from('budget_categories')
      .upsert({
        accounting_code: categoryForm.accounting_code.trim(),
        name: categoryForm.name.trim(),
        kind: categoryForm.kind,
        active: true,
      }, { onConflict: 'accounting_code' })
      .select('*')
      .single()

    if (error) setError(error.message)
    else if (data) {
      setCategories(prev => {
        const saved = data as BudgetCategory
        return [...prev.filter(item => item.accounting_code !== saved.accounting_code), saved]
          .sort((a, b) => a.kind.localeCompare(b.kind) || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name.localeCompare(b.name, 'th'))
      })
      setCategoryForm({ accounting_code: '', name: '', kind: 'expense' })
      await logActivity(user, 'budget.category.saved', (data as BudgetCategory).name, { accounting_code: (data as BudgetCategory).accounting_code })
    }
    setSaving(false)
  }

  const loadPlanEditor = (accountingCode: string) => {
    setPlanCategoryCode(accountingCode)
    const next = Array.from({ length: 12 }, (_, index) => {
      const plan = selectedPlans.find(item => item.accounting_code === accountingCode && item.month === index + 1)
      return plan?.planned_amount ? String(plan.planned_amount) : ''
    })
    setPlanAmounts(next)
  }

  const saveMonthlyPlan = async () => {
    if (!user || !selectedProject || !canEdit || saving) return
    const category = categoryByCode[planCategoryCode]
    if (!category) {
      setError('กรุณาเลือกหมวดงบประมาณสำหรับแผนรายเดือน')
      return
    }

    setSaving(true)
    setError(null)
    const rows = planAmounts.map((amount, index) => ({
      project_id: selectedProject.id,
      accounting_code: category.accounting_code,
      kind: category.kind,
      month: index + 1,
      planned_amount: numberValue(amount),
    }))

    const { data, error } = await supabase
      .from('budget_plans')
      .upsert(rows, { onConflict: 'project_id,accounting_code,kind,month' })
      .select('*')

    if (error) {
      setError(error.message)
    } else {
      const savedRows = (data ?? []) as BudgetPlan[]
      setPlans(prev => [
        ...prev.filter(item => !(item.project_id === selectedProject.id && item.accounting_code === category.accounting_code && item.kind === category.kind)),
        ...savedRows,
      ])
      await logActivity(user, 'budget.plan.updated', selectedProject.project_name, { project_id: selectedProject.id, accounting_code: category.accounting_code })
    }
    setSaving(false)
  }

  // ── Compress image with Canvas before sending (2-4 MB → ~200-400 KB) ──
  const compressImage = (file: File, maxDim = 1536, quality = 0.82): Promise<{ base64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim }
          else { width = Math.round(width * maxDim / height); height = maxDim }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return }
          const reader = new FileReader()
          reader.onload = () => resolve({ base64: (reader.result as string).split(',')[1], mimeType: 'image/jpeg' })
          reader.onerror = reject
          reader.readAsDataURL(blob)
        }, 'image/jpeg', quality)
      }
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')) }
      img.src = objectUrl
    })

  // ── Convert non-image File to base64 (PDF etc.) ──
  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  // ── Handle receipt file selection → show preview → run OCR ──
  const handleReceiptFile = async (file: File) => {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') return

    setReceiptFile(file)
    setOcrError(null)
    setOcrFields(new Set())

    // Show local preview (images only)
    if (file.type.startsWith('image/')) {
      setReceiptPreview(URL.createObjectURL(file))
    } else {
      setReceiptPreview(null)
    }

    // OCR
    setOcrLoading(true)
    try {
      // Compress images; send PDF as-is
      let imageBase64: string
      let mimeType: string
      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file)
        imageBase64 = compressed.base64
        mimeType = compressed.mimeType
      } else {
        imageBase64 = await toBase64(file)
        mimeType = file.type
      }

      const { data, error } = await supabase.functions.invoke('extract-receipt', {
        body: { imageBase64, mimeType },
      })

      // error here means network/deploy problem; data.error = OCR/OpenAI problem
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(String(data.error))

      const filled = new Set<string>()
      const updates: Partial<typeof form> = {}

      if (data?.amount != null && Number(data.amount) > 0) {
        updates.amount = String(Math.round(Number(data.amount)))
        filled.add('amount')
      }
      if (data?.vendor) {
        updates.vendor = String(data.vendor)
        filled.add('vendor')
      }
      if (data?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
        updates.transaction_date = String(data.date)
        filled.add('transaction_date')
      }
      if (data?.description) {
        updates.description = String(data.description).slice(0, 200)
        filled.add('description')
      }

      setForm(prev => ({ ...prev, ...updates }))
      setOcrFields(filled)
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'ไม่สามารถอ่านใบเสร็จได้')
    } finally {
      setOcrLoading(false)
    }
  }

  // ── Upload receipt file to Supabase Storage ──
  const uploadReceiptFile = async (file: File, projectId: string): Promise<string | null> => {
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (error) return null
      const { data } = supabase.storage.from('receipts').getPublicUrl(path)
      return data.publicUrl
    } catch {
      return null
    }
  }

  const createTransaction = async () => {
    if (!user || !selectedProject || !canEdit || saving) return
    const amount = numberValue(form.amount)
    if (!formCategory) {
      setError('กรุณาเลือกหมวดงบประมาณ')
      return
    }
    if (!(amount > 0)) {
      setError('กรุณาระบุจำนวนเงินมากกว่า 0')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.transaction_date)) {
      setError('รูปแบบวันที่ไม่ถูกต้อง')
      return
    }

    setSaving(true)
    setError(null)

    // Upload receipt file to Storage (best-effort — doesn't block save)
    let receiptUrl = form.receipt_url.trim() || null
    if (receiptFile) {
      const uploaded = await uploadReceiptFile(receiptFile, selectedProject.id)
      if (uploaded) receiptUrl = uploaded
    }

    const payload = {
      project_id: selectedProject.id,
      accounting_code: form.accounting_code,
      kind: formCategory.kind,
      transaction_date: form.transaction_date,
      amount,
      vendor: form.vendor.trim() || null,
      description: form.description.trim() || null,
      receipt_url: receiptUrl,
      created_by: user.id,
      deleted: false,
    }

    const { data, error } = await supabase.from('budget_transactions').insert(payload).select('*').single()

    if (error) {
      setError(error.message)
    } else if (data) {
      const created = data as BudgetTransaction
      setTransactions(prev => [created, ...prev])
      setForm({ accounting_code: '', transaction_date: todayKey(), amount: '', vendor: '', description: '', receipt_url: '' })
      // Clear receipt state
      setReceiptFile(null)
      setReceiptPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
      setOcrFields(new Set())
      setOcrError(null)
      await logActivity(user, 'budget.transaction.created', selectedProject.project_name, { project_id: selectedProject.id, transaction_id: created.id, amount })
    }

    setSaving(false)
  }

  const deleteTransaction = async (tx: BudgetTransaction) => {
    if (!user || !canEdit) return
    const before = transactions
    setTransactions(prev => prev.filter(item => item.id !== tx.id))

    const { error } = await supabase
      .from('budget_transactions')
      .update({ deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', tx.id)

    if (error) {
      setTransactions(before)
      setError(error.message)
    } else {
      await logActivity(user, 'budget.transaction.deleted', tx.description || tx.accounting_code, { transaction_id: tx.id, project_id: tx.project_id })
    }
  }

  const buildDetailsForProjects = (items: ProjectWithTotals[]) => items.map(project => buildProjectDetail(project, plans, transactions, categoryByCode)).filter(Boolean) as ProjectDetail[]

  const exportOverviewCsv = () => {
    const rows: unknown[][] = [['project_id', 'project_name', 'department', 'type', 'accounting_code', 'category', 'kind', 'month', 'planned', 'actual', 'variance']]
    buildDetailsForProjects(filteredProjects).forEach(detail => {
      detail.rows.forEach(row => {
        for (let month = 1; month <= 12; month += 1) {
          const plan = Number(row.plan[month] ?? 0)
          const actual = Number(row.actual[month] ?? 0)
          if (!plan && !actual) continue
          rows.push([detail.project.code || detail.project.id, detail.project.project_name, detail.project.department_code, detail.project.project_type, row.code, row.name, row.kind, month, plan, actual, plan - actual])
        }
      })
    })
    downloadCsv(`budget-report-${todayKey()}.csv`, rows)
  }

  const exportProjectCsv = () => {
    if (!selectedDetail) return
    const rows: unknown[][] = [['รหัสบัญชี', 'หมวด', 'ประเภท', 'รวมแผน', 'รวมจริง', 'ส่วนต่าง']]
    MONTHS_TH.forEach(month => rows[0].push(`${month} แผน`, `${month} จริง`))
    selectedDetail.rows.forEach(row => {
      const item: unknown[] = [row.code, row.name, row.kind === 'revenue' ? 'รายรับ' : 'รายจ่าย', row.planTotal, row.actualTotal, row.planTotal - row.actualTotal]
      for (let month = 1; month <= 12; month += 1) item.push(row.plan[month] || 0, row.actual[month] || 0)
      rows.push(item)
    })
    downloadCsv(`budget-${selectedProject?.budget_filter || selectedProject?.code || selectedProject?.id}-${todayKey()}.csv`, rows)
  }

  const printOverview = () => {
    const details = buildDetailsForProjects(filteredProjects)
    const month = Array.from({ length: 13 }, () => ({ planRevenue: 0, planExpense: 0, actualRevenue: 0, actualExpense: 0 }))
    const rows = details.map((detail, index) => {
      const itemTotals = detailTotals(detail)
      for (let m = 1; m <= 12; m += 1) {
        month[m].planRevenue += itemTotals.planRevMo[m]
        month[m].planExpense += itemTotals.planExpMo[m]
        month[m].actualRevenue += itemTotals.actualRevMo[m]
        month[m].actualExpense += itemTotals.actualExpMo[m]
      }
      return `<tr>
        <td class="num">${index + 1}</td>
        <td><div class="title">${escapeHtml(detail.project.budget_filter || detail.project.code || detail.project.id)}</div><div>${escapeHtml(detail.project.project_name)}</div><div class="muted">${escapeHtml([detail.project.external_code, detail.project.project_type].filter(Boolean).join(' · '))}</div></td>
        <td class="num">${escapeHtml(money(itemTotals.planExpense))}</td>
        <td class="num">${escapeHtml(money(itemTotals.actualExpense))}</td>
        <td class="num ${itemTotals.remainingExpense < 0 ? 'bad' : 'good'}">${escapeHtml(money(itemTotals.remainingExpense))}</td>
        <td class="num">${escapeHtml(money(itemTotals.planRevenue))}</td>
        <td class="num good">${escapeHtml(money(itemTotals.actualRevenue))}</td>
        <td class="num ${itemTotals.actualNet < 0 ? 'bad' : 'good'}">${escapeHtml(money(itemTotals.actualNet))}</td>
      </tr>`
    }).join('')
    const monthRows = MONTHS_TH.map((name, index) => {
      const m = index + 1
      const item = month[m]
      const remaining = item.planExpense - item.actualExpense
      const net = item.actualRevenue - item.actualExpense
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td class="num">${escapeHtml(money(item.planExpense))}</td>
        <td class="num">${escapeHtml(money(item.actualExpense))}</td>
        <td class="num ${remaining < 0 ? 'bad' : 'good'}">${escapeHtml(money(remaining))}</td>
        <td class="num">${escapeHtml(money(item.planRevenue))}</td>
        <td class="num good">${escapeHtml(money(item.actualRevenue))}</td>
        <td class="num ${net < 0 ? 'bad' : 'good'}">${escapeHtml(money(net))}</td>
      </tr>`
    }).join('')
    const reportAt = new Date().toLocaleString('th-TH', { hour12: false })
    printBudgetHtml('รายงานงบประมาณภาพรวม', `<div class="sheet">
      <div class="hero"><div class="eyebrow">YEC TASK MANAGER</div><h1>รายงานงบประมาณภาพรวม</h1><div class="sub">สร้างเมื่อ ${escapeHtml(reportAt)} · ${details.length} โครงการ</div></div>
      <div class="kpis">
        <div class="kpi"><span>งบรายจ่ายแผน</span><b>${escapeHtml(money(totals.plannedExpense))}</b></div>
        <div class="kpi"><span>ใช้จริง</span><b>${escapeHtml(money(totals.actualExpense))}</b></div>
        <div class="kpi"><span>คงเหลือรายจ่าย</span><b class="${totals.remainingExpense < 0 ? 'bad' : 'good'}">${escapeHtml(money(totals.remainingExpense))}</b></div>
        <div class="kpi"><span>รับจริงสุทธิ</span><b class="${totals.actualNet < 0 ? 'bad' : 'good'}">${escapeHtml(money(totals.actualNet))}</b></div>
      </div>
      <div class="section"><table><thead><tr><th>#</th><th>โครงการ</th><th>รายจ่ายแผน</th><th>รายจ่ายจริง</th><th>คงเหลือ</th><th>รายรับแผน</th><th>รายรับจริง</th><th>สุทธิจริง</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="section"><table><thead><tr><th>เดือน</th><th>รายจ่ายแผน</th><th>รายจ่ายจริง</th><th>คงเหลือ</th><th>รายรับแผน</th><th>รายรับจริง</th><th>สุทธิจริง</th></tr></thead><tbody>${monthRows}</tbody></table></div>
      <div class="footer">รายงานนี้ดึงจากข้อมูลที่โหลดอยู่ในหน้าปัจจุบันและตัวกรองปัจจุบัน</div>
    </div>`)
  }

  const printProject = () => {
    if (!selectedDetail || !selectedProject) return
    const totalsForDetail = detailTotals(selectedDetail)
    const rowHtml = selectedDetail.rows.map(row => {
      const cells = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1
        const plan = Number(row.plan[month] ?? 0)
        const actual = Number(row.actual[month] ?? 0)
        const over = row.kind === 'expense' && actual > plan && plan > 0
        return `<td class="num cell2 ${over ? 'bad' : ''}"><span>แผน ${escapeHtml(plan ? money(plan) : '-')}</span><b>จริง ${escapeHtml(actual ? money(actual) : '-')}</b></td>`
      }).join('')
      return `<tr>
        <td><div class="title">${escapeHtml(row.code)}</div><div class="muted">${row.kind === 'revenue' ? 'รายรับ' : 'รายจ่าย'}</div><div>${escapeHtml(row.name)}</div></td>
        <td class="num cell2"><span>แผน ${escapeHtml(row.planTotal ? money(row.planTotal) : '-')}</span><b>จริง ${escapeHtml(row.actualTotal ? money(row.actualTotal) : '-')}</b></td>
        ${cells}
      </tr>`
    }).join('')
    const reportAt = new Date().toLocaleString('th-TH', { hour12: false })
    printBudgetHtml(selectedProject.project_name, `<div class="sheet">
      <div class="hero"><div class="eyebrow">BUDGET PROJECT</div><h1>${escapeHtml(selectedProject.budget_filter || selectedProject.code || selectedProject.id)} · ${escapeHtml(selectedProject.project_name)}</h1><div class="sub">รหัสงบ ${escapeHtml(selectedProject.department_code)} · ${escapeHtml([selectedProject.external_code, selectedProject.project_type, selectedProject.budget_category].filter(Boolean).join(' · '))} · สร้างเมื่อ ${escapeHtml(reportAt)}</div></div>
      <div class="kpis">
        <div class="kpi"><span>รายจ่าย แผน / จริง</span><b>${escapeHtml(money(totalsForDetail.planExpense))} / ${escapeHtml(money(totalsForDetail.actualExpense))}</b></div>
        <div class="kpi"><span>รายรับ แผน / จริง</span><b>${escapeHtml(money(totalsForDetail.planRevenue))} / ${escapeHtml(money(totalsForDetail.actualRevenue))}</b></div>
        <div class="kpi"><span>คงเหลือรายจ่าย</span><b class="${totalsForDetail.remainingExpense < 0 ? 'bad' : 'good'}">${escapeHtml(money(totalsForDetail.remainingExpense))}</b></div>
        <div class="kpi"><span>สุทธิจริง</span><b class="${totalsForDetail.actualNet < 0 ? 'bad' : 'good'}">${escapeHtml(money(totalsForDetail.actualNet))}</b></div>
      </div>
      <div class="section"><table><thead><tr><th style="width:150px">หมวด / รหัส</th><th>รวม</th>${MONTHS_TH.map(month => `<th>${escapeHtml(month)}</th>`).join('')}</tr></thead><tbody>${rowHtml || '<tr><td colspan="14" style="text-align:center;color:#94a3b8;padding:18px">ยังไม่มีรายละเอียดแผนหรือรายการจริง</td></tr>'}</tbody></table></div>
      <div class="footer">แต่ละช่องแสดง แผน / จริง เพื่อเทียบตามหมวดและเดือนของโครงการ</div>
    </div>`)
  }

  const metricCards = [
    { label: 'งบรายจ่ายแผน', value: totals.plannedExpense, color: '#0f172a', icon: '📋' },
    { label: 'ใช้จริง', value: totals.actualExpense, color: '#d97706', icon: '💸' },
    { label: 'คงเหลือรายจ่าย', value: totals.remainingExpense, color: totals.remainingExpense < 0 ? '#dc2626' : '#059669', icon: '💰' },
    { label: 'รับจริงสุทธิ', value: totals.actualNet, color: totals.actualNet < 0 ? '#dc2626' : '#059669', icon: '📈' },
  ]

  const tabDefs: { key: RightTab; label: string; icon: string }[] = [
    { key: 'overview', label: 'ภาพรวม', icon: '◈' },
    { key: 'transactions', label: 'รายการรับ/จ่าย', icon: '◎' },
    ...(canEdit ? [{ key: 'manage' as RightTab, label: 'จัดการแผน', icon: '⚙' }] : []),
  ]

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef2f8' }}>

      {/* ── TOP HEADER ── */}
      <div
        className="flex flex-col md:flex-row md:items-center"
        style={{
          gap: 12,
          padding: '12px 20px',
          background: 'linear-gradient(135deg, #1a2744 0%, #2d4a8a 100%)',
          flexShrink: 0,
          boxShadow: '0 2px 16px rgba(0,0,0,0.2)',
        }}
      >
        <div className="flex items-center" style={{ gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg, #c9a84c, #f0d878)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Anuphan, sans-serif', fontWeight: 900, fontSize: 18, color: '#1a2744',
          }}>B</div>
          <div>
            <div style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 17, color: '#fff', lineHeight: 1.2 }}>งบประมาณ</div>
            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
              {filteredProjects.length} จาก {projects.length} โครงการ
            </div>
          </div>
        </div>

        <div className="flex flex-wrap md:ml-auto" style={{ gap: 10, alignItems: 'center' }}>
          {/* Search — single, in header only */}
          <div className="w-full md:w-auto" style={{ position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.45)', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาโครงการ รหัส หรือประเภท..."
              className="w-full md:w-[280px]"
              style={{
                padding: '9px 14px 9px 34px', borderRadius: 12,
                border: '1.5px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.12)',
                color: '#fff', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5,
                outline: 'none', minWidth: 0,
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && (
              <button onClick={() => openProjectEditor()} style={headerButton('rgba(255,255,255,0.15)', '#fff', true)}>
                + โครงการ
              </button>
            )}
            <button onClick={exportOverviewCsv} style={headerButton('rgba(255,255,255,0.1)', 'rgba(255,255,255,0.75)')}>
              CSV
            </button>
            <button onClick={printOverview} style={headerButton('#c9a84c', '#1a2744')}>
              พิมพ์ PDF
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI STRIP ── */}
      <div className="grid grid-cols-2 md:flex" style={{ gap: 10, padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e4e8f2', flexShrink: 0 }}>
        {metricCards.map(card => (
          <div key={card.label} className="md:flex-1" style={{
            borderRadius: 14, background: '#f8fafc', padding: '10px 14px',
            border: '1px solid #e4eaf5',
            display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
          }}>
            <span style={{ fontSize: 22 }}>{card.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>{card.label}</div>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 16, fontWeight: 900, color: card.color, marginTop: 1, whiteSpace: 'nowrap' }}>
                {compactMoney(card.value)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── FILTER BAR ── always visible, clean row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
        padding: '8px 16px', background: '#fff',
        borderBottom: '1px solid #e4e8f2', flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>กรองโดย:</span>
        <select
          value={budgetFilter}
          onChange={e => setBudgetFilter(e.target.value)}
          style={{ height: 36, paddingLeft: 10, paddingRight: 28, borderRadius: 10, border: '1.5px solid #dbe4f0', background: '#f8fafc', fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#1e293b', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">ทุกรหัสงบ</option>
          {budgetFilters.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{ height: 36, paddingLeft: 10, paddingRight: 28, borderRadius: 10, border: '1.5px solid #dbe4f0', background: '#f8fafc', fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#1e293b', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">ทุกประเภทโครงการ</option>
          {projectTypes.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        {(budgetFilter || typeFilter || search) && (
          <button
            onClick={() => { setSearch(''); setBudgetFilter(''); setTypeFilter('') }}
            style={{ height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, cursor: 'pointer', fontWeight: 700 }}
          >
            ล้างตัวกรอง ×
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#94a3b8' }}>
          แสดง {filteredProjects.length} จาก {projects.length} โครงการ
        </span>
      </div>

      {/* ── ERROR / LOADING ── */}
      {error && (
        <div style={{ margin: '8px 16px 0', padding: '10px 14px', borderRadius: 12, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, border: '1px solid #fed7aa', flexShrink: 0 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', color: '#94a3b8', fontSize: 15 }}>
          กำลังโหลดงบประมาณ...
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      {!loading && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#f5f8fc' }}>

          {/* ── PROJECT GRID (full-width) ── */}
          <div style={{ background: '#f5f8fc', padding: '8px 16px 20px' }}>
            {projectsByDepartment.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif' }}>ไม่พบโครงการ</div>
            )}
            {projectsByDepartment.map(([dept, deptProjects]) => (
              <div key={dept} style={{ marginBottom: 8 }}>
                {/* Department header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 4px 8px',
                }}>
                  <div style={{
                    fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, fontWeight: 900,
                    color: '#1a2744', textTransform: 'uppercase', letterSpacing: 0.8,
                  }}>{dept}</div>
                  <div style={{ flex: 1, height: 1, background: '#d1dae9' }} />
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#94a3b8' }}>{deptProjects.length}</div>
                </div>
                {/* Project cards */}
                <div style={{ padding: '0 4px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {deptProjects.map(project => {
                    const over = project.usedPct > 100
                    return (
                      <button
                        key={project.id}
                        onClick={() => setSelectedProjectId(project.id)}
                        style={{
                          width: '100%', display: 'block', textAlign: 'left',
                          border: `1.5px solid ${over ? '#fecaca' : '#e2e8f0'}`,
                          borderRadius: 16,
                          padding: '14px 16px',
                          background: '#fff',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          outline: 'none',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.boxShadow = '0 6px 20px rgba(26,39,68,0.15)'
                          e.currentTarget.style.borderColor = over ? '#f87171' : '#93c5fd'
                          e.currentTarget.style.transform = 'translateY(-2px)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)'
                          e.currentTarget.style.borderColor = over ? '#fecaca' : '#e2e8f0'
                          e.currentTarget.style.transform = 'translateY(0)'
                        }}
                      >
                        {/* Top accent bar */}
                        <div style={{
                          height: 3, borderRadius: 99, marginBottom: 12,
                          background: over
                            ? 'linear-gradient(90deg, #ef4444, #f97316)'
                            : project.usedPct > 70
                              ? 'linear-gradient(90deg, #f59e0b, #10b981)'
                              : 'linear-gradient(90deg, #3b82f6, #10b981)',
                        }} />

                        {/* Project name + usage % */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{
                            fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 700,
                            color: '#0f172a', lineHeight: 1.4,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {project.project_name}
                          </div>
                          <div style={{
                            flexShrink: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 900,
                            color: over ? '#dc2626' : '#047857',
                            background: over ? '#fef2f2' : '#f0fdf4',
                            border: `1px solid ${over ? '#fca5a5' : '#bbf7d0'}`,
                            padding: '2px 8px', borderRadius: 20,
                          }}>
                            {project.usedPct}%
                          </div>
                        </div>

                        {/* Sub info */}
                        {project.budget_filter && (
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                            {project.budget_filter}
                          </div>
                        )}

                        {/* Progress bar */}
                        <div style={{ marginTop: 10, height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(project.usedPct, 100)}%`,
                            height: '100%',
                            background: over
                              ? 'linear-gradient(90deg, #ef4444, #f97316)'
                              : project.usedPct > 70
                                ? 'linear-gradient(90deg, #f59e0b, #10b981)'
                                : 'linear-gradient(90deg, #3b82f6, #10b981)',
                            borderRadius: 999,
                            transition: 'width 0.3s',
                          }} />
                        </div>

                        {/* Divider */}
                        <div style={{ height: 1, background: '#f1f5f9', margin: '12px 0 10px' }} />

                        {/* Mini stats */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                          {[
                            { label: 'แผน', value: project.planned_expense, textColor: '#475569' },
                            { label: 'จริง', value: project.actualExpense, textColor: project.actualExpense > 0 ? '#dc2626' : '#64748b' },
                            { label: 'คงเหลือ', value: project.remainingExpense, textColor: project.remainingExpense < 0 ? '#dc2626' : '#059669' },
                          ].map(stat => (
                            <div key={stat.label} style={{ padding: '6px 8px', borderRadius: 8, background: '#f8fafc' }}>
                              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
                                {stat.label}
                              </div>
                              <div style={{
                                fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 800,
                                color: stat.textColor,
                              }}>
                                {new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number(stat.value ?? 0))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ── PROJECT DETAIL MODAL ── */}
      {!loading && selectedProject && (
        <div
          onClick={() => setSelectedProjectId(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(15,23,42,0.52)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            ref={rightPanelRef}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 1100, maxHeight: '92vh',
              borderRadius: 20, background: '#f5f8fc',
              boxShadow: '0 24px 80px rgba(0,0,0,0.32)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
                {/* Project Header Bar */}
                <div style={{
                  padding: '12px 18px',
                  background: '#fff',
                  borderBottom: '1px solid #dde4ef',
                  flexShrink: 0,
                  borderRadius: '20px 20px 0 0',
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 16, fontWeight: 800, color: '#1e293b', lineHeight: 1.35 }}>
                        {selectedProject.project_name}
                      </h2>
                      <p style={{ margin: '3px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b' }}>
                        {[selectedProject.department_code, selectedProject.budget_filter, selectedProject.project_type].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                      <span style={{
                        borderRadius: 999, padding: '5px 10px',
                        background: selectedProject.usedPct > 100 ? '#fef2f2' : '#ecfdf5',
                        color: selectedProject.usedPct > 100 ? '#b91c1c' : '#047857',
                        fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 900,
                      }}>
                        {selectedProject.usedPct}% ใช้งบ
                      </span>
                      {canEdit && <button onClick={() => openProjectEditor(selectedProject)} style={smallButton('#f1f5f9', '#334155')}>แก้ไข</button>}
                      <button onClick={exportProjectCsv} style={smallButton('#f1f5f9', '#334155')}>CSV</button>
                      <button onClick={printProject} style={smallButton('#eff6ff', '#1d4ed8')}>PDF</button>
                      <button
                        onClick={() => setSelectedProjectId(null)}
                        style={{
                          width: 32, height: 32, borderRadius: 10, border: 'none',
                          background: '#f1f5f9', color: '#64748b', cursor: 'pointer',
                          fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        title="ปิด"
                      >×</button>
                    </div>
                  </div>
                </div>

                {/* Tab Bar */}
                <div style={{ display: 'flex', gap: 0, background: '#fff', borderBottom: '2px solid #e4e8f2', flexShrink: 0, overflowX: 'auto' }}>
                  {tabDefs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setRightTab(tab.key)}
                      style={{
                        border: 'none', background: 'none', cursor: 'pointer',
                        padding: '11px 18px', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: rightTab === tab.key ? 800 : 500,
                        color: rightTab === tab.key ? '#1a2744' : '#64748b',
                        borderBottom: rightTab === tab.key ? '2.5px solid #1a2744' : '2.5px solid transparent',
                        marginBottom: -2,
                        display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, whiteSpace: 'nowrap',
                        transition: 'color 0.15s',
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{tab.icon}</span>
                      {tab.label}
                      {tab.key === 'transactions' && selectedTransactions.length > 0 && (
                        <span style={{ background: '#e0e7f3', color: '#1a2744', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>
                          {selectedTransactions.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>

                  {/* ── TAB: OVERVIEW ── */}
                  {rightTab === 'overview' && (
                    <div style={{ padding: panelWidth > 700 ? 20 : 14, display: 'grid', gap: 14 }}>
                      {/* Key metrics — 4-col on wide, 2-col on narrow */}
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${panelWidth > 700 ? 4 : 2}, 1fr)`, gap: 10 }}>
                        {[
                          { label: 'รับจริง', value: money(selectedProject.actualRevenue), color: '#047857', bg: '#f0fdf4' },
                          { label: 'จ่ายจริง', value: money(selectedProject.actualExpense), color: '#b45309', bg: '#fffbeb' },
                          { label: 'คงเหลือรายจ่าย', value: money(selectedProject.remainingExpense), color: selectedProject.remainingExpense < 0 ? '#b91c1c' : '#047857', bg: selectedProject.remainingExpense < 0 ? '#fef2f2' : '#f0fdf4' },
                          { label: 'สุทธิจริง', value: money(selectedProject.actualNet), color: selectedProject.actualNet < 0 ? '#b91c1c' : '#047857', bg: selectedProject.actualNet < 0 ? '#fef2f2' : '#f0fdf4' },
                        ].map(m => (
                          <div key={m.label} style={{ borderRadius: 14, background: m.bg, padding: panelWidth > 700 ? '14px 16px' : '11px 12px', border: '1px solid #e4eaf5' }}>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#64748b', fontWeight: 700 }}>{m.label}</div>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: panelWidth > 700 ? 20 : 17, fontWeight: 900, color: m.color, marginTop: 4 }}>{m.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Plan/actual + monthly table — side-by-side on wide */}
                      <div style={{ display: 'grid', gridTemplateColumns: panelWidth > 800 ? '1fr 1fr' : '1fr', gap: 14 }}>

                        {/* Plan vs Actual summary */}
                        <div style={{ borderRadius: 14, background: '#fff', border: '1px solid #e4eaf5', overflow: 'hidden' }}>
                          <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2',
                          }}>
                            <div>
                              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 800, color: '#1e293b' }}>แผน / จริง รายหมวด</div>
                              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8', marginTop: 1 }}>เปิดตารางเต็มเพื่อดูรายเดือน</div>
                            </div>
                            <button onClick={() => setDetailPopupOpen(true)} style={smallButton('#1a2744', '#fff')}>
                              ตารางเต็ม ↗
                            </button>
                          </div>
                          <div style={{ padding: '12px 16px', display: 'grid', gap: 10 }}>
                            {[
                              { label: 'รายรับ', plan: selectedDetailTotals.planRevenue, actual: selectedDetailTotals.actualRevenue, isRevenue: true },
                              { label: 'รายจ่าย', plan: selectedDetailTotals.planExpense, actual: selectedDetailTotals.actualExpense, isRevenue: false },
                            ].map(row => {
                              const pct = row.plan > 0 ? Math.min(100, Math.round(row.actual * 100 / row.plan)) : 0
                              const over = !row.isRevenue && row.actual > row.plan && row.plan > 0
                              return (
                                <div key={row.label}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>{row.label}</span>
                                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 900, color: over ? '#dc2626' : '#059669' }}>{pct}%</span>
                                  </div>
                                  <div style={{ height: 9, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                                    <div style={{ width: `${pct}%`, height: '100%', background: over ? '#ef4444' : (row.isRevenue ? '#10b981' : '#3b82f6'), borderRadius: 999 }} />
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8' }}>แผน {compactMoney(row.plan)}</span>
                                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: over ? '#dc2626' : '#059669', fontWeight: 700 }}>จริง {compactMoney(row.actual)}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Monthly plan summary */}
                        <div style={{ borderRadius: 14, background: '#fff', border: '1px solid #e4eaf5', overflow: 'hidden' }}>
                          <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2' }}>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 800, color: '#1e293b' }}>สรุปรายเดือน (รายจ่าย)</div>
                          </div>
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Anuphan, sans-serif', fontSize: panelWidth > 800 ? 11 : 12 }}>
                              <thead>
                                <tr style={{ background: '#f1f5f9' }}>
                                  <th style={{ padding: '7px 10px', textAlign: 'left', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid #e4e8f2' }}>ประเภท</th>
                                  {MONTHS_TH.map(m => (
                                    <th key={m} style={{ padding: '7px 5px', textAlign: 'center', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid #e4e8f2' }}>{m}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  { label: 'แผน', values: selectedDetailTotals.planExpMo, color: '#374151', fw: 400 },
                                  { label: 'จริง', values: selectedDetailTotals.actualExpMo, color: '#1d4ed8', fw: 700 },
                                ].map(row => (
                                  <tr key={row.label}>
                                    <td style={{ padding: '7px 10px', color: '#64748b', fontWeight: 700, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{row.label}</td>
                                    {MONTHS_TH.map((_, i) => {
                                      const m = i + 1
                                      const val = row.values[m] ?? 0
                                      const planVal = selectedDetailTotals.planExpMo[m] ?? 0
                                      const over = row.label === 'จริง' && val > planVal && planVal > 0
                                      return (
                                        <td key={m} style={{ padding: '7px 5px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', color: over ? '#dc2626' : row.color, fontWeight: over ? 900 : row.fw, whiteSpace: 'nowrap' }}>
                                          {val ? new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(val) : '—'}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── TAB: TRANSACTIONS ── */}
                  {rightTab === 'transactions' && (
                    <div style={{
                      padding: panelWidth > 700 ? 20 : 14,
                      display: 'grid',
                      // Wide: form left + list right. Narrow: stacked.
                      gridTemplateColumns: canEdit && panelWidth > 760 ? '360px 1fr' : '1fr',
                      gap: 14,
                      alignItems: 'start',
                    }}>
                      {/* Transaction Entry Form */}
                      {canEdit && (
                        <div style={{ borderRadius: 14, background: '#fff', border: '1px solid #e4eaf5', overflow: 'hidden' }}>
                          <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2' }}>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800, color: '#1e293b' }}>บันทึกรายการจริง</div>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8', marginTop: 1 }}>แนบใบเสร็จเพื่อให้ระบบอ่านตัวเลขอัตโนมัติ</div>
                          </div>
                          <div style={{ padding: 14 }}>

                            {/* ── Receipt drop zone ── */}
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f) }}
                            />
                            <div
                              onClick={() => fileInputRef.current?.click()}
                              onDragOver={e => e.preventDefault()}
                              onDrop={e => {
                                e.preventDefault()
                                const f = e.dataTransfer.files?.[0]
                                if (f) handleReceiptFile(f)
                              }}
                              style={{
                                marginBottom: 12, borderRadius: 14,
                                border: receiptFile ? '2px solid #10b981' : '2px dashed #c7d2e6',
                                background: receiptFile ? '#f0fdf4' : '#f8fafc',
                                cursor: 'pointer', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: receiptPreview ? 10 : '14px 16px',
                                minHeight: 64,
                              }}
                            >
                              {/* Thumbnail */}
                              {receiptPreview && (
                                <div style={{ position: 'relative', flexShrink: 0 }}>
                                  <img
                                    src={receiptPreview}
                                    alt="receipt"
                                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid #d1fae5' }}
                                  />
                                  {ocrLoading && (
                                    <div style={{
                                      position: 'absolute', inset: 0, borderRadius: 10,
                                      background: 'rgba(255,255,255,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                      <span style={{ fontSize: 20 }}>⏳</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Status text */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {ocrLoading ? (
                                  <div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 700, color: '#047857' }}>กำลังอ่านใบเสร็จ...</div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#6b7280', marginTop: 2 }}>AI กำลังดึงข้อมูลยอดเงิน วันที่ และผู้ขาย</div>
                                  </div>
                                ) : receiptFile ? (
                                  <div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 700, color: '#047857' }}>
                                      {ocrFields.size > 0 ? `✓ อ่านสำเร็จ — กรอก ${ocrFields.size} ช่องอัตโนมัติ` : '✓ แนบไฟล์แล้ว'}
                                    </div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#6b7280', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {receiptFile.name} · {(receiptFile.size / 1024).toFixed(0)} KB
                                    </div>
                                    {ocrError && (
                                      <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#dc2626', marginTop: 2 }}>⚠ {ocrError}</div>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 700, color: '#1e293b' }}>
                                      📎 แนบใบเสร็จ / ใบแจ้งหนี้
                                    </div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                      คลิกหรือลากไฟล์มาวาง · JPG, PNG, PDF · ไม่เกิน 10 MB
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Clear button */}
                              {receiptFile && !ocrLoading && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation()
                                    setReceiptFile(null)
                                    setReceiptPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
                                    setOcrFields(new Set())
                                    setOcrError(null)
                                    if (fileInputRef.current) fileInputRef.current.value = ''
                                  }}
                                  style={{ border: 'none', background: '#fef2f2', color: '#dc2626', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontWeight: 700, fontSize: 14, flexShrink: 0 }}
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            {/* ── Form fields ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <select
                                value={form.accounting_code}
                                onChange={e => setForm(prev => ({ ...prev, accounting_code: e.target.value }))}
                                style={{ ...formField('1 / -1'), minHeight: 42 }}
                              >
                                <option value="">เลือกหมวดงบประมาณ</option>
                                {revenueCategories.length > 0 && <option disabled>── รายรับ ──</option>}
                                {revenueCategories.map(cat => <option key={cat.id} value={cat.accounting_code}>{cat.accounting_code} {cat.name}</option>)}
                                {expenseCategories.length > 0 && <option disabled>── รายจ่าย ──</option>}
                                {expenseCategories.map(cat => <option key={cat.id} value={cat.accounting_code}>{cat.accounting_code} {cat.name}</option>)}
                              </select>

                              {/* Date — highlight if OCR-filled */}
                              <OcrField filled={ocrFields.has('transaction_date')}>
                                <input
                                  type="date"
                                  value={form.transaction_date}
                                  onChange={e => { setForm(prev => ({ ...prev, transaction_date: e.target.value })); setOcrFields(prev => { const n = new Set(prev); n.delete('transaction_date'); return n }) }}
                                  style={{ ...formField(), minHeight: 42, width: '100%', background: ocrFields.has('transaction_date') ? '#f0fdf4' : '#fff', borderColor: ocrFields.has('transaction_date') ? '#6ee7b7' : undefined }}
                                />
                              </OcrField>

                              {/* Amount — highlight if OCR-filled */}
                              <OcrField filled={ocrFields.has('amount')}>
                                <input
                                  value={form.amount}
                                  onChange={e => { setForm(prev => ({ ...prev, amount: e.target.value })); setOcrFields(prev => { const n = new Set(prev); n.delete('amount'); return n }) }}
                                  inputMode="decimal"
                                  placeholder="จำนวนเงิน (บาท)"
                                  style={{ ...formField(), minHeight: 42, width: '100%', background: ocrFields.has('amount') ? '#f0fdf4' : '#fff', borderColor: ocrFields.has('amount') ? '#6ee7b7' : undefined }}
                                />
                              </OcrField>

                              {/* Vendor — highlight if OCR-filled */}
                              <OcrField filled={ocrFields.has('vendor')} gridColumn="1 / -1">
                                <input
                                  value={form.vendor}
                                  onChange={e => { setForm(prev => ({ ...prev, vendor: e.target.value })); setOcrFields(prev => { const n = new Set(prev); n.delete('vendor'); return n }) }}
                                  placeholder="ผู้ขาย / ผู้รับเงิน / แหล่งรายได้"
                                  style={{ ...formField('1 / -1'), minHeight: 42, width: '100%', background: ocrFields.has('vendor') ? '#f0fdf4' : '#fff', borderColor: ocrFields.has('vendor') ? '#6ee7b7' : undefined }}
                                />
                              </OcrField>

                              {/* Description — highlight if OCR-filled */}
                              <OcrField filled={ocrFields.has('description')} gridColumn="1 / -1">
                                <input
                                  value={form.description}
                                  onChange={e => { setForm(prev => ({ ...prev, description: e.target.value })); setOcrFields(prev => { const n = new Set(prev); n.delete('description'); return n }) }}
                                  placeholder="รายละเอียด"
                                  style={{ ...formField('1 / -1'), minHeight: 42, width: '100%', background: ocrFields.has('description') ? '#f0fdf4' : '#fff', borderColor: ocrFields.has('description') ? '#6ee7b7' : undefined }}
                                />
                              </OcrField>

                              {/* Manual URL (only if no file attached) */}
                              {!receiptFile && (
                                <input
                                  value={form.receipt_url}
                                  onChange={e => setForm(prev => ({ ...prev, receipt_url: e.target.value }))}
                                  placeholder="หรือวางลิงก์ใบเสร็จ (ถ้ามี)"
                                  style={{ ...formField('1 / -1'), minHeight: 42 }}
                                />
                              )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                              <button
                                disabled={saving || ocrLoading}
                                onClick={createTransaction}
                                style={{
                                  border: 'none', borderRadius: 12, padding: '10px 24px',
                                  background: saving || ocrLoading ? '#94a3b8' : '#1a2744', color: '#fff',
                                  cursor: saving || ocrLoading ? 'default' : 'pointer',
                                  fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 14,
                                }}
                              >
                                {saving ? 'กำลังบันทึก...' : ocrLoading ? 'รออ่านใบเสร็จก่อน...' : '✓ บันทึกรายการ'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Transaction List */}
                      <div style={{ borderRadius: 14, background: '#fff', border: '1px solid #e4eaf5', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2' }}>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800, color: '#1e293b' }}>รายการล่าสุด</div>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#94a3b8' }}>{selectedTransactions.length} รายการ</div>
                        </div>
                        {selectedTransactions.length === 0 ? (
                          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }}>
                            ยังไม่มีรายการรับ/จ่าย
                          </div>
                        ) : (
                          <div>
                            {selectedTransactions.slice(0, 50).map(tx => {
                              const category = categoryByCode[tx.accounting_code]
                              return (
                                <div key={tx.id} style={{
                                  display: 'grid', gridTemplateColumns: '90px 1fr auto auto',
                                  gap: 10, alignItems: 'center',
                                  padding: '11px 16px', borderBottom: '1px solid #f1f5f9',
                                }}>
                                  <div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8' }}>{tx.transaction_date}</div>
                                    <div style={{
                                      marginTop: 2, display: 'inline-block', padding: '1px 7px',
                                      borderRadius: 999, fontSize: 10.5, fontWeight: 700, fontFamily: 'Anuphan, sans-serif',
                                      background: tx.kind === 'revenue' ? '#f0fdf4' : '#fff7ed',
                                      color: tx.kind === 'revenue' ? '#047857' : '#b45309',
                                    }}>
                                      {tx.kind === 'revenue' ? 'รายรับ' : 'รายจ่าย'}
                                    </div>
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#1e293b', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {tx.description || category?.name || tx.accounting_code}
                                    </div>
                                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {[tx.vendor, tx.accounting_code].filter(Boolean).join(' · ')}
                                    </div>
                                  </div>
                                  <div style={{
                                    fontFamily: 'Anuphan, sans-serif', fontWeight: 900, fontSize: 14,
                                    color: tx.kind === 'revenue' ? '#047857' : '#b45309',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {tx.kind === 'revenue' ? '+' : '-'}{money(tx.amount)}
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {tx.receipt_url && (
                                      <a href={tx.receipt_url} target="_blank" rel="noreferrer" style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#1d4ed8', whiteSpace: 'nowrap' }}>
                                        ดูไฟล์
                                      </a>
                                    )}
                                    {canEdit && (
                                      <button
                                        onClick={() => deleteTransaction(tx)}
                                        style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
                                        title="ลบรายการ"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── TAB: MANAGE (canEdit only) ── */}
                  {rightTab === 'manage' && canEdit && (
                    <div style={{
                      padding: panelWidth > 700 ? 20 : 14,
                      display: 'grid',
                      gridTemplateColumns: panelWidth > 760 ? '1fr 1fr' : '1fr',
                      gap: 14,
                      alignItems: 'start',
                    }}>
                      {/* Category Management */}
                      <div style={{ borderRadius: 14, background: '#fff', border: '1px solid #e4eaf5', overflow: 'hidden' }}>
                        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2' }}>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800, color: '#1e293b' }}>จัดการหมวดงบประมาณ</div>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8', marginTop: 1 }}>เพิ่มหรือแก้ไขหมวดงบประมาณ (ใช้ร่วมกันทุกโครงการ)</div>
                        </div>
                        <div style={{ padding: 14 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
                            <input
                              value={categoryForm.accounting_code}
                              onChange={e => setCategoryForm(prev => ({ ...prev, accounting_code: e.target.value }))}
                              placeholder="รหัสบัญชี"
                              style={{ ...formField(), minHeight: 42 }}
                            />
                            <input
                              value={categoryForm.name}
                              onChange={e => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="ชื่อหมวดงบประมาณ"
                              style={{ ...formField(), minHeight: 42 }}
                            />
                            <select
                              value={categoryForm.kind}
                              onChange={e => setCategoryForm(prev => ({ ...prev, kind: e.target.value as 'revenue' | 'expense' }))}
                              style={{ ...formField(), minHeight: 42 }}
                            >
                              <option value="expense">รายจ่าย</option>
                              <option value="revenue">รายรับ</option>
                            </select>
                            <button
                              disabled={saving}
                              onClick={saveCategory}
                              style={{ ...smallButton(saving ? '#94a3b8' : '#f1f5f9', saving ? '#fff' : '#334155'), minHeight: 42 }}
                            >
                              เพิ่ม / แก้ไขหมวด
                            </button>
                          </div>
                          {/* Existing categories preview */}
                          {categories.length > 0 && (
                            <div style={{ marginTop: 12, maxHeight: 160, overflow: 'auto', borderRadius: 10, border: '1px solid #e4e8f2' }}>
                              {categories.map(cat => (
                                <div
                                  key={cat.id}
                                  onClick={() => setCategoryForm({ accounting_code: cat.accounting_code, name: cat.name, kind: cat.kind })}
                                  style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '7px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                                  }}
                                >
                                  <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#1e293b' }}>{cat.accounting_code} – {cat.name}</span>
                                  <span style={{
                                    fontFamily: 'Anuphan, sans-serif', fontSize: 11, padding: '1px 8px', borderRadius: 999,
                                    background: cat.kind === 'revenue' ? '#f0fdf4' : '#fff7ed',
                                    color: cat.kind === 'revenue' ? '#047857' : '#b45309',
                                    fontWeight: 700,
                                  }}>
                                    {cat.kind === 'revenue' ? 'รายรับ' : 'รายจ่าย'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Monthly Plan Editor */}
                      <div style={{ borderRadius: 14, background: '#fff', border: '1px solid #e4eaf5', overflow: 'hidden' }}>
                        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2' }}>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800, color: '#1e293b' }}>แผนรายเดือน</div>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8', marginTop: 1 }}>กำหนดแผนงบประมาณแต่ละเดือนสำหรับ: {selectedProject.project_name}</div>
                        </div>
                        <div style={{ padding: 14 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 14 }}>
                            <select
                              value={planCategoryCode}
                              onChange={e => loadPlanEditor(e.target.value)}
                              style={{ ...formField(), minHeight: 42 }}
                            >
                              <option value="">เลือกหมวดสำหรับแผนรายเดือน</option>
                              {categories.map(cat => <option key={cat.id} value={cat.accounting_code}>{cat.accounting_code} {cat.name} ({cat.kind === 'revenue' ? 'รายรับ' : 'รายจ่าย'})</option>)}
                            </select>
                            <button
                              disabled={saving || !planCategoryCode}
                              onClick={saveMonthlyPlan}
                              style={{
                                ...smallButton(planCategoryCode && !saving ? '#1a2744' : '#cbd5e1', '#fff'),
                                minHeight: 42, padding: '0 16px',
                                cursor: planCategoryCode && !saving ? 'pointer' : 'default',
                              }}
                            >
                              {saving ? 'บันทึก...' : '✓ บันทึกแผน'}
                            </button>
                          </div>
                          {planCategoryCode ? (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${panelWidth > 760 ? 3 : 4}, 1fr)`, gap: 8 }}>
                              {planAmounts.map((amount, index) => (
                                <label key={index} style={{ display: 'grid', gap: 4 }}>
                                  <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#64748b', fontWeight: 700 }}>{MONTHS_TH[index]}</span>
                                  <input
                                    value={amount}
                                    onChange={e => setPlanAmounts(prev => prev.map((item, i) => i === index ? e.target.value : item))}
                                    inputMode="decimal"
                                    placeholder="0"
                                    style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#0f172a', background: '#f8fafc', outline: 'none', boxSizing: 'border-box' }}
                                  />
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13, background: '#f8fafc', borderRadius: 10 }}>
                              เลือกหมวดงบประมาณเพื่อกำหนดแผนรายเดือน
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {rightTab === 'manage' && !canEdit && (
                    <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif' }}>
                      คุณไม่มีสิทธิ์จัดการแผนงบประมาณ
                    </div>
                  )}

                </div>
          </div>
        </div>
      )}

      {/* ── DETAIL POPUP MODAL ── */}
      {detailPopupOpen && selectedDetail && selectedProject && (
        <div
          onClick={() => setDetailPopupOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 1100, maxHeight: '90vh',
              borderRadius: 20, background: '#fff',
              boxShadow: '0 28px 80px rgba(0,0,0,0.28)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Popup header */}
            <div style={{ height: 4, background: 'linear-gradient(90deg, #1a2744, #2d4a8a, #c9a84c)', flexShrink: 0 }} />
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', borderBottom: '1px solid #e4e8f2', flexShrink: 0,
            }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 16, fontWeight: 800, color: '#1e293b' }}>
                  {selectedProject.project_name}
                </h2>
                <p style={{ margin: '3px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b' }}>
                  {[selectedProject.department_code, selectedProject.budget_filter, selectedProject.project_type].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {/* Mode toggle */}
                <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', borderRadius: 10, padding: 3 }}>
                  {([
                    { key: 'compare', label: 'เทียบ' },
                    { key: 'plan', label: 'แผน' },
                    { key: 'actual', label: 'จริง' },
                  ] as { key: DetailMode; label: string }[]).map(m => (
                    <button
                      key={m.key}
                      onClick={() => setDetailMode(m.key)}
                      style={{
                        border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
                        fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700,
                        background: detailMode === m.key ? '#1a2744' : 'transparent',
                        color: detailMode === m.key ? '#fff' : '#64748b',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={exportProjectCsv}
                  style={smallButton('#f1f5f9', '#334155')}
                >
                  CSV
                </button>
                <button
                  onClick={printProject}
                  style={smallButton('#eff6ff', '#1d4ed8')}
                >
                  PDF
                </button>
                <button
                  onClick={() => setDetailPopupOpen(false)}
                  style={{
                    width: 34, height: 34, borderRadius: 10, border: 'none',
                    background: '#f1f5f9', color: '#64748b', cursor: 'pointer',
                    fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* KPI row in popup */}
            <div style={{ display: 'flex', gap: 10, padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2', flexShrink: 0 }}>
              {[
                { label: 'รายจ่าย แผน/จริง', value: `${money(selectedDetailTotals.planExpense)} / ${money(selectedDetailTotals.actualExpense)}`, color: '#b45309' },
                { label: 'รายรับ แผน/จริง', value: `${money(selectedDetailTotals.planRevenue)} / ${money(selectedDetailTotals.actualRevenue)}`, color: '#047857' },
                { label: 'คงเหลือรายจ่าย', value: money(selectedDetailTotals.remainingExpense), color: selectedDetailTotals.remainingExpense < 0 ? '#dc2626' : '#047857' },
                { label: 'สุทธิจริง', value: money(selectedDetailTotals.actualNet), color: selectedDetailTotals.actualNet < 0 ? '#dc2626' : '#047857' },
              ].map(m => (
                <div key={m.label} style={{ flex: 1, borderRadius: 10, background: '#fff', border: '1px solid #e4e8f2', padding: '8px 12px' }}>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>{m.label}</div>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 900, color: m.color, marginTop: 2 }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Detail Table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: '#1a2744' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: '#c9a84c', fontWeight: 800, whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.1)' }}>หมวด / รหัส</th>
                    <th style={{ padding: '10px 10px', textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontWeight: 700, whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.1)' }}>แผน / จริง</th>
                    <th style={{ padding: '10px 10px', textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontWeight: 700, whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.1)' }}>ส่วนต่าง</th>
                    {visibleDetailMonths.map(m => (
                      <th key={m} style={{ padding: '10px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontWeight: 700, whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.07)', minWidth: detailMode === 'compare' ? 80 : 60 }}>
                        {MONTHS_TH[m - 1]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedDetail.rows.length === 0 ? (
                    <tr>
                      <td colSpan={3 + visibleDetailMonths.length} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                        ยังไม่มีรายละเอียดแผนหรือรายการจริง
                      </td>
                    </tr>
                  ) : (
                    <>
                      {/* Group separator for revenue */}
                      {selectedDetail.rows.some(r => r.kind === 'revenue') && (
                        <tr style={{ background: '#f0fdf4' }}>
                          <td colSpan={3 + visibleDetailMonths.length} style={{ padding: '6px 14px', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, fontWeight: 900, color: '#047857', letterSpacing: 0.5 }}>
                            ── รายรับ ──
                          </td>
                        </tr>
                      )}
                      {selectedDetail.rows.filter(r => r.kind === 'revenue').map(row => (
                        <DetailTableRow key={`${row.kind}|${row.code}`} row={row} months={visibleDetailMonths} mode={detailMode} />
                      ))}
                      {/* Group separator for expense */}
                      {selectedDetail.rows.some(r => r.kind === 'expense') && (
                        <tr style={{ background: '#fff7ed' }}>
                          <td colSpan={3 + visibleDetailMonths.length} style={{ padding: '6px 14px', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, fontWeight: 900, color: '#b45309', letterSpacing: 0.5 }}>
                            ── รายจ่าย ──
                          </td>
                        </tr>
                      )}
                      {selectedDetail.rows.filter(r => r.kind === 'expense').map(row => (
                        <DetailTableRow key={`${row.kind}|${row.code}`} row={row} months={visibleDetailMonths} mode={detailMode} />
                      ))}
                      {/* Total row */}
                      <tr style={{ background: '#f1f5f9', borderTop: '2px solid #dde4ef' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'Anuphan, sans-serif', fontWeight: 900, color: '#1e293b' }}>รวมทั้งหมด</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', borderRight: '1px solid #e4e8f2', whiteSpace: 'nowrap' }}>
                          {detailMode !== 'actual' && <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#64748b' }}>{money(selectedDetailTotals.planExpense + selectedDetailTotals.planRevenue)}</div>}
                          {detailMode !== 'plan' && <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 900, color: '#1e293b' }}>{money(selectedDetailTotals.actualExpense + selectedDetailTotals.actualRevenue)}</div>}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', borderRight: '1px solid #e4e8f2', fontFamily: 'Anuphan, sans-serif', fontWeight: 900, color: selectedDetailTotals.remainingExpense < 0 ? '#dc2626' : '#059669', whiteSpace: 'nowrap' }}>
                          {money((selectedDetailTotals.planExpense + selectedDetailTotals.planRevenue) - (selectedDetailTotals.actualExpense + selectedDetailTotals.actualRevenue))}
                        </td>
                        {visibleDetailMonths.map(m => {
                          const planSum = (selectedDetailTotals.planRevMo[m] ?? 0) + (selectedDetailTotals.planExpMo[m] ?? 0)
                          const actualSum = (selectedDetailTotals.actualRevMo[m] ?? 0) + (selectedDetailTotals.actualExpMo[m] ?? 0)
                          return (
                            <td key={m} style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 800, color: '#374151', whiteSpace: 'nowrap', borderLeft: '1px solid #e4e8f2' }}>
                              {detailMode !== 'actual' && planSum > 0 && (
                                <div style={{ color: '#64748b', fontSize: 11 }}>{new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(planSum)}</div>
                              )}
                              {detailMode !== 'plan' && actualSum > 0 && (
                                <div style={{ color: '#1e293b', fontSize: 11.5, fontWeight: 900 }}>{new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(actualSum)}</div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── PROJECT EDITOR MODAL ── */}
      {projectEditorOpen && (
        <div
          onClick={closeProjectEditor}
          style={{
            position: 'fixed', inset: 0, zIndex: 150,
            background: 'rgba(15,23,42,0.42)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 620,
              borderRadius: 20, background: '#fff',
              boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
              overflow: 'hidden',
            }}
          >
            <div style={{ height: 5, background: 'linear-gradient(90deg, #1a2744, #2d4a8a, #c9a84c)' }} />
            <div style={{ padding: 22 }}>
              <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 18, color: '#1e293b', fontWeight: 800 }}>
                {editingProjectId ? 'แก้ไขโครงการงบประมาณ' : 'เพิ่มโครงการงบประมาณ'}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginTop: 16 }}>
                <input value={projectForm.fiscal_year} onChange={e => setProjectForm(prev => ({ ...prev, fiscal_year: e.target.value }))} placeholder="ปีงบ" inputMode="numeric" style={{ ...formField(), minHeight: 42 }} />
                <input value={projectForm.department_code} onChange={e => setProjectForm(prev => ({ ...prev, department_code: e.target.value }))} placeholder="รหัสงบ/แผนก" style={{ ...formField(), minHeight: 42 }} />
                <input value={projectForm.project_name} onChange={e => setProjectForm(prev => ({ ...prev, project_name: e.target.value }))} placeholder="ชื่อโครงการ" style={{ ...formField('1 / -1'), minHeight: 42 }} />
                <input value={projectForm.external_code} onChange={e => setProjectForm(prev => ({ ...prev, external_code: e.target.value }))} placeholder="รหัสอ้างอิง" style={{ ...formField(), minHeight: 42 }} />
                <input value={projectForm.budget_filter} onChange={e => setProjectForm(prev => ({ ...prev, budget_filter: e.target.value }))} placeholder="รหัสงบ เช่น 26-4154-02" style={{ ...formField(), minHeight: 42 }} />
                <input value={projectForm.budget_category} onChange={e => setProjectForm(prev => ({ ...prev, budget_category: e.target.value }))} placeholder="หมวดงบ" style={{ ...formField(), minHeight: 42 }} />
                <input value={projectForm.project_type} onChange={e => setProjectForm(prev => ({ ...prev, project_type: e.target.value }))} placeholder="ประเภทโครงการ" style={{ ...formField('1 / -1'), minHeight: 42 }} />
                <input value={projectForm.planned_revenue} onChange={e => setProjectForm(prev => ({ ...prev, planned_revenue: e.target.value }))} placeholder="รายรับตามแผน" inputMode="decimal" style={{ ...formField(), minHeight: 42 }} />
                <input value={projectForm.planned_expense} onChange={e => setProjectForm(prev => ({ ...prev, planned_expense: e.target.value }))} placeholder="รายจ่ายตามแผน" inputMode="decimal" style={{ ...formField(), minHeight: 42 }} />
              </div>
              {error && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <button onClick={closeProjectEditor} style={{ ...smallButton('#f1f5f9', '#475569'), padding: '10px 16px' }}>ยกเลิก</button>
                <button disabled={saving} onClick={saveProject} style={{ ...smallButton(saving ? '#94a3b8' : '#1a2744', '#fff'), padding: '10px 16px' }}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-component: Detail Table Row ──
function DetailTableRow({ row, months, mode }: { row: DetailRow; months: number[]; mode: DetailMode }) {
  const isRevenue = row.kind === 'revenue'
  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
      <td style={{ padding: '9px 14px', borderRight: '1px solid #f1f5f9', minWidth: 160 }}>
        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{row.name}</div>
        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{row.code}</div>
      </td>
      <td style={{ padding: '9px 10px', textAlign: 'right', borderRight: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
        {mode !== 'actual' && <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#64748b' }}>{row.planTotal ? money(row.planTotal) : '—'}</div>}
        {mode !== 'plan' && <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700, color: isRevenue ? '#047857' : '#b45309' }}>{row.actualTotal ? money(row.actualTotal) : '—'}</div>}
      </td>
      <td style={{ padding: '9px 10px', textAlign: 'right', borderRight: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
        {(() => {
          const diff = row.planTotal - row.actualTotal
          const over = !isRevenue && row.actualTotal > row.planTotal && row.planTotal > 0
          return (
            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700, color: over ? '#dc2626' : '#059669' }}>
              {diff !== 0 ? money(diff) : '—'}
            </div>
          )
        })()}
      </td>
      {months.map(m => {
        const plan = Number(row.plan[m] ?? 0)
        const actual = Number(row.actual[m] ?? 0)
        const over = !isRevenue && actual > plan && plan > 0
        return (
          <td key={m} style={{ padding: '7px 8px', textAlign: 'center', borderLeft: '1px solid #f1f5f9', minWidth: mode === 'compare' ? 80 : 60 }}>
            {mode !== 'actual' && plan > 0 && (
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                {new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(plan)}
              </div>
            )}
            {mode !== 'plan' && actual > 0 && (
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700, color: over ? '#dc2626' : (isRevenue ? '#047857' : '#1e293b'), lineHeight: 1.4 }}>
                {new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(actual)}
              </div>
            )}
            {!plan && !actual && <span style={{ color: '#e2e8f0', fontSize: 11 }}>—</span>}
          </td>
        )
      })}
    </tr>
  )
}

// ── OCR field wrapper — shows a green "อ่านจากใบเสร็จ" badge when filled ──
function OcrField({ children, filled, gridColumn }: { children: React.ReactNode; filled: boolean; gridColumn?: string }) {
  return (
    <div style={{ position: 'relative', gridColumn }}>
      {children}
      {filled && (
        <div style={{
          position: 'absolute', top: -8, right: 6,
          background: '#10b981', color: '#fff',
          fontFamily: 'Anuphan, sans-serif', fontSize: 10, fontWeight: 700,
          padding: '1px 7px', borderRadius: 999,
          pointerEvents: 'none', whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(16,185,129,0.3)',
        }}>
          ✓ อ่านจากใบเสร็จ
        </div>
      )}
    </div>
  )
}

function headerButton(background: string, color: string, border = false): CSSProperties {
  return {
    border: border ? '1px solid rgba(255,255,255,0.25)' : 'none',
    borderRadius: 12, padding: '9px 14px', background, color,
    cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 700,
    whiteSpace: 'nowrap',
  }
}

function smallButton(background: string, color: string): CSSProperties {
  return { border: 'none', borderRadius: 10, padding: '7px 12px', background, color, cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700 }
}

function formField(gridColumn?: string): CSSProperties {
  return { gridColumn, padding: '9px 10px', borderRadius: 11, border: '1.5px solid #e4e8f2', background: '#fff', fontFamily: 'Anuphan, sans-serif', minWidth: 0, color: '#0f172a', outline: 'none' }
}

// Keep SOFT_FIELD referenced so no unused warning
void SOFT_FIELD
