import { ExternalTasks } from '../components/tasks/ExternalTasks'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TaskBoard } from '../components/tasks/TaskBoard'
import { TASK_TABS, resolveTaskTab } from '../lib/tasks-tabs'
import { useRouter } from '../store/router'

/** Tasks: our own board and the External tab, where tickets from Helix and others are read. */
export function TasksPage({ tab }: { tab: string }) {
  const navigate = useRouter((s) => s.navigate)
  const active = resolveTaskTab(tab)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
        <Tabs value={active} onValueChange={(v) => navigate({ name: 'tasks', tab: String(v) })}>
          <TabsList variant="line" aria-label="Task sources" className="w-full justify-start rounded-none border-b border-border">
            {TASK_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="flex-none px-3">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {active === 'external' ? (
          <ExternalTasks />
        ) : (
          <TaskBoard />
        )}
      </div>
    </div>
  )
}
