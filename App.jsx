import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { DeckGL, ScatterplotLayer, TileLayer, BitmapLayer } from 'deck.gl'

// La clave "publishable" es pública por diseño (la seguridad la da RLS en Supabase)
const supabase = createClient(
  'https://akflhicjnxlkeqqbfnia.supabase.co',
  'sb_publishable_MWcRh5HFFhDOw8P7Tc1Ckw_svFwuUU6'
)

const COLORES = {
  Entregado: [34, 197, 94],
  'En camino': [245, 158, 11],
  Pendiente: [239, 68, 68],
}

// Siguiente estado que puede aplicar el chófer
const SIGUIENTE = {
  Pendiente: { estado: 'En camino', texto: '🚚 Salir a entregar' },
  'En camino': { estado: 'Entregado', texto: '✅ Marcar entregado' },
}

const VISTA_INICIAL = {
  longitude: -58.44,
  latitude: -34.61,
  zoom: 10.8,
  pitch: 0,
  bearing: 0,
}

// Mapa de fondo (OpenStreetMap)
const capaBase = new TileLayer({
  id: 'mapa-base',
  data: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  renderSubLayers: (props) => {
    const { west, south, east, north } = props.tile.bbox
    return new BitmapLayer(props, {
      data: null,
      image: props.data,
      bounds: [west, south, east, north],
    })
  },
})

const ESTILOS = `
  .app { grid-template-rows: auto auto auto 1fr; }
  .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0 16px 10px; }
  .tab { background: #1e293b; color: #94a3b8; border: 0; border-radius: 10px; padding: 10px; font-size: 15px; font-weight: 600; }
  .tab.activa { background: #2563eb; color: #fff; }
  .chofer { overflow-y: auto; min-height: 0; padding: 0 16px 20px; }
  .filtros { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .chip { background: #1e293b; color: #cbd5e1; border: 0; border-radius: 999px; padding: 6px 12px; font-size: 13px; }
  .chip.activo { background: #f8fafc; color: #0f172a; font-weight: 700; }
  .tarjeta { background: #1e293b; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .tarjeta .fila { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .tarjeta .nombre { font-weight: 700; font-size: 16px; }
  .tarjeta .zona { color: #94a3b8; font-size: 13px; margin-top: 2px; }
  .badge { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; color: #0f172a; }
  .accion { width: 100%; margin-top: 10px; background: #2563eb; color: #fff; border: 0; border-radius: 10px; padding: 12px; font-size: 15px; font-weight: 700; }
  .accion:disabled { opacity: 0.5; }
  .hecho { margin-top: 8px; color: #22c55e; font-size: 13px; }
  .toast { position: fixed; left: 12px; right: 12px; bottom: 16px; background: #7f1d1d; color: #fff; padding: 10px 14px; border-radius: 10px; z-index: 10; font-size: 14px; }
`

export default function App() {
  const [puntos, setPuntos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [sel, setSel] = useState(null)
  const [vista, setVista] = useState('mapa')
  const [filtro, setFiltro] = useState('Todos')
  const [guardando, setGuardando] = useState(null)

  // Consultar los datos en Supabase
  useEffect(() => {
    async function cargar() {
      const { data, error } = await supabase
        .from('puntos')
        .select('nombre, categoria, latitud, longitud, valor, fecha, descripcion')

      console.log('Datos recibidos de Supabase:', data, error)

      if (error) {
        setError(error.message)
      } else {
        setPuntos(
          data.map((p) => ({
            ...p,
            latitud: Number(p.latitud),
            longitud: Number(p.longitud),
            valor: Number(p.valor),
          }))
        )
      }
      setCargando(false)
    }
    cargar()
  }, [])

  // El chófer cambia el estado de un pedido y se guarda en Supabase
  async function cambiarEstado(punto) {
    const siguiente = SIGUIENTE[punto.categoria]
    if (!siguiente) return

    setGuardando(punto.nombre)
    const { data, error } = await supabase
      .from('puntos')
      .update({ categoria: siguiente.estado })
      .eq('nombre', punto.nombre)
      .select()
    setGuardando(null)

    if (error || !data || data.length === 0) {
      setAviso('No se pudo guardar el cambio. Revisá los permisos en Supabase.')
      setTimeout(() => setAviso(null), 4000)
      return
    }

    setPuntos((prev) =>
      prev.map((p) =>
        p.nombre === punto.nombre ? { ...p, categoria: siguiente.estado } : p
      )
    )
    setSel((s) => (s && s.nombre === punto.nombre ? { ...s, categoria: siguiente.estado } : s))
  }

  // Indicadores calculados con los datos de Supabase
  const kpis = useMemo(() => {
    const total = puntos.length
    const promedio = total
      ? (puntos.reduce((acc, p) => acc + p.valor, 0) / total).toFixed(1)
      : 0
    const pendientes = puntos.filter((p) => p.categoria === 'Pendiente').length
    const criticos = puntos.filter((p) => p.valor >= 50).length
    return { total, promedio, pendientes, criticos }
  }, [puntos])

  const listaChofer = useMemo(
    () => puntos.filter((p) => filtro === 'Todos' || p.categoria === filtro),
    [puntos, filtro]
  )

  // Capa de puntos con deck.gl. Posición = [longitud, latitud]
  const capaPuntos = new ScatterplotLayer({
    id: 'entregas',
    data: puntos,
    pickable: true,
    getPosition: (d) => [d.longitud, d.latitud],
    getFillColor: (d) => [...(COLORES[d.categoria] || [120, 120, 120]), 220],
    getRadius: (d) => 120 + d.valor * 3,
    radiusUnits: 'meters',
    radiusMinPixels: 6,
    radiusMaxPixels: 28,
    stroked: true,
    getLineColor: [255, 255, 255],
    lineWidthMinPixels: 1,
    updateTriggers: { getFillColor: puntos.map((p) => p.categoria).join('|') },
    onClick: (info) => info.object && setSel(info.object),
  })

  return (
    <div className="app">
      <style>{ESTILOS}</style>

      <header>
        <h1>Mapa de Entregas – Buenos Aires</h1>
        <p>Datos desde Supabase · Visualización con deck.gl</p>
      </header>

      <div className="kpis">
        <div className="kpi"><b>{kpis.total}</b><span>Pedidos</span></div>
        <div className="kpi"><b>{kpis.promedio}</b><span>Demora prom. (min)</span></div>
        <div className="kpi"><b>{kpis.pendientes}</b><span>Pendientes</span></div>
        <div className="kpi"><b>{kpis.criticos}</b><span>Críticos (50+ min)</span></div>
      </div>

      <div className="tabs">
        <button className={`tab ${vista === 'mapa' ? 'activa' : ''}`} onClick={() => setVista('mapa')}>
          🗺️ Mapa
        </button>
        <button className={`tab ${vista === 'chofer' ? 'activa' : ''}`} onClick={() => setVista('chofer')}>
          🚚 Chófer
        </button>
      </div>

      {vista === 'mapa' && (
        <div className="mapa">
          {cargando && <div className="aviso">Cargando datos…</div>}
          {error && <div className="aviso">Error al leer Supabase: {error}</div>}

          <div className="leyenda">
            {Object.entries(COLORES).map(([nombre, c]) => (
              <div key={nombre}>
                <span className="punto" style={{ background: `rgb(${c.join(',')})` }} />
                {nombre}
              </div>
            ))}
          </div>

          <DeckGL
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            initialViewState={VISTA_INICIAL}
            controller={true}
            layers={[capaBase, capaPuntos]}
            getTooltip={({ object }) =>
              object && {
                html: `<div><b>${object.nombre}</b><br/>Categoría: ${object.categoria}<br/>Valor: ${object.valor} min</div>`,
                style: {
                  backgroundColor: '#111827',
                  color: '#fff',
                  fontSize: '13px',
                  borderRadius: '8px',
                  padding: '8px',
                },
              }
            }
          />

          {sel && (
            <div className="detalle">
              <button onClick={() => setSel(null)}>✕</button>
              <b>{sel.nombre}</b>
              <div>Categoría: {sel.categoria}</div>
              <div>Valor (demora): {sel.valor} min</div>
              <div>Zona: {sel.descripcion}</div>
            </div>
          )}
        </div>
      )}

      {vista === 'chofer' && (
        <div className="chofer">
          {cargando && <p>Cargando pedidos…</p>}
          {error && <p>Error al leer Supabase: {error}</p>}

          <div className="filtros">
            {['Todos', 'Pendiente', 'En camino', 'Entregado'].map((f) => (
              <button
                key={f}
                className={`chip ${filtro === f ? 'activo' : ''}`}
                onClick={() => setFiltro(f)}
              >
                {f}
                {f !== 'Todos' && ` (${puntos.filter((p) => p.categoria === f).length})`}
              </button>
            ))}
          </div>

          {listaChofer.map((p) => {
            const siguiente = SIGUIENTE[p.categoria]
            const color = COLORES[p.categoria] || [120, 120, 120]
            return (
              <div className="tarjeta" key={p.nombre}>
                <div className="fila">
                  <span className="nombre">{p.nombre}</span>
                  <span className="badge" style={{ background: `rgb(${color.join(',')})` }}>
                    {p.categoria}
                  </span>
                </div>
                <div className="zona">
                  {p.descripcion} · demora {p.valor} min
                </div>
                {siguiente ? (
                  <button
                    className="accion"
                    disabled={guardando === p.nombre}
                    onClick={() => cambiarEstado(p)}
                  >
                    {guardando === p.nombre ? 'Guardando…' : siguiente.texto}
                  </button>
                ) : (
                  <div className="hecho">✔ Entrega completada</div>
                )}
              </div>
            )
          })}

          {!cargando && listaChofer.length === 0 && <p>No hay pedidos en este estado.</p>}
        </div>
      )}

      {aviso && <div className="toast">{aviso}</div>}
    </div>
  )
}
