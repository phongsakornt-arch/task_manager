declare module 'react-big-calendar' {
  import type { CSSProperties, ReactNode } from 'react'

  export type View = 'month' | 'week' | 'work_week' | 'day' | 'agenda'

  export interface DateLocalizer {
    formats?: Record<string, unknown>
  }

  export function dateFnsLocalizer(config: {
    format: unknown
    parse: unknown
    startOfWeek: unknown
    getDay: unknown
    locales: Record<string, unknown>
  }): DateLocalizer

  export interface CalendarProps<TEvent extends object = object> {
    localizer: DateLocalizer
    events?: TEvent[]
    startAccessor?: keyof TEvent | string | ((event: TEvent) => Date)
    endAccessor?: keyof TEvent | string | ((event: TEvent) => Date)
    titleAccessor?: keyof TEvent | string | ((event: TEvent) => ReactNode)
    culture?: string
    date?: Date
    view?: View
    views?: View[]
    popup?: boolean
    onNavigate?: (date: Date) => void
    onView?: (view: View) => void
    onSelectEvent?: (event: TEvent) => void
    eventPropGetter?: (event: TEvent) => {
      className?: string
      style?: CSSProperties
    }
    messages?: {
      today?: string
      previous?: string
      next?: string
      month?: string
      week?: string
      day?: string
      agenda?: string
      date?: string
      time?: string
      event?: string
      noEventsInRange?: string
      showMore?: (total: number) => string
    }
  }

  export function Calendar<TEvent extends object = object>(props: CalendarProps<TEvent>): ReactNode
}
