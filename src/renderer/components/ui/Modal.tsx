import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from './button'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './dialog'

/** App modal on shadcn's Dialog. Same API as before: `title`, `onClose`, body children, optional width class. */
export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-label={title} showCloseButton={false} className={`gap-0 p-0 ${width}`}>
        <DialogHeader className="px-5 pt-4 pb-3 pr-12">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" className="absolute top-2.5 right-2.5" />}>
          <XIcon />
        </DialogClose>
        <div className="space-y-4 px-5 pb-5">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
