import type { ReactNode } from 'react'
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '../../lib/cn'

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean }

/**
 * A select driven by an options array (value, label), on shadcn's Select (Base UI). Shadcn's own
 * Select is composed by hand (trigger, content, items); this keeps the one-line call sites the app uses.
 * `''` means "nothing chosen" and shows the placeholder.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Choose…',
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <SelectRoot items={options} value={value === '' ? null : value} onValueChange={(v) => onValueChange(typeof v === 'string' ? v : '')} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn('w-full min-w-0', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-[min(var(--available-height),20rem)]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  )
}
