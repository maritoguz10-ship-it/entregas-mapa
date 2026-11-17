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

export default function App() {
  const [puntos, setPuntos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null)

  // Etapa 4: consultar los datos en Supabase
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

  // Etapa 7: indicadores calculados con los datos de Supabase
  const kpis = useMemo(() => {
    const total = puntos.length
    const promedio = total
      ? (puntos.reduce((acc, p) => acc + p.valor, 0) / total).toFixed(1)
      : 0
    const pendientes = puntos.filter((p) => p.categoria === 'Pendiente').length
    const criticos = puntos.filter((p) => p.valor >= 50).length
    return { total, promedio, pendientes, criticos }
  }, [puntos])

  // Etapa 5: capa de puntos con deck.gl. Posición = [longitud, latitud]
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
    onClick: (info) => info.object && setSel(info.object),
  })

  return (
    <div className="app">
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

        {/* Etapa 6: zoom, desplazamiento y tooltip */}
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
    </div>
  )
}
