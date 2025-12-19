import { useState, useEffect } from 'react'
import { Tooltip } from './components/Tooltip'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface AppData {
  name: string;
  path: string;
  type: string;
  processName?: string;
  autoRestart?: boolean;
  order?: number;
  launchDelay?: number;
}

// Extracted Card Component for reuse in SortableItem and DragOverlay
const AppCard = ({ app, tooltipsEnabled, openSettings, handleLaunch, handleKill, style, isOverlay }: any) => {
  return (
    <div
      className={`glass-panel ${isOverlay ? 'dragging' : ''}`}
      style={{
        padding: '15px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        height: '100%',
        boxSizing: 'border-box',
        cursor: 'grab',
        boxShadow: isOverlay ? '0 0 20px rgba(0,255,255,0.5)' : undefined,
        border: isOverlay ? '1px solid var(--color-neon-cyan)' : undefined,
        background: isOverlay ? 'var(--color-glass)' : undefined,
        ...style
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 'bold', color: 'var(--color-neon-cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={app.name}>
          {app.order ? <span style={{ color: 'var(--color-neon-pink)', marginRight: '5px' }}>#{app.order}</span> : null}
          {app.name}
        </div>
        <Tooltip content="Configure app settings (Order, Delay, Auto-Restart)" enabled={tooltipsEnabled}>
          <button
            onPointerDown={(e) => e.stopPropagation()} // Prevent drag on button click
            onClick={() => openSettings(app)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', opacity: 0.5 }}>⚙️</button>
        </Tooltip>
      </div>

      <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>
        Typ: {app.type.replace('.', '').toUpperCase()} <br />
        {app.autoRestart && <div style={{ color: 'var(--color-neon-pink)' }}>[Auto-Restart On]</div>}
        {app.launchDelay && app.launchDelay > 0 ? <div style={{ color: '#aaa' }}>Delay: {app.launchDelay}s</div> : null}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', gap: '5px' }}>
        <Tooltip content={`Launch ${app.name}`} enabled={tooltipsEnabled}>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => handleLaunch(app.path)}
            className="btn-neon"
            style={{ flex: 1, fontSize: '0.8rem' }}>Launch</button>
        </Tooltip>
        <Tooltip content={`Force kill ${app.name}`} enabled={tooltipsEnabled}>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => handleKill(app.path)}
            className="btn-neon pink"
            style={{ flex: 1, fontSize: '0.8rem' }}>Kill</button>
        </Tooltip>
      </div>
    </div>
  )
}

const SortableAppItem = (props: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: props.app.name });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    height: '100%',
    touchAction: 'none',
    ...props.style
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <AppCard {...props} />
    </div>
  )
}

function App() {
  const [apps, setApps] = useState<AppData[]>([])
  const [logs, setLogs] = useState<string[]>(["System initialized...", "Scanning Documents/VR app launcher..."])
  const [tooltipsEnabled, setTooltipsEnabled] = useState(true)

  // Drag State
  const [activeId, setActiveId] = useState<string | null>(null);

  // Settings Modal State
  const [editingApp, setEditingApp] = useState<AppData | null>(null)
  const [processNameInput, setProcessNameInput] = useState('')
  const [autoRestartInput, setAutoRestartInput] = useState(false)
  const [orderInput, setOrderInput] = useState(0)
  const [launchDelayInput, setLaunchDelayInput] = useState(0)

  const ipcRenderer = (window as any).ipcRenderer

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require movement to start drag, handling accidental clicks
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadApps()

    if (ipcRenderer) {
      ipcRenderer.on('console-log', (_e: any, msg: string) => {
        addLog(msg)
      })

      ipcRenderer.on('app-status-change', (_e: any, data: { path: string, status: string }) => {
        addLog(`Status Update: ${data.path} is now ${data.status}`)
      })
    }
  }, [])

  const addLog = (msg: string) => {
    setLogs(prev => {
      const newLogs = [...prev, msg]
      if (newLogs.length > 100) return newLogs.slice(newLogs.length - 100)
      return newLogs
    })
  }

  const loadApps = async () => {
    if (!ipcRenderer) return
    try {
      const found = await ipcRenderer.invoke('get-apps')
      setApps(found)
      addLog(`Apps list updated. Found ${found.length}.`)
    } catch (err: any) {
      addLog(`Error scanning apps: ${err.message}`)
    }
  }

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  }

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      setApps((items) => {
        const oldIndex = items.findIndex(item => item.name === active.id);
        const newIndex = items.findIndex(item => item.name === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);

        // Persist new order
        updateAppOrder(newOrder);

        // Update local state orders for immediate UI feedback
        return newOrder.map((app, idx) => ({ ...app, order: idx + 1 }));
      });
    }
    setActiveId(null);
  }

  const updateAppOrder = async (orderedApps: AppData[]) => {
    const appNames = orderedApps.map(a => a.name);
    try {
      await ipcRenderer.invoke('save-app-orders', appNames);
      addLog('App order updated.');
    } catch (e: any) {
      addLog(`Failed to save order: ${e.message}`);
    }
  }

  const handleLaunch = async (appPath: string) => {
    addLog(`Requesting launch: ${appPath}`)
    try {
      await ipcRenderer.invoke('launch-app', appPath)
    } catch (err: any) {
      addLog(`Launch failed: ${err.message}`)
    }
  }

  const handleKill = async (appPath: string) => {
    addLog(`Requesting kill: ${appPath}`)
    await ipcRenderer.invoke('kill-app', appPath)
  }

  const handleStartAll = async () => {
    const sortedApps = [...apps].sort((a, b) => (a.order || 0) - (b.order || 0));

    addLog("Starting Launch Sequence...");
    for (const app of sortedApps) {
      await handleLaunch(app.path);

      if (app.launchDelay && app.launchDelay > 0) {
        addLog(`Waiting ${app.launchDelay}s before next app...`);
        await new Promise(resolve => setTimeout(resolve, (app.launchDelay || 0) * 1000));
      }
    }
    addLog("Launch Sequence Complete.");
  }

  const handleKillAll = () => {
    apps.forEach(app => handleKill(app.path))
  }

  const openFolder = () => {
    ipcRenderer.invoke('open-folder')
  }

  const minimize = () => ipcRenderer.send('window-minimize')
  const closeApp = () => ipcRenderer.send('window-close')

  const openSettings = (app: AppData) => {
    setEditingApp(app)
    setProcessNameInput(app.processName || '')
    setAutoRestartInput(app.autoRestart || false)
    setOrderInput(app.order || 0)
    setLaunchDelayInput(app.launchDelay || 0)
  }

  const saveSettings = async () => {
    if (!editingApp) return;

    // Send update to main process to persist
    const updatedApp = {
      ...editingApp,
      processName: processNameInput,
      autoRestart: autoRestartInput,
      order: orderInput,
      launchDelay: launchDelayInput
    }
    try {
      await ipcRenderer.invoke('update-app-settings', updatedApp)
      setEditingApp(null)
      loadApps() // Reload to get fresh state
      addLog(`Updated settings for ${updatedApp.name}`)
    } catch (e: any) {
      addLog(`Failed to update settings: ${e.message}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '16px', boxSizing: 'border-box', gap: '16px' }}>

      {/* Header */}
      <header className="glass-panel" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', WebkitAppRegion: 'drag' } as any}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '10px', height: '10px', background: 'var(--color-neon-cyan)', borderRadius: '50%', boxShadow: '0 0 10px var(--color-neon-cyan)' }}></div>
          <h1 className="text-glow-cyan" style={{ fontSize: '1.5rem', letterSpacing: '2px' }}>VR LAUNCH MGR</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', WebkitAppRegion: 'no-drag' } as any}>
          <div style={{ marginRight: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input type="checkbox" checked={tooltipsEnabled} onChange={e => setTooltipsEnabled(e.target.checked)} id="tips" />
            <label htmlFor="tips" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Tooltips</label>
          </div>

          <Tooltip content="Open the source folder to add more apps" enabled={tooltipsEnabled}>
            <button onClick={openFolder} className="btn-neon" style={{ fontSize: '0.8rem' }}>Folder</button>
          </Tooltip>

          <Tooltip content="Launch all apps in the list sequentially" enabled={tooltipsEnabled}>
            <button onClick={handleStartAll} className="btn-neon">Start All</button>
          </Tooltip>

          <Tooltip content="Immediately terminate all managed processes" enabled={tooltipsEnabled}>
            <button onClick={handleKillAll} className="btn-neon pink">Kill All</button>
          </Tooltip>

          <div style={{ width: '1px', height: '20px', background: 'var(--color-glass-border)', margin: '0 5px' }}></div>

          <button onClick={minimize} className="btn-neon" style={{ border: 'none', padding: '5px 10px' }}>_</button>
          <button onClick={closeApp} className="btn-neon pink" style={{ border: 'none', padding: '5px 10px' }}>X</button>
        </div>
      </header>

      {/* Main Content - App Grid */}
      <main className="glass-panel" style={{ flex: 1, padding: '20px', overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--color-glass-border)', paddingBottom: '10px' }}>
          <h2 className="text-glow-pink" style={{ fontSize: '1rem', margin: 0 }}>DETECTED APPLICATIONS</h2>
          <Tooltip content="Rescan for new apps" enabled={tooltipsEnabled}>
            <button onClick={loadApps} className="btn-neon" style={{ fontSize: '0.8rem', padding: '4px 12px' }}>Refresh</button>
          </Tooltip>
        </div>

        {apps.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', opacity: 0.5 }}>
            <p style={{ marginBottom: '10px' }}>No apps found.</p>
            <small>Place shortcuts in "Documents/VR app launcher"</small>
            <button onClick={loadApps} className="btn-neon" style={{ marginTop: '20px' }}>Refresh</button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={apps.map(a => a.name)}
              strategy={rectSortingStrategy}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                {apps.map((app) => (
                  <SortableAppItem
                    key={app.name}
                    app={app}
                    tooltipsEnabled={tooltipsEnabled}
                    openSettings={openSettings}
                    handleLaunch={handleLaunch}
                    handleKill={handleKill}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeId ? (
                <AppCard
                  app={apps.find(a => a.name === activeId)}
                  tooltipsEnabled={tooltipsEnabled}
                  openSettings={openSettings}
                  handleLaunch={handleLaunch}
                  handleKill={handleKill}
                  isOverlay={true}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {/* Settings Modal */}
      {editingApp && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="glass-panel" style={{ width: '400px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 className="text-glow-cyan">Configure: {editingApp.name}</h3>

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Launch Order</label>
                <input
                  type="number"
                  value={orderInput}
                  onChange={(e) => setOrderInput(parseInt(e.target.value) || 0)}
                  style={{ width: '100%', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-glass-border)', color: '#fff' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Delay (Seconds)</label>
                <input
                  type="number"
                  value={launchDelayInput}
                  onChange={(e) => setLaunchDelayInput(parseInt(e.target.value) || 0)}
                  style={{ width: '100%', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-glass-border)', color: '#fff' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Target Process Name (Optional)</label>
              <input
                type="text"
                value={processNameInput}
                onChange={(e) => setProcessNameInput(e.target.value)}
                placeholder="e.g. vrchat.exe"
                style={{ width: '100%', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-glass-border)', color: '#fff' }}
              />
              <small style={{ opacity: 0.6, fontSize: '0.7rem' }}>Specify if the launched file spawns a different process name.</small>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="ar_check"
                checked={autoRestartInput}
                onChange={(e) => setAutoRestartInput(e.target.checked)}
              />
              <label htmlFor="ar_check">Auto-Restart if crashed/frozen</label>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button onClick={saveSettings} className="btn-neon" style={{ flex: 1 }}>Save</button>
              <button onClick={() => setEditingApp(null)} className="btn-neon pink" style={{ flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer / Console */}
      <footer className="glass-panel" style={{ height: '200px', display: 'flex', flexDirection: 'column', padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', padding: '0 5px' }}>
          <span className="text-glow-cyan" style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>SYSTEM CONSOLE</span>
          <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>STATUS: ACTIVE</span>
        </div>
        <div style={{
          flex: 1,
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '8px',
          padding: '10px',
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          border: '1px solid var(--color-glass-border)'
        }}>
          {logs.map((log, i) => (
            <div key={i} style={{ marginBottom: '4px', display: 'flex' }}>
              <span style={{ color: 'var(--color-neon-cyan)', marginRight: '10px', opacity: 0.7 }}>[{new Date().toLocaleTimeString()}]</span>
              <span style={{ color: '#eee' }}>{log}</span>
            </div>
          ))}
          <div style={{ color: 'var(--color-neon-pink)', marginTop: '8px', fontStyle: 'italic' }}>_</div>
        </div>
      </footer>
    </div>
  )
}

export default App
