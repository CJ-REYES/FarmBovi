import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, Smartphone, X } from 'lucide-react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'

export function PwaStatus({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
  const { canInstall, installed, install } = useInstallPrompt()
  const [installError, setInstallError] = useState<string | null>(null)
  const [workerError, setWorkerError] = useState<string | null>(null)
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError() { setWorkerError('No se pudo habilitar la apertura sin conexión. Recarga la página con internet.') },
  })

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Aplicación instalable">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-pasture/10 p-2 text-pasture"><Smartphone size={22} aria-hidden="true" /></span>
        <h2 className="font-display text-2xl font-semibold">FarmBovi en el campo</h2>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        {installed ? 'La app está instalada en este dispositivo.' : 'Instala la app para abrirla desde tu pantalla de inicio.'}
        {' '}Sin conexión puedes consultar el último listado guardado.
      </p>
      {canInstall && !installed && (
        <button className="button-primary mt-4 w-full" onClick={() => {
          setInstallError(null)
          void install().catch(() => setInstallError('No se pudo abrir la instalación. Usa el menú de tu navegador.'))
        }}><Download size={18} aria-hidden="true" />Instalar app</button>
      )}
      {!canInstall && !installed && <p className="mt-3 text-sm text-slate-500">Busca «Instalar aplicación» en el menú del navegador. En iPhone: Safari → Compartir → Añadir a pantalla de inicio.</p>}
      {(installError || workerError) && <p role="alert" className="mt-3 text-sm text-red-700">{installError || workerError}</p>}
      {(offlineReady || needRefresh) && (
        <div role="status" className="mt-4 rounded-lg bg-field p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p>{needRefresh ? 'Hay una nueva versión de FarmBovi.' : 'La app está lista para abrirse sin conexión. Los datos requieren una primera consulta con internet.'}</p>
            <button aria-label="Cerrar aviso" className="p-1" onClick={() => { setOfflineReady(false); setNeedRefresh(false) }}><X size={16} /></button>
          </div>
          {needRefresh && <>
            {hasUnsavedChanges && <p className="mt-2">Guarda o cancela el formulario antes de actualizar.</p>}
            <button className="button-primary mt-3" disabled={hasUnsavedChanges} onClick={() => {
              void updateServiceWorker(true).catch(() => setWorkerError('No se pudo actualizar. Recarga la app con internet.'))
            }}><RefreshCw size={16} aria-hidden="true" />Actualizar app</button>
          </>}
        </div>
      )}
    </aside>
  )
}
