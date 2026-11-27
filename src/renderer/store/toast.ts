import { toast as sonner } from 'sonner'

/** Bottom-right toast (sonner). Same calls as before: `toast.success('Saved')`, `toast.error('…', 'details')`. */
export const toast = {
  success: (title: string, description?: string) => sonner.success(title, { description }),
  error: (title: string, description?: string) => sonner.error(title, { description }),
  info: (title: string, description?: string) => sonner(title, { description }),
}
