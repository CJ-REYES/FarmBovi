import { useState, type FormEvent } from 'react'
import { authApi } from '../../lib/api'

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setCargando(true)
    try {
      await authApi.login(correo, contrasena)
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
    } finally {
      setCargando(false)
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-surface-app p-6">
    <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-lg">
      <div><h1 className="text-3xl font-bold text-brand-slate">FarmBovi</h1><p className="mt-1 text-slate-600">Inicia sesión para continuar</p></div>
      <label className="block text-sm font-medium text-slate-700">Correo
        <input autoComplete="username" type="email" required maxLength={254} value={correo} onChange={e => setCorreo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3" />
      </label>
      <label className="block text-sm font-medium text-slate-700">Contraseña
        <input autoComplete="current-password" type="password" required maxLength={200} value={contrasena} onChange={e => setContrasena(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={cargando} className="w-full rounded-lg bg-brand-slate px-4 py-3 font-semibold text-white disabled:opacity-60">{cargando ? 'Ingresando…' : 'Iniciar sesión'}</button>
    </form>
  </main>
}
