import type { ReactNode } from 'react'
import Sidebar, { type NavSection } from './Sidebar'
import Topbar from './Topbar'

interface AppShellProps {
  children: ReactNode
  activeSection?: NavSection
  onSelectSection?: (section: NavSection) => void
}

export default function AppShell({
  children,
  activeSection = 'dashboard',
  onSelectSection = () => {},
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full bg-surface-app overflow-hidden">
      <Sidebar activeSection={activeSection} onSelectSection={onSelectSection} />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar activeSection={activeSection} onSelectSection={onSelectSection} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
