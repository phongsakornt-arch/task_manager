import { differenceInCalendarDays, parseISO } from 'date-fns'

interface Props { date?: string; completed?: boolean }

export default function DueBadge({ date, completed }: Props) {
  if (!date || completed) return null

  const diff = differenceInCalendarDays(parseISO(date), new Date())

  if (diff < 0) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">เกินกำหนด {Math.abs(diff)}ว</span>
  if (diff === 0) return <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium">วันนี้</span>
  if (diff === 1) return <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-600 font-medium">พรุ่งนี้</span>
  if (diff <= 7) return <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">{diff} วัน</span>
  return null
}
