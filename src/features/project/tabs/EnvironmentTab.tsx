import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  KeyRound,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { countParsableVars, groupByScope, looksLikeSecret, maskValue, syncState } from '../../../lib/envVars'
import { formatBytes } from '../../../lib/format'
import type { EnvFileInfo, EnvVar, ProjectEnvVars } from '../../../types'
import { LoadingInline } from '../../../components/Primitives'

/** Formulario de alta o edición. `id` ausente significa que es nueva. */
interface Draft {
  id?: string
  scope: string
  key: string
  value: string
  isSecret: boolean
  isEnabled: boolean
  comment: string
  /** Si el usuario ya tocó la casilla de secreto: deja de auto-marcarse. */
  secretTouched: boolean
}

function emptyDraft(scope: string): Draft {
  return { scope, key: '', value: '', isSecret: false, isEnabled: true, comment: '', secretTouched: false }
}

export function EnvironmentTab({
  data,
  loading,
  busy,
  onSave,
  onDelete,
  onImport,
  onWrite,
  onCopy,
}: {
  data: ProjectEnvVars | null
  loading: boolean
  busy: string | null
  onSave: (draft: Draft) => Promise<unknown>
  onDelete: (ids: string[], label: string) => void
  onImport: (scope: string, content?: string) => Promise<unknown>
  onWrite: (scope: string) => void
  onCopy: (ids?: string[]) => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState<{ scope: string; content: string } | null>(null)
  const [pendingWrite, setPendingWrite] = useState<EnvFileInfo | null>(null)

  const vars = data?.vars ?? []
  const files = data?.files ?? []
  const groups = useMemo(() => groupByScope(vars), [vars])
  const knownScopes = useMemo(
    () => [...new Set(['.env', '.env.local', ...files.map(file => file.name), ...vars.map(variable => variable.scope)])],
    [files, vars]
  )
  const secretCount = vars.filter(variable => variable.isSecret).length

  const toggleReveal = (id: string) =>
    setRevealed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submitDraft = async () => {
    if (!draft?.key.trim()) return
    const saved = await onSave(draft)
    if (saved) setDraft(null)
  }

  if (loading && !data) {
    return (
      <div className="detail-grid">
        <section className="card span-two">
          <LoadingInline />
        </section>
      </div>
    )
  }

  return (
    <div className="detail-grid">
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">BÓVEDA DE ENTORNO</p>
            <h2>
              {vars.length} {vars.length === 1 ? 'variable guardada' : 'variables guardadas'}
            </h2>
            <p>
              Las variables viven en la base local del panel, no solo en los <code>.env</code> del
              proyecto. Sobreviven a borrar la carpeta y se inyectan al ejecutar.
            </p>
          </div>
          <div className="env-heading-actions">
            <button className="secondary" onClick={() => setPaste({ scope: '.env', content: '' })} disabled={!!busy}>
              <ClipboardPaste size={15} /> Pegar .env
            </button>
            <button className="secondary" onClick={() => onCopy()} disabled={!!busy || !vars.length}>
              <Copy size={15} /> Copiar bóveda
            </button>
            <button className="primary" onClick={() => setDraft(emptyDraft('.env'))} disabled={!!busy}>
              <Plus size={15} /> Añadir variable
            </button>
          </div>
        </div>

        {/* El número que de verdad importa: claves que están en el disco y no
            en la bóveda son las que se van con la carpeta al borrar. */}
        {data && data.unprotectedKeys > 0 && (
          <div className="env-alert warn">
            <AlertTriangle size={18} />
            <div>
              <strong>
                {data.unprotectedKeys} {data.unprotectedKeys === 1 ? 'clave sin proteger' : 'claves sin proteger'}
              </strong>
              <p>
                Están en los ficheros del proyecto y no en la bóveda. Los <code>.env</code> están en
                el <code>.gitignore</code>, así que tampoco están en GitHub: al borrar el proyecto se
                perderían. Impórtalas desde la lista de ficheros.
              </p>
            </div>
          </div>
        )}

        {data && vars.length > 0 && data.unprotectedKeys === 0 && (
          <div className="env-alert good">
            <ShieldCheck size={18} />
            <div>
              <strong>Todo lo que hay en disco está respaldado</strong>
              <p>
                {secretCount > 0
                  ? `${secretCount} de ${vars.length} se tratan como secretos y se muestran ocultas.`
                  : 'Ninguna se ha clasificado como secreto.'}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* --------------------------------------------------- ficheros del disco */}
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">FICHEROS DE ENTORNO</p>
            <h2>Sincronización con el disco</h2>
          </div>
        </div>

        {files.length ? (
          <div className="env-file-list">
            {files.map(file => {
              const state = syncState(file)
              const importing = busy === `import:${file.name}`
              const writing = busy === `write:${file.name}`
              return (
                <div key={file.name} className={`env-file-row ${state.tone}`}>
                  <div className="env-file-id">
                    <FileCode2 size={16} />
                    <span>
                      <strong>{file.name}</strong>
                      <small title={state.hint}>
                        {file.fileVarCount} en disco · {file.vaultVarCount} en bóveda
                        {file.sizeBytes > 0 ? ` · ${formatBytes(file.sizeBytes)}` : ''}
                      </small>
                    </span>
                  </div>
                  <span className={`env-sync-pill ${state.tone}`} title={state.hint}>
                    {state.label}
                  </span>
                  <div className="env-file-actions">
                    <button
                      className="secondary"
                      onClick={() => void onImport(file.name)}
                      disabled={!!busy || file.fileVarCount === 0}
                      title={
                        file.fileVarCount === 0
                          ? 'El fichero no existe en el disco'
                          : `Traer las variables de ${file.name} a la bóveda`
                      }
                    >
                      {importing ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} Importar
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setPendingWrite(file)}
                      disabled={!!busy || file.vaultVarCount === 0}
                      title={
                        file.vaultVarCount === 0
                          ? 'La bóveda no tiene variables en este ámbito'
                          : `Escribir la bóveda en ${file.name}`
                      }
                    >
                      {writing ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Escribir
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="empty-inline">
            No se encontró ningún <code>.env</code> en la raíz del proyecto. Añade variables a mano o
            pega un bloque para empezar la bóveda.
          </p>
        )}

        {/* Sobrescribir un .env es la única acción de esta pestaña que pisa el
            disco: se confirma en el sitio, enumerando lo que va a desaparecer. */}
        {pendingWrite && (
          <div className="env-confirm">
            <div>
              <strong>
                ¿Sobrescribir {pendingWrite.name} con las {pendingWrite.vaultVarCount} variables de la
                bóveda?
              </strong>
              {pendingWrite.missingInVault.length > 0 ? (
                <p className="env-confirm-loss">
                  Estas claves están en el fichero y no en la bóveda, así que desaparecerán del{' '}
                  <code>.env</code>: <code>{pendingWrite.missingInVault.join(', ')}</code>
                </p>
              ) : (
                <p>
                  Se conserva una copia del contenido anterior en el directorio de datos del panel,
                  fuera del repositorio.
                </p>
              )}
            </div>
            <div className="env-confirm-actions">
              <button className="secondary" onClick={() => setPendingWrite(null)}>
                Cancelar
              </button>
              <button
                className="danger"
                onClick={() => {
                  onWrite(pendingWrite.name)
                  setPendingWrite(null)
                }}
              >
                <Upload size={14} /> Escribir {pendingWrite.name}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- pegar bloque */}
      {paste && (
        <section className="card span-two">
          <div className="card-heading">
            <div>
              <p className="eyebrow">IMPORTAR PEGANDO</p>
              <h2>Pegar el contenido de un .env</h2>
              <p>Útil cuando el fichero está en otro equipo o llega por un gestor de contraseñas.</p>
            </div>
            <button className="icon-button" onClick={() => setPaste(null)} aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
          <div className="env-paste">
            <label>
              <span>Guardar en</span>
              <input
                value={paste.scope}
                onChange={event => setPaste({ ...paste, scope: event.target.value })}
                placeholder=".env"
                list="env-scope-options"
              />
            </label>
            <textarea
              value={paste.content}
              onChange={event => setPaste({ ...paste, content: event.target.value })}
              placeholder={'DATABASE_URL=postgres://usuario:clave@localhost:5432/db\nSTRIPE_SECRET_KEY=sk_live_…'}
              rows={8}
              spellCheck={false}
            />
            <div className="env-paste-footer">
              <span>{countParsableVars(paste.content)} variables detectadas</span>
              <button
                className="primary"
                disabled={!!busy || countParsableVars(paste.content) === 0}
                onClick={async () => {
                  const imported = await onImport(paste.scope.trim() || '.env', paste.content)
                  if (imported) setPaste(null)
                }}
              >
                {busy?.startsWith('import:') ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}{' '}
                Importar a la bóveda
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- variables */}
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">VARIABLES</p>
            <h2>Contenido de la bóveda</h2>
            <p>
              Al ejecutar, los ficheros más específicos pisan a los generales:{' '}
              <code>.env</code> → <code>.env.&lt;modo&gt;</code> → <code>.env.local</code>.
            </p>
          </div>
        </div>

        <datalist id="env-scope-options">
          {knownScopes.map(scope => (
            <option key={scope} value={scope} />
          ))}
        </datalist>

        {draft && !draft.id && (
          <DraftForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={submitDraft}
            onCancel={() => setDraft(null)}
            busy={!!busy}
          />
        )}

        {groups.length ? (
          groups.map(group => (
            <div key={group.scope} className="env-group">
              <div className="env-group-heading">
                <FileCode2 size={13} />
                <strong>{group.scope}</strong>
                <span className="env-group-count">{group.vars.length}</span>
                <button
                  className="env-inline-link"
                  onClick={() => onCopy(group.vars.map(variable => variable.id))}
                  disabled={!!busy}
                >
                  <Copy size={12} /> Copiar ámbito
                </button>
              </div>

              <div className="env-var-list">
                {group.vars.map(variable =>
                  draft?.id === variable.id ? (
                    <DraftForm
                      key={variable.id}
                      draft={draft}
                      setDraft={setDraft}
                      onSubmit={submitDraft}
                      onCancel={() => setDraft(null)}
                      busy={!!busy}
                    />
                  ) : (
                    <VarRow
                      key={variable.id}
                      variable={variable}
                      revealed={revealed.has(variable.id)}
                      busy={busy}
                      onReveal={() => toggleReveal(variable.id)}
                      onEdit={() =>
                        setDraft({
                          id: variable.id,
                          scope: variable.scope,
                          key: variable.key,
                          value: variable.value,
                          isSecret: variable.isSecret,
                          isEnabled: variable.isEnabled,
                          comment: variable.comment ?? '',
                          secretTouched: true,
                        })
                      }
                      onToggleEnabled={() =>
                        void onSave({
                          id: variable.id,
                          scope: variable.scope,
                          key: variable.key,
                          value: variable.value,
                          isSecret: variable.isSecret,
                          isEnabled: !variable.isEnabled,
                          comment: variable.comment ?? '',
                          secretTouched: true,
                        })
                      }
                      onDelete={() => onDelete([variable.id], `«${variable.key}»`)}
                    />
                  )
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="empty-inline">
            La bóveda está vacía. Importa un fichero de la lista de arriba o añade la primera
            variable.
          </p>
        )}
      </section>

      <section className="card safety-note span-two">
        <Lock size={22} />
        <div>
          <h3>Dónde acaban estos valores</h3>
          <p>
            Se guardan en la base SQLite local del panel, en texto plano, igual que tu token de
            GitHub. No salen del equipo y nunca se envían a ningún servicio. Los secretos aparecen
            ocultos para que no queden a la vista en una captura de pantalla, no porque estén
            cifrados en disco.
          </p>
        </div>
      </section>
    </div>
  )
}

function VarRow({
  variable,
  revealed,
  busy,
  onReveal,
  onEdit,
  onToggleEnabled,
  onDelete,
}: {
  variable: EnvVar
  revealed: boolean
  busy: string | null
  onReveal: () => void
  onEdit: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}) {
  const [copied, setCopied] = useState(false)
  const hidden = variable.isSecret && !revealed

  const copy = () => {
    void navigator.clipboard.writeText(variable.value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`env-var-row ${variable.isEnabled ? '' : 'disabled'}`}>
      <div className="env-var-key">
        {variable.isSecret ? <KeyRound size={13} className="env-secret-icon" /> : <span className="env-key-dot" />}
        <code>{variable.key}</code>
        {variable.comment && <small title={variable.comment}>{variable.comment}</small>}
      </div>

      <code className={`env-var-value ${hidden ? 'masked' : ''}`} title={hidden ? 'Oculto' : variable.value}>
        {hidden ? maskValue(variable.value) : variable.value || '(vacío)'}
      </code>

      <div className="env-var-actions">
        {variable.isSecret && (
          <button className="icon-button" onClick={onReveal} title={revealed ? 'Ocultar valor' : 'Revelar valor'}>
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button className="icon-button" onClick={copy} title="Copiar valor">
          {copied ? <Check size={14} color="var(--accent-primary)" /> : <Copy size={14} />}
        </button>
        <button
          className="icon-button"
          onClick={onToggleEnabled}
          disabled={!!busy}
          title={
            variable.isEnabled
              ? 'Deshabilitar: no se inyectará al ejecutar y se escribirá comentada'
              : 'Habilitar'
          }
        >
          {variable.isEnabled ? <ToggleRight size={16} color="var(--accent-primary)" /> : <ToggleLeft size={16} />}
        </button>
        <button className="icon-button" onClick={onEdit} disabled={!!busy} title="Editar">
          <Pencil size={14} />
        </button>
        <button className="icon-button danger-icon" onClick={onDelete} disabled={!!busy} title="Quitar de la bóveda">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function DraftForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <form
      className="env-draft"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="env-draft-grid">
        <label>
          <span>Nombre</span>
          <input
            value={draft.key}
            autoFocus
            spellCheck={false}
            placeholder="STRIPE_SECRET_KEY"
            onChange={event => {
              const key = event.target.value
              // La casilla de secreto se marca sola mientras el usuario no la
              // haya tocado: escribir «…_TOKEN» y que siga en claro es la forma
              // de que una credencial acabe visible sin querer.
              setDraft({
                ...draft,
                key,
                isSecret: draft.secretTouched ? draft.isSecret : looksLikeSecret(key, draft.value),
              })
            }}
          />
        </label>
        <label>
          <span>Fichero</span>
          <input
            value={draft.scope}
            spellCheck={false}
            placeholder=".env"
            list="env-scope-options"
            onChange={event => setDraft({ ...draft, scope: event.target.value })}
          />
        </label>
        <label className="env-draft-value">
          <span>Valor</span>
          <textarea
            value={draft.value}
            spellCheck={false}
            rows={draft.value.includes('\n') ? 4 : 1}
            placeholder="sk_live_…"
            onChange={event => {
              const value = event.target.value
              setDraft({
                ...draft,
                value,
                isSecret: draft.secretTouched ? draft.isSecret : looksLikeSecret(draft.key, value),
              })
            }}
          />
        </label>
        <label className="env-draft-comment">
          <span>Comentario (opcional)</span>
          <input
            value={draft.comment}
            placeholder="Para qué sirve esta clave"
            onChange={event => setDraft({ ...draft, comment: event.target.value })}
          />
        </label>
      </div>

      <div className="env-draft-footer">
        <label className="env-checkbox">
          <input
            type="checkbox"
            checked={draft.isSecret}
            onChange={event => setDraft({ ...draft, isSecret: event.target.checked, secretTouched: true })}
          />
          <span>Ocultar el valor en la interfaz</span>
        </label>
        <label className="env-checkbox">
          <input
            type="checkbox"
            checked={draft.isEnabled}
            onChange={event => setDraft({ ...draft, isEnabled: event.target.checked })}
          />
          <span>Activa al ejecutar</span>
        </label>
        <div className="env-draft-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy || !draft.key.trim()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{' '}
            {draft.id ? 'Guardar cambios' : 'Añadir a la bóveda'}
          </button>
        </div>
      </div>
    </form>
  )
}

export type { Draft as EnvVarDraft }
