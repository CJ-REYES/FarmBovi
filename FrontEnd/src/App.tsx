import { useState } from 'react'
import AppShell from './components/layout/AppShell'
import type { NavSection } from './components/layout/Sidebar'
import DashboardPage from './components/dashboard/DashboardPage'
import { CattleListPage } from './features/cattle/CattleListPage'
import { SanidadPage } from './features/sanidad/SanidadPage'
import { AgendaPage } from './features/sanidad/AgendaPage'

export function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('salud')

  function renderSection() {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardPage onSelectSection={setActiveSection} />
      case 'bovinos':
        return <CattleListPage onNavigateToSanidad={() => setActiveSection('salud')} />
      case 'salud':
        return <SanidadPage onNavigateToAgenda={() => setActiveSection('alertas')} />
      case 'alertas':
        return <AgendaPage onNavigateToSanidad={() => setActiveSection('salud')} />
      default:
        return (
          <div className="bg-surface-white border border-border-light rounded-xl p-10 text-center space-y-3">
            <h2 className="text-2xl font-bold font-condensed text-brand-forest uppercase">
              Módulo en desarrollo ({activeSection})
            </h2>
            <p className="text-brand-slate/70 text-[14px] max-w-md mx-auto">
              Usa el menú lateral para acceder al Panel Principal, Bovinos, Salud y Tratamientos o Agenda y Alertas.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActiveSection('salud')}
                className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-semibold"
              >
                Ir a Salud y Tratamientos
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('alertas')}
                className="px-4 py-2 rounded-md border border-border-light text-brand-slate text-sm font-semibold"
              >
                Ir a Agenda y Alertas
              </button>
            </div>
          </div>
        )
    }
  }

  return (
    <AppShell activeSection={activeSection} onSelectSection={setActiveSection}>
      {renderSection()}
    </AppShell>
  )
}

export default App
