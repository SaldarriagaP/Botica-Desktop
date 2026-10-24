import { api } from '../../api.js';
import { $, fecha, postJson } from '../core/utils.js';

// Función para consultar cuándo fue la última sincronización
export async function cargarSyncEstado() {
  const estado = await api('/api/sync/estado');
  $('lastSync').textContent = estado.lastSyncAt ? fecha(estado.lastSyncAt) : 'nunca';
}

// Función que llamaremos desde app.js al iniciar
export function initSync() {
  $('btnSincronizar').addEventListener('click', async () => {
    $('syncMsg').textContent = 'Sincronizando...';
    const res = await postJson('/api/sync');
    
    $('syncMsg').textContent = res.ok 
      ? `OK: ${res.productosActualizados} productos, ${res.ventasSubidas} ventas subidas` 
      : `Error: ${res.error}`;
      
    cargarSyncEstado();
    
    // Nota de arquitectura: Aquí el código original hacía "cargarCatalogo()".
    // Como el catálogo le pertenece a tu compañero, usaremos un evento 
    // personalizado para avisarle que debe recargar su tabla.
    document.dispatchEvent(new CustomEvent('sync-completada'));
  });
  // Carga inicial del estado al inicializar
  cargarSyncEstado();
}